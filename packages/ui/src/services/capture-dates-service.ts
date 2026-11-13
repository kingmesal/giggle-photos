/**
 * Capture dates (RFD-006): what would be dated and from which source, and the background job that
 * writes the dates into the files. Without RPC (dev preview / E2E) the report is empty.
 */
import { getLogger } from "./logger-service";

const log = getLogger("ui:capture-dates");

/** Mirrors core CaptureDateProposal (the UI only talks to core over RPC). */
export interface CaptureDateProposal {
  fileId: number;
  path: string;
  fileType: "image" | "video";
  takenAt: string;
  precision: "exact" | "second" | "day" | "month" | "year";
  source: "sidecar" | "filename" | "folder";
  detail: string;
}

export interface CaptureDateReport {
  total: number;
  bySource: Record<string, number>;
  byPrecision: Record<string, number>;
  proposals: CaptureDateProposal[];
  undatable: number;
  undatableSample: string[];
  listLimit: number;
  /** Final step: writing is allowed only after duplicate checks. */
  readiness: { ready: boolean; blockers: string[] };
}

export interface CaptureDateJob {
  running: boolean;
  done: number;
  total: number;
  result: { written: number; failed: number; errors: { fileId: number; path: string; error: string }[] } | null;
  error: string | null;
}

export interface CaptureDatesRPC {
  getCaptureDateReport: () => Promise<CaptureDateReport>;
  startCaptureDates: () => Promise<CaptureDateJob>;
  getCaptureDateJob: () => Promise<CaptureDateJob>;
}

const EMPTY: CaptureDateReport = {
  total: 0,
  bySource: {},
  byPrecision: {},
  proposals: [],
  undatable: 0,
  undatableSample: [],
  listLimit: 500,
  readiness: { ready: true, blockers: [] },
};
let rpcClient: CaptureDatesRPC | null = null;

export function initCaptureDatesService(rpc: CaptureDatesRPC): void {
  rpcClient = rpc;
  log.debug("Capture dates service initialized with RPC");
}

/** Test helper. */
export function clearCaptureDatesService(): void {
  rpcClient = null;
}

export async function loadCaptureDateReport(): Promise<CaptureDateReport> {
  return rpcClient ? rpcClient.getCaptureDateReport() : EMPTY;
}

export async function startCaptureDates(): Promise<CaptureDateJob> {
  if (!rpcClient) throw new Error("Writing dates is only available in the desktop app");
  return rpcClient.startCaptureDates();
}

export async function getCaptureDateJob(): Promise<CaptureDateJob | null> {
  return rpcClient ? rpcClient.getCaptureDateJob() : null;
}
