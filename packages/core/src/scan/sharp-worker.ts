/**
 * Image-analysis worker — runs in an isolated child process to avoid GLib ref-counting races
 * with Chromium in Electrobun desktop apps. ⚠️ FRAGILE: See _FRAGILE.md
 *
 * Both Sharp (libvips) and Chromium use GLib; in one process, concurrent GLib ref-counting
 * causes assertion failures. Running Sharp in a separate process eliminates this entirely.
 *
 * Bundled into the app as sharp-worker.js (apps/desktop/scripts/build-worker.ts).
 *
 * Protocol (IPC via Bun.spawn, types in analysis-protocol.ts):
 *   Parent → Child: AnalysisRequest  { id, filePath }
 *   Child → Parent: AnalysisResponse { id, sha256, exif, decoded, contentHash, perceptualHash, timings, failure? }
 *   Child → Parent: WorkerReady      { type: "ready", sharp, phash, decodeBudgetBytes } on startup
 *
 * Env: GIGGLE_DECODE_BUDGET_BYTES — memory budget for concurrent decodes (default 1 GiB).
 */
import type SharpType from "sharp";
import type { AnalysisRequest, AnalysisResponse, WorkerReady } from "./analysis-protocol";
import { ByteBudget } from "./byte-budget";
import { analyzeImageFile } from "./image-analysis";

const DEFAULT_BUDGET_BYTES = 1024 * 1024 * 1024;

let sharpFn: typeof SharpType | null = null;
try {
  sharpFn = (await import("sharp")).default;
  sharpFn.concurrency(1);
} catch (error) {
  const msg = error instanceof Error ? error.message : String(error);
  // The worker has no logger transport; stderr is the parent's diagnostic channel.
  process.stderr.write(`[sharp-worker] Failed to load sharp: ${msg}\n`);
}

const configured = Number(process.env.GIGGLE_DECODE_BUDGET_BYTES);
const budget = new ByteBudget(configured > 0 ? configured : DEFAULT_BUDGET_BYTES);

process.on("message", async (msg: AnalysisRequest) => {
  let response: AnalysisResponse;
  if (!sharpFn) {
    response = {
      id: msg.id,
      timings: {},
      failure: { category: "worker_crash", message: "Sharp module not available in worker" },
    };
  } else {
    response = { id: msg.id, ...(await analyzeImageFile(sharpFn, msg.filePath, budget)) };
  }
  process.send?.(response);
});

const ready: WorkerReady = {
  type: "ready",
  sharp: sharpFn !== null,
  phash: sharpFn !== null,
  decodeBudgetBytes: budget.limitBytes,
};
process.send?.(ready);
