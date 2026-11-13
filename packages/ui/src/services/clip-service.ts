/**
 * CLIP model setup status (RFD-002 first-run setup): polled while the model is not ready.
 * Works in dev preview (no RPC: status stays null, nothing shown) and in Electrobun (RPC).
 * State lives in an external store; polling is module-level, started by initClipService (outside React).
 */
import { createStore, useStore } from "../external/store";
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

/** CLIP results reported in the detecting stage stats (pairs per band, or why CLIP did not run). */
export interface ClipStageStats {
  skipped: null | "disabled" | "model_not_ready" | "model_load_failed";
  detail?: string;
  provider?: string;
  embedded: number;
  embedErrors: number;
  pairsStored: number;
  pairsInReview: number;
  pairsStrong: number;
  thresholds: { strong: number; review: number; store: number };
  /** Video frames (RFD-002 §E); absent in stats from older runs. */
  videoSkipped?: null | "no_ffmpeg";
  videosEmbedded?: number;
  videoEmbedErrors?: number;
  videoPairs?: number;
}

export interface ClipSetupState {
  status: ClipModelStatus | null;
  importError: string | null;
  /** Setup was needed this session (a download, check or failure was seen). */
  setupNeeded: boolean;
  /** The person closed the first-run setup screen (the processing banner keeps showing progress). */
  setupDismissed: boolean;
}

const INITIAL: ClipSetupState = { status: null, importError: null, setupNeeded: false, setupDismissed: false };
const NEEDS_SETUP = new Set<ClipModelStatus["state"]>(["downloading", "verifying", "error"]);
const store = createStore<ClipSetupState>(INITIAL);
let rpcClient: ClipRPC | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

function patch(next: Partial<ClipSetupState>): void {
  store.set((prev) => ({
    ...prev,
    ...next,
    setupNeeded: prev.setupNeeded || (next.status ? NEEDS_SETUP.has(next.status.state) : false),
  }));
}

/** Show the first-run setup screen: setup was needed this session and the person has not closed it. */
export function showClipSetup(s: ClipSetupState): boolean {
  return s.setupNeeded && !s.setupDismissed && s.status !== null;
}

/** Close the first-run setup screen; setup carries on in the background. */
export function dismissClipSetup(): void {
  patch({ setupDismissed: true });
}

function stopPolling(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

async function refresh(): Promise<void> {
  if (!rpcClient) return;
  try {
    const status = await rpcClient.getClipModelStatus();
    patch({ status });
    if (status.state === "ready") stopPolling();
  } catch (error) {
    log.error("Failed to read CLIP model status", error);
  }
}

function startPolling(): void {
  if (timer) return;
  void refresh();
  timer = setInterval(() => void refresh(), 1000);
}

/** CLIP setup state, re-rendering on change. */
export function useClipSetup(): ClipSetupState {
  return useStore(store);
}

/** Non-reactive read of the model status. */
export function getClipModelStatus(): ClipModelStatus | null {
  return store.get().status;
}

/** Non-reactive read of the last import error. */
export function getClipImportError(): string | null {
  return store.get().importError;
}

export function initClipService(rpc: ClipRPC): void {
  rpcClient = rpc;
  startPolling();
}

export async function retryClipModelSetup(): Promise<void> {
  if (!rpcClient) return;
  patch({ importError: null });
  patch({ status: await rpcClient.retryClipModelSetup() });
  startPolling();
}

export async function importClipModelFile(): Promise<void> {
  if (!rpcClient) return;
  const { status, error } = await rpcClient.importClipModelFile();
  patch({ status, importError: error });
}

/** Tests only: forget the RPC client, stop polling and clear state. */
export function resetClipServiceForTests(): void {
  stopPolling();
  rpcClient = null;
  store.set(INITIAL);
}
