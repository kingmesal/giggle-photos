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
let readyResolve: ((capabilities: { sharp: boolean; phash: boolean }) => void) | null = null;
let workerCapabilities: { sharp: boolean; phash: boolean } | null = null;

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

export async function ensureSharpProcess(): Promise<{ sharp: boolean; phash: boolean }> {
  if (childProcess && workerCapabilities) {
    return workerCapabilities;
  }

  const workerPath = resolveWorkerPath();

  const readyPromise = new Promise<{ sharp: boolean; phash: boolean }>((resolve) => {
    readyResolve = resolve;
  });

  log.debug(`Spawning Sharp worker: ${process.execPath} ${workerPath}`);

  childProcess = Bun.spawn([process.execPath, "run", workerPath], {
    env: { ...process.env, GIGGLE_DECODE_BUDGET_BYTES: String(env.DECODE_MEMORY_BUDGET_MB * 1024 * 1024) },
    ipc(message: WorkerMessage) {
      // Handle ready signal
      if ("type" in message && message.type === "ready") {
        const caps = { sharp: message.sharp, phash: message.phash };
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
  childProcess.exited.then((code) => {
    log.warn(`Sharp worker process exited with code ${code}`);
    childProcess = null;
    workerCapabilities = null;

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

/**
 * Shut down the Sharp worker process.
 * Call this on application exit.
 */
export function shutdownSharpProcess(): void {
  if (childProcess) {
    childProcess.kill();
    childProcess = null;
    workerCapabilities = null;

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
