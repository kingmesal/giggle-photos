/**
 * Processing screen service: RPC client holder, an external store with the pipeline state, and the
 * start/pause/resume calls. Status polling is module-level (outside React) so it keeps running while
 * another screen is shown, and tells review screens to re-read when a run finishes.
 * With no RPC initialised (dev preview, E2E) nothing loads and the screen shows its empty state.
 */
import { createStore, useStore } from "../external/store";
import { notifyReviewDataChanged } from "../state/review-events";
import type { ClipStageStats } from "./clip-service";
import { getLogger } from "./logger-service";
import { getSystemHealth, type SystemHealth } from "./system-health-service";
import type { TakeoutStageStats } from "./takeout-service";

const log = getLogger("ui:processing-view");

/** Pipeline processing stages */
export type PipelineStage = "idle" | "scanning" | "metadata" | "hashing" | "detecting" | "complete" | "error";

type AlgorithmCounts = { computed: number; skipped: number; errors: number };

/** Per-stage completion statistics with optional detailed breakdowns */
export interface StageStatsEntry {
  processed: number;
  errors: number;
  skipped: number;
  images?: number;
  videos?: number;
  errorBreakdown?: Record<string, number>;
  timingMs?: Record<string, number>;
  takeout?: TakeoutStageStats;
  clip?: ClipStageStats | { error: string };
  algorithmStats?: { sha256: AlgorithmCounts; contentHash: AlgorithmCounts; perceptualHash: AlgorithmCounts };
}

/** Progress information for the pipeline */
export interface PipelineProgress {
  stage: PipelineStage;
  stageProgress: number;
  currentOperation: string;
  filesProcessed: number;
  totalFiles: number;
  duplicatesFound: number;
  errors: number;
  /** Per-stage completion stats (populated after each stage completes) */
  stageStats?: Record<string, StageStatsEntry>;
  /** Running average timing per timer bucket (updated during processing) */
  liveTimingMs?: Record<string, number>;
  liveImages?: number;
  liveVideos?: number;
  /** Estimated time remaining for current stage in ms */
  etaMs?: number;
}

export interface ProcessingStatus {
  isRunning: boolean;
  isPaused: boolean;
  progress: PipelineProgress | null;
}

/** State information for pipeline resumability */
export interface PipelineState {
  hasFolders: boolean;
  hasUnscannedFolders: boolean;
  hasFilesNeedingMetadata: boolean;
  hasUnhashedFiles: boolean;
  hasUndetectedDuplicates: boolean;
  totalFiles: number;
  statusCounts: { pending: number; metadata: number; hashed: number; processed: number; error: number };
}

/** Results summary statistics (from review query service) */
export interface ResultsSummary {
  pendingSha256: number;
  pendingContentHash: number;
  pendingPhash: number;
  decidedKeep: number;
  decidedDelete: number;
}

/** RPC surface passed in by mainview.ts (same shape as the Sigment view's). */
export type ProcessingViewRPC = {
  startProcessing: (params?: { pauseAfterSegment?: boolean }) => Promise<{ started: boolean; error?: string }>;
  getProcessingStatus: () => Promise<ProcessingStatus>;
  pauseProcessing: () => Promise<{ paused: boolean }>;
  resumeProcessing: () => Promise<{ resumed: boolean }>;
  cancelProcessing: () => Promise<{ cancelled: boolean }>;
  getProcessingState: () => Promise<PipelineState>;
  getReviewSummary: () => Promise<ResultsSummary>;
} | null;

export interface ProcessingViewState {
  status: ProcessingStatus | null;
  pipelineState: PipelineState | null;
  summary: ResultsSummary | null;
  health: SystemHealth | null;
  error: string | null;
  loading: boolean;
  /** Paused flag; resume leaves it set until a poll reports the pipeline moved on. */
  isPaused: boolean;
  /** "Pause after each step" toggle (default on). */
  pauseAfterSegment: boolean;
}

const INITIAL: ProcessingViewState = {
  status: null,
  pipelineState: null,
  summary: null,
  health: null,
  error: null,
  loading: false,
  isPaused: false,
  pauseAfterSegment: true,
};

const store = createStore<ProcessingViewState>(INITIAL);
let rpcClient: ProcessingViewRPC = null;
let pollInterval: ReturnType<typeof setInterval> | null = null;

const message = (error: unknown, fallback: string): string => (error instanceof Error ? error.message : fallback);

function patch(next: Partial<ProcessingViewState>): void {
  store.set((prev) => ({ ...prev, ...next }));
}

/** Initialize the processing service with an RPC client (called from mainview.ts). */
export function initProcessingService(rpc: ProcessingViewRPC): void {
  rpcClient = rpc;
}

export function hasProcessingRPC(): boolean {
  return rpcClient !== null;
}

/** Processing screen state, re-rendering on change. */
export function useProcessingViewState(): ProcessingViewState {
  return useStore(store);
}

export function setPauseAfterSegment(value: boolean): void {
  patch({ pauseAfterSegment: value });
}

const PROGRESS_FIELDS = [
  "stage",
  "stageProgress",
  "filesProcessed",
  "totalFiles",
  "duplicatesFound",
  "errors",
  "liveImages",
  "liveVideos",
  "etaMs",
] as const;

/** Whether a polled status differs meaningfully (timings compared rounded to the ms). */
export function statusChanged(prev: ProcessingStatus | null, next: ProcessingStatus): boolean {
  if (!prev) return true;
  if (prev.isRunning !== next.isRunning || prev.isPaused !== next.isPaused) return true;
  const a = prev.progress;
  const b = next.progress;
  if (!a || !b) return a !== b;
  if (PROGRESS_FIELDS.some((field) => a[field] !== b[field])) return true;
  const at = a.liveTimingMs;
  const bt = b.liveTimingMs;
  if (!at || !bt) return !at !== !bt;
  const keys = new Set([...Object.keys(at), ...Object.keys(bt)]);
  return [...keys].some((k) => Math.round(at[k] ?? 0) !== Math.round(bt[k] ?? 0));
}

/** Apply a polled status only if it differs (avoids re-rendering on identical polls). */
function applyStatusUpdate(status: ProcessingStatus): void {
  const prev = store.get();
  const next: Partial<ProcessingViewState> = {};
  if (statusChanged(prev.status, status)) next.status = status;
  if (status.isPaused !== prev.isPaused) next.isPaused = status.isPaused;
  if (Object.keys(next).length > 0) patch(next);
}

function stopPolling(): void {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
}

async function pollOnce(): Promise<void> {
  const rpc = rpcClient;
  if (!rpc) return;
  try {
    const status = await rpc.getProcessingStatus();
    applyStatusUpdate(status);
    if (status.progress?.stage === "complete" && !status.isRunning) {
      patch({ summary: await rpc.getReviewSummary() });
    }
    if (!status.isRunning && pollInterval) {
      stopPolling();
      notifyReviewDataChanged();
      await loadProcessingState();
    }
  } catch (error) {
    log.error("Failed to get processing status", error);
  }
}

function startPolling(): void {
  if (pollInterval) return;
  // Immediate first poll: don't wait 500ms for the first update
  rpcClient
    ?.getProcessingStatus()
    .then(applyStatusUpdate)
    .catch((error) => log.error("Failed initial status poll", error));
  pollInterval = setInterval(() => void pollOnce(), 500);
}

/** Load status, pipeline state, review summary and system health. No-op without RPC. */
export async function loadProcessingState(): Promise<void> {
  const rpc = rpcClient;
  if (!rpc) return;
  patch({ loading: true, error: null });
  try {
    const [status, pipelineState, summary, health] = await Promise.all([
      rpc.getProcessingStatus(),
      rpc.getProcessingState(),
      rpc.getReviewSummary(),
      getSystemHealth(),
    ]);
    patch({ status, pipelineState, summary, health });
    if (status.isRunning) startPolling();
  } catch (error) {
    log.error("Failed to load initial state", error);
    patch({ error: message(error, "Failed to load processing state") });
  } finally {
    patch({ loading: false });
  }
}

export async function startProcessing(): Promise<void> {
  const rpc = rpcClient;
  if (!rpc) {
    patch({ error: "RPC client not initialized" });
    return;
  }
  patch({ error: null, isPaused: false });
  try {
    const result = await rpc.startProcessing({ pauseAfterSegment: store.get().pauseAfterSegment });
    if (!result.started) {
      patch({ error: result.error || "Failed to start processing" });
      return;
    }
    // Fetch status immediately before starting the polling interval
    patch({ status: await rpc.getProcessingStatus() });
    startPolling();
  } catch (error) {
    log.error("Failed to start processing", error);
    patch({ error: message(error, "Failed to start processing") });
  }
}

export async function pauseProcessing(): Promise<void> {
  if (!rpcClient) return;
  try {
    const result = await rpcClient.pauseProcessing();
    if (result.paused) patch({ isPaused: true });
  } catch (error) {
    log.error("Failed to pause processing", error);
  }
}

export async function resumeProcessing(): Promise<void> {
  if (!rpcClient) return;
  try {
    const result = await rpcClient.resumeProcessing();
    if (result.resumed) {
      // Keep isPaused until the next poll reports the move, to avoid a flash of the old stage.
      startPolling();
    } else {
      log.warn("Resume returned false — pipeline may have already finished");
      patch({ isPaused: false });
      stopPolling();
      await loadProcessingState();
    }
  } catch (error) {
    log.error("Failed to resume processing", error);
    patch({ error: message(error, "Failed to resume processing") });
  }
}

/** Tests only: forget the RPC client, stop polling and clear state. */
export function resetProcessingViewForTests(): void {
  stopPolling();
  rpcClient = null;
  store.set(INITIAL);
}
