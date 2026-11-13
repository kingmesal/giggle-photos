/**
 * CLIP model setup status (RFD-002 first-run setup): polled while the model is not ready.
 * Works in dev preview (no RPC: reports "unavailable") and in Electrobun (RPC).
 */
import { signal } from "sigment";
import { getLogger } from "./logger-service";

const log = getLogger("ui:clip");

/** Mirrors core ClipModelStatus. */
export type ClipModelStatus =
  | { state: "missing" }
  | { state: "downloading"; file: string; receivedBytes: number; totalBytes: number }
  | { state: "verifying"; file: string }
  | { state: "ready"; dir: string }
  | { state: "error"; message: string };

export interface ClipRPC {
  getClipModelStatus: () => Promise<ClipModelStatus>;
  retryClipModelSetup: () => Promise<ClipModelStatus>;
  importClipModelFile: () => Promise<{ status: ClipModelStatus; error: string | null }>;
}

let rpcClient: ClipRPC | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
const [getStatus, setStatus] = signal<ClipModelStatus | null>(null);
const [getImportError, setImportError] = signal<string | null>(null);

export { getImportError as getClipImportError, getStatus as getClipModelStatus };

async function refresh(): Promise<void> {
  if (!rpcClient) return;
  try {
    const status = await rpcClient.getClipModelStatus();
    setStatus(status);
    if (status.state === "ready" && timer) {
      clearInterval(timer);
      timer = null;
    }
  } catch (error) {
    log.error("Failed to read CLIP model status", error);
  }
}

function startPolling(): void {
  if (timer) return;
  void refresh();
  timer = setInterval(() => void refresh(), 1000);
}

export function initClipService(rpc: ClipRPC): void {
  rpcClient = rpc;
  startPolling();
}

export async function retryClipModelSetup(): Promise<void> {
  if (!rpcClient) return;
  setImportError(null);
  setStatus(await rpcClient.retryClipModelSetup());
  startPolling();
}

export async function importClipModelFile(): Promise<void> {
  if (!rpcClient) return;
  const { status, error } = await rpcClient.importClipModelFile();
  setStatus(status);
  setImportError(error);
}
