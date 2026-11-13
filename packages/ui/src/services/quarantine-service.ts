/**
 * Quarantine service (RFD-003 §F): what is in the quarantine folder, and restoring it.
 * Works in dev preview / E2E (no RPC: nothing quarantined) and in Electrobun (RPC).
 */
import { getLogger } from "./logger-service";

const log = getLogger("ui:quarantine");

/** Mirrors the desktop handler's response (the UI only talks to core over RPC). */
export interface QuarantineStatus {
  root: string;
  enabled: boolean;
  files: number;
  sidecars: number;
}

export interface RestoreResult {
  restored: number;
  problems: string[];
}

export interface QuarantineRPC {
  getQuarantineStatus: () => Promise<QuarantineStatus>;
  restoreQuarantinedFiles: () => Promise<RestoreResult>;
}

let rpcClient: QuarantineRPC | null = null;

export function initQuarantineService(rpc: QuarantineRPC): void {
  rpcClient = rpc;
  log.debug("Quarantine service initialized with RPC");
}

/** Test helper. */
export function clearQuarantineService(): void {
  rpcClient = null;
}

/** Status, or null without RPC (dev preview). */
export async function loadQuarantineStatus(): Promise<QuarantineStatus | null> {
  return rpcClient ? rpcClient.getQuarantineStatus() : null;
}

export async function restoreQuarantine(): Promise<RestoreResult> {
  if (!rpcClient) throw new Error("Restore is only available in the desktop app");
  return rpcClient.restoreQuarantinedFiles();
}
