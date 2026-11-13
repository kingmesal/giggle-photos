/** Fake RPC objects and state fixtures for the Processing screen tests. */
import { mock } from "bun:test";
import type {
  PipelineState,
  ProcessingStatus,
  ProcessingViewRPC,
  ResultsSummary,
} from "../../services/processing-view-service";

export const NO_SUMMARY: ResultsSummary = {
  pendingSha256: 0,
  pendingContentHash: 0,
  pendingPhash: 0,
  decidedKeep: 0,
  decidedDelete: 0,
};

export function pipelineState(overrides: Partial<PipelineState> = {}): PipelineState {
  return {
    hasFolders: true,
    hasUnscannedFolders: true,
    hasFilesNeedingMetadata: false,
    hasUnhashedFiles: false,
    hasUndetectedDuplicates: false,
    totalFiles: 0,
    statusCounts: { pending: 0, metadata: 0, hashed: 0, processed: 0, error: 0 },
    ...overrides,
  };
}

export const IDLE: ProcessingStatus = { isRunning: false, isPaused: false, progress: null };

export interface FakeRPCOptions {
  status?: ProcessingStatus | (() => ProcessingStatus);
  state?: PipelineState;
  summary?: ResultsSummary;
}

export function fakeRPC(options: FakeRPCOptions = {}) {
  const status = options.status ?? IDLE;
  const read = () => (typeof status === "function" ? status() : status);
  const rpc = {
    startProcessing: mock(async (_params?: { pauseAfterSegment?: boolean }) => ({ started: true })),
    getProcessingStatus: mock(async () => read()),
    pauseProcessing: mock(async () => ({ paused: true })),
    resumeProcessing: mock(async () => ({ resumed: true })),
    cancelProcessing: mock(async () => ({ cancelled: true })),
    getProcessingState: mock(async () => options.state ?? pipelineState()),
    getReviewSummary: mock(async () => options.summary ?? NO_SUMMARY),
  };
  return rpc satisfies NonNullable<ProcessingViewRPC>;
}
