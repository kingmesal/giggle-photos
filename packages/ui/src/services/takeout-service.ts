/**
 * Google Takeout report service (RFD-003): sidecar/album counts and drill-down lists.
 * Works in dev preview (no RPC: empty report) and in Electrobun (RPC).
 */
import { getLogger } from "./logger-service";

const log = getLogger("ui:takeout");

/** Mirrors core TakeoutSummary (the UI only talks to core over RPC). */
export interface TakeoutSummary {
  folders: { year: number; album: number; special: number };
  sidecars: { media: number; album_metadata: number; other: number; unparseable: number };
  mediaSidecarsMatched: number;
  mediaSidecarsUnmatched: number;
  byMethod: Record<string, number>;
  mediaWithoutSidecar: number;
  pairs: { motion: number; edited: number };
}

/** Takeout part of the scanning stage stats. */
export interface TakeoutStageStats {
  roots: number;
  warnings: string[];
  summary: TakeoutSummary | null;
}

export interface TakeoutReport {
  summary: TakeoutSummary;
  unmatchedSidecars: { id: number; path: string; title: string | null }[];
  mediaWithoutSidecar: { id: number; path: string }[];
  listLimit: number;
}

/** Mirrors core ImportCheckResult (RFD-003 §G). */
export interface ImportCheckRow {
  label: string;
  app: number | null;
  immichGo: number | null;
  status: "match" | "differs" | "info";
  note: string;
}

export interface ImportCheckResult {
  rows: ImportCheckRow[];
  events: Record<string, number>;
}

export interface TakeoutRPC {
  getTakeoutReport: () => Promise<TakeoutReport>;
  compareImmichGoReport: (report: string) => Promise<ImportCheckResult>;
}

let rpcClient: TakeoutRPC | null = null;

export function initTakeoutService(rpc: TakeoutRPC): void {
  rpcClient = rpc;
  log.debug("Takeout service initialized with RPC");
}

/** The full report, or null when RPC is unavailable (dev preview) or the call fails. */
export async function loadTakeoutReport(): Promise<TakeoutReport | null> {
  if (!rpcClient) return null;
  try {
    return await rpcClient.getTakeoutReport();
  } catch (error) {
    log.error("Failed to load Takeout report", error);
    return null;
  }
}

/** Test helper. */
export function clearTakeoutService(): void {
  rpcClient = null;
}

/** Compare a pasted immich-go dry-run report with the library; throws without RPC (dev preview). */
export async function compareImmichGoReport(report: string): Promise<ImportCheckResult> {
  if (!rpcClient) throw new Error("The import check is only available in the desktop app");
  return rpcClient.compareImmichGoReport(report);
}
