/**
 * CLIP model lifecycle for the running app (RFD-002 §C "first-run setup"): checks the model on
 * launch, downloads it in the background when missing or invalid, and exposes status, retry and
 * offline import. Scanning never waits for it; CLIP work runs once the model is ready.
 */
import { join } from "node:path";
import { getAppDataPath } from "../config/app-paths";
import { getAppSettings } from "../config/user-config";
import { getLogger } from "../logging/logger";
import { type ClipModelStatus, ensureClipModel, importModelFile, isModelReady } from "./model-download";
import { CLIP_MODEL, modelDirName, onnxFile } from "./model-manifest";

const log = getLogger("core:clip-model");

let status: ClipModelStatus = { state: "missing" };
let running: Promise<void> | null = null;

export function clipModelDir(): string {
  return join(getAppDataPath(), "models", modelDirName(CLIP_MODEL));
}

export function getClipModelStatus(): ClipModelStatus {
  return status;
}

/** Path of the verified ONNX file, or null until the model is ready. */
export function getClipModelPath(): string | null {
  return status.state === "ready" ? join(clipModelDir(), onnxFile(CLIP_MODEL).name) : null;
}

/** Start (or join) setup: verify what is on disk, download what is missing. Never throws. */
export function startClipModelSetup(fetchImpl?: typeof fetch): Promise<void> {
  if (running) return running;
  running = (async () => {
    const dir = clipModelDir();
    try {
      if (await isModelReady(CLIP_MODEL, dir)) {
        status = { state: "ready", dir };
        return;
      }
      log.info(`CLIP model missing or invalid; downloading ${CLIP_MODEL.id} to ${dir}`);
      await ensureClipModel({ manifest: CLIP_MODEL, dir, fetchImpl, onStatus: (s) => (status = s) });
      log.info("CLIP model ready");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      status = { state: "error", message };
      log.error(`CLIP model setup failed: ${message}`);
    } finally {
      running = null;
    }
  })();
  return running;
}

/** Import a manually downloaded model file (offline installs). Throws if it is not the right file. */
export async function importClipModel(sourcePath: string): Promise<ClipModelStatus> {
  const dir = clipModelDir();
  await importModelFile(CLIP_MODEL, dir, sourcePath);
  status = { state: "ready", dir };
  return status;
}

/** CLIP options for the analysis worker: null when CLIP is disabled or the model is not ready. */
export function workerClipOptions(): { modelPath: string; provider: string; threads: number } | null {
  const settings = getAppSettings();
  const modelPath = getClipModelPath();
  if (!settings.clipEnabled || !modelPath) return null;
  return { modelPath, provider: settings.clipExecutionProvider, threads: settings.clipThreads };
}
