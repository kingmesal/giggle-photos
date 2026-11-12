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

import { join } from "node:path";
import { getLogger } from "../logging/logger";

const log = getLogger("core:sharp-process");

interface SharpRequest {
  id: number;
  filePath: string;
  computeContentHash: boolean;
  computePerceptualHash: boolean;
}

interface SharpResponse {
  id: number;
  type?: string;
  sharp?: boolean;
  phash?: boolean;
  contentHash?: string | null;
  perceptualHash?: string | null;
  readMs?: number;
  contentHashMs?: number;
  perceptualHashMs?: number;
  error?: string;
}

interface PendingRequest {
  resolve: (result: SharpResponse) => void;
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
export async function ensureSharpProcess(): Promise<{ sharp: boolean; phash: boolean }> {
  if (childProcess && workerCapabilities) {
    return workerCapabilities;
  }

  const workerPath = join(import.meta.dir, "sharp-worker.ts");

  const readyPromise = new Promise<{ sharp: boolean; phash: boolean }>((resolve) => {
    readyResolve = resolve;
  });

  log.debug(`Spawning Sharp worker: ${process.execPath} ${workerPath}`);

  childProcess = Bun.spawn([process.execPath, "run", workerPath], {
    ipc(message: SharpResponse) {
      // Handle ready signal
      if (message.type === "ready") {
        const caps = { sharp: message.sharp ?? false, phash: message.phash ?? false };
        workerCapabilities = caps;
        log.info(`Sharp worker ready (sharp: ${caps.sharp}, phash: ${caps.phash})`);
        readyResolve?.(caps);
        readyResolve = null;
        return;
      }

      // Handle hash result
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
 * Request content hash and/or perceptual hash from the Sharp worker.
 *
 * The worker reads the file, decodes it with Sharp, and returns results.
 * Returns `null` for unsupported formats, `undefined` if the algorithm wasn't requested.
 */
export async function requestSharpHashes(
  filePath: string,
  computeContentHash: boolean,
  computePerceptualHash: boolean,
): Promise<{
  contentHash: string | null | undefined;
  perceptualHash: string | null | undefined;
  readMs?: number;
  contentHashMs?: number;
  perceptualHashMs?: number;
}> {
  await ensureSharpProcess();

  const id = nextRequestId++;
  const request: SharpRequest = {
    id,
    filePath,
    computeContentHash,
    computePerceptualHash,
  };

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingRequests.delete(id);
      reject(new Error(`Sharp worker timeout (${WORKER_TIMEOUT_MS}ms) for ${filePath}`));
    }, WORKER_TIMEOUT_MS);

    pendingRequests.set(id, {
      resolve: (response) => {
        if (response.error) {
          log.warn(`Sharp worker error for ${filePath}: ${response.error}`);
        }
        resolve({
          contentHash: response.contentHash,
          perceptualHash: response.perceptualHash,
          readMs: response.readMs,
          contentHashMs: response.contentHashMs,
          perceptualHashMs: response.perceptualHashMs,
        });
      },
      reject,
      timer,
    });

    childProcess?.send(request);
    log.debug(
      `Sent request #${id} to Sharp worker: ${filePath} (content: ${computeContentHash}, phash: ${computePerceptualHash})`,
    );
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
 * Check if the Sharp worker has the sharp-phash module available.
 */
export function isWorkerPhashAvailable(): boolean {
  return workerCapabilities?.phash ?? false;
}
