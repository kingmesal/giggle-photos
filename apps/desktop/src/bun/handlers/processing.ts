import { getLogger } from "@giggle-photos/core/logging/logger";

const log = getLogger("rpc:processing");

import {
  getPipelineState,
  type PipelineProgress,
  type PipelineResult,
  type PipelineState,
  runPipeline,
} from "@giggle-photos/core/scan/processing-pipeline";

/**
 * Track the current pipeline run for long-running operations.
 */
let currentPipelineRun: {
  promise: Promise<PipelineResult>;
  abortController: AbortController;
  progress: PipelineProgress;
  isPaused: boolean;
  pauseAfterSegment: boolean;
} | null = null;

/**
 * Start the processing pipeline.
 * Returns immediately - pipeline runs in background.
 */
export async function startProcessing(params?: {
  pauseAfterSegment?: boolean;
}): Promise<{ started: boolean; error?: string }> {
  log.debug("startProcessing called", params);

  if (currentPipelineRun) {
    // If paused, resume instead of returning an error
    if (currentPipelineRun.isPaused) {
      currentPipelineRun.isPaused = false;
      log.info("Processing resumed");
      return { started: true };
    }
    return { started: false, error: "Processing already in progress" };
  }

  try {
    const abortController = new AbortController();

    const initialProgress: PipelineProgress = {
      stage: "idle",
      stageProgress: 0,
      currentOperation: "Starting...",
      filesProcessed: 0,
      totalFiles: 0,
      duplicatesFound: 0,
      errors: 0,
    };

    const pauseAfterSegment = params?.pauseAfterSegment ?? false;

    const promise = runPipeline({
      signal: abortController.signal,
      pauseAfterSegment,
      onProgress: (progress) => {
        if (currentPipelineRun) {
          currentPipelineRun.progress = progress;
        }
      },
      shouldWait: () => {
        // Pipeline should wait while isPaused is true
        return currentPipelineRun?.isPaused ?? false;
      },
      onWaiting: () => {
        // Called while waiting - ensure isPaused is set
        if (currentPipelineRun && !currentPipelineRun.isPaused) {
          currentPipelineRun.isPaused = true;
        }
      },
    });

    currentPipelineRun = {
      promise,
      abortController,
      progress: initialProgress,
      isPaused: false,
      pauseAfterSegment,
    };

    // Don't await - let it run in background
    promise
      .then((result) => {
        log.info("Pipeline completed successfully", result);
      })
      .catch((error) => {
        log.error("Pipeline failed", error);
      })
      .finally(() => {
        currentPipelineRun = null;
      });

    return { started: true };
  } catch (error) {
    log.error("Failed to start processing", error);
    return { started: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Get the current processing status.
 */
export async function getProcessingStatus(): Promise<{
  isRunning: boolean;
  isPaused: boolean;
  progress: PipelineProgress | null;
}> {
  if (currentPipelineRun) {
    return {
      isRunning: true,
      isPaused: currentPipelineRun.isPaused,
      progress: currentPipelineRun.progress,
    };
  }

  return {
    isRunning: false,
    isPaused: false,
    progress: null,
  };
}

/**
 * Pause the current processing run.
 */
export async function pauseProcessing(): Promise<{ paused: boolean }> {
  if (currentPipelineRun && !currentPipelineRun.isPaused) {
    currentPipelineRun.isPaused = true;
    log.info("Processing paused");
    return { paused: true };
  }

  return { paused: false };
}

/**
 * Resume a paused processing run.
 * Checks if there's new work at an earlier stage (e.g., new folders added)
 * and restarts the pipeline from the beginning if needed.
 */
export async function resumeProcessing(): Promise<{ resumed: boolean; restarted?: boolean }> {
  log.debug("resumeProcessing called");

  if (currentPipelineRun?.isPaused) {
    // Check if there's work at an earlier stage
    const pipelineState = await getPipelineState();
    const currentStage = currentPipelineRun.progress.stage;

    // Determine if we need to restart from an earlier stage
    // Stage order: scanning -> metadata -> hashing -> detecting -> complete
    const stageOrder = ["scanning", "metadata", "hashing", "detecting", "complete"];
    const currentStageIndex = stageOrder.indexOf(currentStage);

    let needsRestart = false;

    // If there are unscanned folders and we're past the scanning stage, need to restart
    if (pipelineState.hasUnscannedFolders && currentStageIndex > 0) {
      log.info("New folders detected, need to restart from scanning stage");
      needsRestart = true;
    }
    // If there are unhashed files and we're past the hashing stage, need to restart
    else if (pipelineState.hasUnhashedFiles && currentStageIndex > 2) {
      log.info("New files need hashing, need to restart from hashing stage");
      needsRestart = true;
    }

    if (needsRestart) {
      // Cancel the current pipeline
      const pauseAfterSegment = currentPipelineRun.pauseAfterSegment;
      currentPipelineRun.abortController.abort();

      // Wait a bit for the pipeline to clean up
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Clear the current run (it should be cleared by the finally block, but just in case)
      currentPipelineRun = null;

      // Start a new pipeline
      log.info("Restarting pipeline from the beginning");
      await startProcessing({ pauseAfterSegment });

      return { resumed: true, restarted: true };
    }

    // No restart needed, just resume normally
    currentPipelineRun.isPaused = false;
    log.info("Processing resumed");
    return { resumed: true, restarted: false };
  }

  return { resumed: false };
}

/**
 * Cancel the current processing run.
 */
export async function cancelProcessing(): Promise<{ cancelled: boolean }> {
  if (currentPipelineRun) {
    currentPipelineRun.abortController.abort();
    log.info("Processing cancellation requested");
    return { cancelled: true };
  }

  return { cancelled: false };
}

/**
 * Get the current pipeline state to check if processing is needed.
 */
export async function getProcessingState(): Promise<PipelineState> {
  log.debug("getProcessingState called");

  try {
    return await getPipelineState();
  } catch (error) {
    log.error("Failed to get processing state", error);
    throw error;
  }
}
