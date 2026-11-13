/**
 * Image-analysis worker — runs in an isolated child process to avoid GLib ref-counting races
 * with Chromium in Electrobun desktop apps. ⚠️ FRAGILE: See _FRAGILE.md
 *
 * Both Sharp (libvips) and Chromium use GLib; in one process, concurrent GLib ref-counting
 * causes assertion failures. Running Sharp in a separate process eliminates this entirely.
 * ONNX Runtime (CLIP) also runs here, next to the bytes it embeds.
 *
 * Bundled into the app as sharp-worker.js (apps/desktop/scripts/build-worker.ts).
 *
 * Protocol (IPC via Bun.spawn, types in analysis-protocol.ts):
 *   Parent → Child: AnalysisRequest  { id, filePath, mode? }
 *   Child → Parent: AnalysisResponse { id, sha256, exif, decoded, contentHash, perceptualHash,
 *                                      clipEmbedding?, timings, failure?, clipError? }
 *   Child → Parent: WorkerReady      { type: "ready", sharp, phash, decodeBudgetBytes, clip } on startup
 *
 * Env: GIGGLE_DECODE_BUDGET_BYTES — memory budget for concurrent decodes (default 1 GiB).
 *      GIGGLE_CLIP_MODEL_PATH — verified CLIP ONNX file; embeddings are computed when set.
 *      GIGGLE_CLIP_PROVIDER / GIGGLE_CLIP_THREADS — execution provider and intra-op threads.
 */
import type SharpType from "sharp";
import { CLIP_MODEL } from "../clip/model-manifest";
import { clipInputFromBytes } from "../clip/preprocess";
import { createClipSession, type ExecutionProvider, embedImage } from "../clip/session";
import type { AnalysisRequest, AnalysisResponse, WorkerReady } from "./analysis-protocol";
import { ByteBudget } from "./byte-budget";
import { analyzeImageFile, type Embedder, embedImageFile } from "./image-analysis";

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

/** Load the CLIP session when the parent offered a verified model. */
async function loadEmbedder(): Promise<{ embedder: Embedder | null; clip: WorkerReady["clip"] }> {
  const modelPath = process.env.GIGGLE_CLIP_MODEL_PATH;
  const sharp = sharpFn;
  if (!modelPath || !sharp) return { embedder: null, clip: null };
  try {
    const ort = await import("onnxruntime-node");
    const session = await createClipSession(ort, modelPath, {
      provider: (process.env.GIGGLE_CLIP_PROVIDER as ExecutionProvider | undefined) ?? "cpu",
      threads: Number(process.env.GIGGLE_CLIP_THREADS) || 4,
    });
    const embedder: Embedder = async (bytes) => {
      const t0 = performance.now();
      const input = await clipInputFromBytes(sharp, bytes, CLIP_MODEL);
      const t1 = performance.now();
      const vector = await embedImage(ort, session, CLIP_MODEL, input);
      return { vector, preprocessMs: t1 - t0, inferenceMs: performance.now() - t1 };
    };
    return { embedder, clip: { provider: session.provider, fallbackReason: session.fallbackReason } };
  } catch (error) {
    return { embedder: null, clip: { error: error instanceof Error ? error.message : String(error) } };
  }
}

const { embedder, clip } = await loadEmbedder();

process.on("message", async (msg: AnalysisRequest) => {
  let response: AnalysisResponse;
  if (!sharpFn) {
    response = {
      id: msg.id,
      timings: {},
      failure: { category: "worker_crash", message: "Sharp module not available in worker" },
    };
  } else if (msg.mode === "embed") {
    response = embedder
      ? { id: msg.id, ...(await embedImageFile(msg.filePath, embedder)) }
      : { id: msg.id, timings: {}, clipError: "CLIP model not loaded in worker" };
  } else {
    response = { id: msg.id, ...(await analyzeImageFile(sharpFn, msg.filePath, budget, embedder ?? undefined)) };
  }
  process.send?.(response);
});

const ready: WorkerReady = {
  type: "ready",
  sharp: sharpFn !== null,
  phash: sharpFn !== null,
  decodeBudgetBytes: budget.limitBytes,
  clip,
};
process.send?.(ready);
