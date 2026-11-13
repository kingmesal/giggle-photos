/**
 * Parent-side manager for the Sharp child process.
 *
 * Spawns a long-lived child process that handles all Sharp/libvips operations
 * in isolation from the main Chromium process, avoiding GLib ref-counting races.
 *
 * Usage:
 *   const { contentHash, perceptualHash } = await requestSharpHashes(filePath, true, true);
 *   shutdownSharpProcess(); // on app exit
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { env } from "../config/env";
import { getLogger } from "../logging/logger";
import type { AnalysisRequest, AnalysisResponse, WorkerReady } from "./analysis-protocol";

const log = getLogger("core:sharp-process");

type WorkerMessage = AnalysisResponse | WorkerReady;

interface PendingRequest {
  resolve: (result: AnalysisResponse) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const WORKER_TIMEOUT_MS = 60_000; // 60 seconds per file

let childProcess: ReturnType<typeof Bun.spawn> | null = null;
let nextRequestId = 0;
const pendingRequests = new Map<number, PendingRequest>();
/** What the running worker can do; `clip` mirrors WorkerReady.clip (null: no model offered). */
export interface WorkerCapabilities {
  sharp: boolean;
  phash: boolean;
  clip: WorkerReady["clip"];
}

/** CLIP model to load in the worker (only a verified file; see clip/model-service.ts). */
export interface WorkerClipOptions {
  modelPath: string;
  provider: string;
  threads: number;
}

let readyResolve: ((capabilities: WorkerCapabilities) => void) | null = null;
let workerCapabilities: WorkerCapabilities | null = null;
let spawnedWithClip: string | null = null;

/**
 * Ensure the Sharp worker child process is running.
 * Spawns it on first call, reuses on subsequent calls.
 */
/**
 * The packaged app ships a bundled `sharp-worker.js` next to the main bundle (see
 * apps/desktop/scripts/build-worker.ts); source checkouts (tests, bench, dev) run the `.ts`.
 */
function resolveWorkerPath(): string {
  const bundled = join(import.meta.dir, "sharp-worker.js");
  return existsSync(bundled) ? bundled : join(import.meta.dir, "sharp-worker.ts");
}

export async function ensureSharpProcess(clip?: WorkerClipOptions | null): Promise<WorkerCapabilities> {
  const wantedClip = clip ? `${clip.modelPath}|${clip.provider}|${clip.threads}` : null;
  if (childProcess && workerCapabilities) {
    // Reuse the worker unless CLIP is now wanted and it was started without it (or differently).
    if (!wantedClip || wantedClip === spawnedWithClip) return workerCapabilities;
    shutdownSharpProcess();
  }
  spawnedWithClip = wantedClip;

  const workerPath = resolveWorkerPath();

  const readyPromise = new Promise<WorkerCapabilities>((resolve) => {
    readyResolve = resolve;
  });

  log.debug(`Spawning Sharp worker: ${process.execPath} ${workerPath}`);

  childProcess = Bun.spawn([process.execPath, "run", workerPath], {
    env: {
      ...process.env,
      GIGGLE_DECODE_BUDGET_BYTES: String(env.DECODE_MEMORY_BUDGET_MB * 1024 * 1024),
      ...(clip
        ? {
            GIGGLE_CLIP_MODEL_PATH: clip.modelPath,
            GIGGLE_CLIP_PROVIDER: clip.provider,
            GIGGLE_CLIP_THREADS: String(clip.threads),
          }
        : {}),
    },
    ipc(message: WorkerMessage) {
      // Handle ready signal
      if ("type" in message && message.type === "ready") {
        const caps: WorkerCapabilities = { sharp: message.sharp, phash: message.phash, clip: message.clip };
        workerCapabilities = caps;
        log.info(
          `Sharp worker ready (sharp: ${caps.sharp}, phash: ${caps.phash}, decode budget: ${Math.round(message.decodeBudgetBytes / 1048576)} MB)`,
        );
        readyResolve?.(caps);
        readyResolve = null;
        return;
      }

      // Handle analysis result
      if (!("id" in message)) return;
      const pending = pendingRequests.get(message.id);
      if (pending) {
        clearTimeout(pending.timer);
        pendingRequests.delete(message.id);
        pending.resolve(message);
      } else {
        log.warn(`Received response for unknown request id ${message.id}`);
      }
    },
    stdio: ["ignore", "inherit", "ignore"], // suppress GLib warnings from libvips on stderr
  });

  // Handle child process exit
  const thisChild = childProcess;
  thisChild.exited.then((code) => {
    log.warn(`Sharp worker process exited with code ${code}`);
    // A replaced worker exits after its successor started: leave the new worker's state alone.
    // (shutdownSharpProcess already rejected the old worker's pending requests.)
    if (childProcess !== thisChild) return;
    childProcess = null;
    workerCapabilities = null;
    spawnedWithClip = null;

    // Reject all pending requests
    for (const [id, pending] of pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(new Error(`Sharp worker exited with code ${code}`));
      pendingRequests.delete(id);
    }
  });

  return readyPromise;
}

/**
 * Analyse one image in the worker: a single read and decode yields sha256, EXIF fields, decoded
 * info, contentHash and perceptualHash. Read/decode failures come back in `failure` (never thrown);
 * only a worker crash or timeout rejects.
 */
export async function requestImageAnalysis(filePath: string): Promise<AnalysisResponse> {
  await ensureSharpProcess();

  const id = nextRequestId++;
  const request: AnalysisRequest = { id, filePath };

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingRequests.delete(id);
      reject(new Error(`Sharp worker timeout (${WORKER_TIMEOUT_MS}ms) for ${filePath}`));
    }, WORKER_TIMEOUT_MS);

    pendingRequests.set(id, { resolve, reject, timer });
    childProcess?.send(request);
    log.debug(`Sent analysis request #${id} to Sharp worker: ${filePath}`);
  });
}

/** CLIP embedding only, for images analysed before the model was ready (worker must have CLIP). */
export async function requestImageEmbedding(filePath: string): Promise<AnalysisResponse> {
  if (!childProcess) throw new Error("Worker not running");
  const id = nextRequestId++;
  const request: AnalysisRequest = { id, filePath, mode: "embed" };
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingRequests.delete(id);
      reject(new Error(`Sharp worker timeout (${WORKER_TIMEOUT_MS}ms) for ${filePath}`));
    }, WORKER_TIMEOUT_MS);
    pendingRequests.set(id, { resolve, reject, timer });
    childProcess?.send(request);
  });
}

/** CLIP embeddings of a video's 5 frames (RFD-002 §E). Frame extraction can take a while. */
export async function requestVideoFrameEmbeddings(filePath: string, durationSec: number): Promise<AnalysisResponse> {
  if (!childProcess) throw new Error("Worker not running");
  const id = nextRequestId++;
  const request: AnalysisRequest = { id, filePath, mode: "embed_frames", durationSec };
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingRequests.delete(id);
      reject(new Error(`Sharp worker timeout (${WORKER_TIMEOUT_MS * 3}ms) for ${filePath}`));
    }, WORKER_TIMEOUT_MS * 3);
    pendingRequests.set(id, { resolve, reject, timer });
    childProcess?.send(request);
  });
}

/**
 * Shut down the Sharp worker process.
 * Call this on application exit.
 */
export function shutdownSharpProcess(): void {
  if (childProcess) {
    childProcess.kill();
    childProcess = null;
    workerCapabilities = null;
    spawnedWithClip = null;

    // Clean up pending requests
    for (const [id, pending] of pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(new Error("Sharp worker shut down"));
      pendingRequests.delete(id);
    }

    log.debug("Sharp worker process shut down");
  }
}

/**
 * Check if the Sharp worker has the Sharp module available.
 */
export function isWorkerSharpAvailable(): boolean {
  return workerCapabilities?.sharp ?? false;
}

/**
 * Check if the Sharp worker can compute perceptual hashes (sharp loaded).
 */
export function isWorkerPhashAvailable(): boolean {
  return workerCapabilities?.phash ?? false;
}
