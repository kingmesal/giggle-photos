import {
  getClipModelStatus as getStatus,
  importClipModel,
  startClipModelSetup,
} from "@giggle-photos/core/clip/model-service";
import { getLogger } from "@giggle-photos/core/logging/logger";
import { Utils } from "electrobun/main";

const log = getLogger("rpc:clip");

type ClipModelStatusResponse = ReturnType<typeof getStatus>;

/** RPC: current CLIP model setup status (missing / downloading / verifying / ready / error). */
export async function getClipModelStatus(): Promise<ClipModelStatusResponse> {
  return getStatus();
}

/** RPC: retry the model download after an error. Returns immediately; poll the status. */
export async function retryClipModelSetup(): Promise<ClipModelStatusResponse> {
  log.info("CLIP model setup retry requested");
  void startClipModelSetup();
  return getStatus();
}

/** RPC: import a manually downloaded model.onnx (offline installs), verified against the pinned hash. */
export async function importClipModelFile(): Promise<{ status: ClipModelStatusResponse; error: string | null }> {
  const chosen = await Utils.openFileDialog({
    allowedFileTypes: "onnx",
    canChooseFiles: true,
    canChooseDirectory: false,
    allowsMultipleSelection: false,
  });
  const path = chosen.find((p) => p.trim() !== "");
  if (!path) return { status: getStatus(), error: null };
  try {
    return { status: await importClipModel(path), error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.warn(`CLIP model import rejected: ${message}`);
    return { status: getStatus(), error: message };
  }
}
