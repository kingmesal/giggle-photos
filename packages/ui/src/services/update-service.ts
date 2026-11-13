/**
 * App updates (Electrobun Updater, background download). Without RPC (dev preview / E2E) there is
 * nothing to show.
 */

/** Mirrors the desktop updater's state (the UI only talks to the main process over RPC). */
export interface UpdateState {
  phase: "idle" | "checking" | "up-to-date" | "downloading" | "ready" | "applying" | "error";
  version?: string;
  progress?: number;
  bytesDownloaded?: number;
  totalBytes?: number;
  message?: string;
}

export interface UpdateRPC {
  getUpdateState: () => Promise<UpdateState>;
  restartToUpdate: () => Promise<UpdateState>;
  retryUpdate: () => Promise<UpdateState>;
}

let rpcClient: UpdateRPC | null = null;

export function initUpdateService(rpc: UpdateRPC): void {
  rpcClient = rpc;
}

/** Test helper. */
export function clearUpdateService(): void {
  rpcClient = null;
}

export async function loadUpdateState(): Promise<UpdateState | null> {
  return rpcClient ? rpcClient.getUpdateState() : null;
}

export async function restartToUpdate(): Promise<UpdateState | null> {
  return rpcClient ? rpcClient.restartToUpdate() : null;
}

export async function retryUpdate(): Promise<UpdateState | null> {
  return rpcClient ? rpcClient.retryUpdate() : null;
}

/** Phases that change on their own (keep polling). */
export function isInProgress(state: UpdateState | null): boolean {
  return state !== null && (state.phase === "idle" || state.phase === "checking" || state.phase === "downloading");
}
