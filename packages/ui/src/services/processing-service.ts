/**
 * Processing service for managing the scanning and duplicate detection pipeline
 * Works both in dev preview (mock fallback) and Electrobun (RPC)
 */

import { getLogger } from "./logger-service";

const log = getLogger("ui:processing");

/** Pipeline processing stages */
export type PipelineStage = "idle" | "scanning" | "metadata" | "hashing" | "detecting" | "complete" | "error";

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
  stageStats?: Record<string, { processed: number; errors: number; skipped: number }>;
}

/** State information for pipeline resumability */
export interface PipelineState {
  hasUnscannedFolders: boolean;
  hasUnhashedFiles: boolean;
  hasUndetectedDuplicates: boolean;
}

/** Results summary statistics (from review query service) */
export interface ResultsSummary {
  pendingSha256: number;
  pendingContentHash: number;
  pendingPhash: number;
  decidedKeep: number;
  decidedDelete: number;
}

/** Processing status response */
export interface ProcessingStatus {
  isRunning: boolean;
  isPaused: boolean;
  progress: PipelineProgress | null;
}

/** RPC client interface for processing operations */
export interface ProcessingRPC {
  startProcessing: (params?: { pauseAfterSegment?: boolean }) => Promise<{ started: boolean; error?: string }>;
  getProcessingStatus: () => Promise<ProcessingStatus>;
  pauseProcessing: () => Promise<{ paused: boolean }>;
  resumeProcessing: () => Promise<{ resumed: boolean }>;
  cancelProcessing: () => Promise<{ cancelled: boolean }>;
  getProcessingState: () => Promise<PipelineState>;
  getReviewSummary: () => Promise<ResultsSummary>;
}

// Module-level RPC client reference
let rpcClient: ProcessingRPC | null = null;

/**
 * Initialize the processing service with an RPC client
 * Call this from mainview.ts when RPC is available
 */
export function initProcessingService(rpc: ProcessingRPC): void {
  rpcClient = rpc;
  log.debug("Processing service initialized with RPC");
}

/**
 * Check if RPC is available
 */
export function hasRPC(): boolean {
  return rpcClient !== null;
}

/**
 * Start the processing pipeline
 */
export async function startProcessing(params?: {
  pauseAfterSegment?: boolean;
}): Promise<{ started: boolean; error?: string }> {
  if (rpcClient) {
    try {
      return await rpcClient.startProcessing(params);
    } catch (error) {
      log.error("Failed to start processing via RPC", error);
      return { started: false, error: error instanceof Error ? error.message : "Unknown error" };
    }
  }

  // Fallback for dev preview - mock response
  log.debug("Processing service: startProcessing (mock)");
  return { started: false, error: "RPC not available in dev mode" };
}

/**
 * Get the current processing status
 */
export async function getProcessingStatus(): Promise<ProcessingStatus> {
  if (rpcClient) {
    try {
      return await rpcClient.getProcessingStatus();
    } catch (error) {
      log.error("Failed to get processing status via RPC", error);
      return { isRunning: false, isPaused: false, progress: null };
    }
  }

  // Fallback for dev preview - mock response
  return { isRunning: false, isPaused: false, progress: null };
}

/**
 * Pause the current processing run
 */
export async function pauseProcessing(): Promise<{ paused: boolean }> {
  if (rpcClient) {
    try {
      return await rpcClient.pauseProcessing();
    } catch (error) {
      log.error("Failed to pause processing via RPC", error);
      return { paused: false };
    }
  }

  // Fallback for dev preview - mock response
  log.debug("Processing service: pauseProcessing (mock)");
  return { paused: false };
}

/**
 * Resume a paused processing run
 */
export async function resumeProcessing(): Promise<{ resumed: boolean }> {
  if (rpcClient) {
    try {
      return await rpcClient.resumeProcessing();
    } catch (error) {
      log.error("Failed to resume processing via RPC", error);
      return { resumed: false };
    }
  }

  // Fallback for dev preview - mock response
  log.debug("Processing service: resumeProcessing (mock)");
  return { resumed: false };
}

/**
 * Cancel the current processing run
 */
export async function cancelProcessing(): Promise<{ cancelled: boolean }> {
  if (rpcClient) {
    try {
      return await rpcClient.cancelProcessing();
    } catch (error) {
      log.error("Failed to cancel processing via RPC", error);
      return { cancelled: false };
    }
  }

  // Fallback for dev preview - mock response
  log.debug("Processing service: cancelProcessing (mock)");
  return { cancelled: false };
}

/**
 * Get the current pipeline state to check if processing is needed
 */
export async function getProcessingState(): Promise<PipelineState> {
  if (rpcClient) {
    try {
      return await rpcClient.getProcessingState();
    } catch (error) {
      log.error("Failed to get processing state via RPC", error);
      return {
        hasUnscannedFolders: false,
        hasUnhashedFiles: false,
        hasUndetectedDuplicates: false,
      };
    }
  }

  // Fallback for dev preview - mock response
  return {
    hasUnscannedFolders: false,
    hasUnhashedFiles: false,
    hasUndetectedDuplicates: false,
  };
}

/**
 * Get review summary statistics
 */
export async function getReviewSummary(): Promise<ResultsSummary> {
  if (rpcClient) {
    try {
      return await rpcClient.getReviewSummary();
    } catch (error) {
      log.error("Failed to get review summary via RPC", error);
      return {
        pendingSha256: 0,
        pendingContentHash: 0,
        pendingPhash: 0,
        decidedKeep: 0,
        decidedDelete: 0,
      };
    }
  }

  // Fallback for dev preview - mock response
  return {
    pendingSha256: 0,
    pendingContentHash: 0,
    pendingPhash: 0,
    decidedKeep: 0,
    decidedDelete: 0,
  };
}
