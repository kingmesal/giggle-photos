/** Pure pipeline helpers for the Processing screen: steps, step status, overall progress, formatting. */
import type {
  PipelineProgress,
  PipelineStage,
  PipelineState,
  ResultsSummary,
} from "../../services/processing-view-service";

export type StepIcon = "folder-open" | "database" | "fingerprint" | "clone" | "circle-check";

export interface PipelineStep {
  id: number;
  stage: PipelineStage;
  title: string;
  description: string;
  icon: StepIcon;
}

export const PIPELINE_STEPS: PipelineStep[] = [
  {
    id: 1,
    stage: "scanning",
    title: "File Discovery",
    description: "Scan folders and identify image files",
    icon: "folder-open",
  },
  {
    id: 2,
    stage: "metadata",
    title: "Metadata Extraction",
    description: "Read EXIF data, dimensions, and file properties",
    icon: "database",
  },
  {
    id: 3,
    stage: "hashing",
    title: "Evaluate and Analyze Media",
    description: "Generate hashes for duplicate detection",
    icon: "fingerprint",
  },
  {
    id: 4,
    stage: "detecting",
    title: "Similarity Analysis",
    description: "Compare hashes and group similar images",
    icon: "clone",
  },
  {
    id: 5,
    stage: "complete",
    title: "Review Duplicates",
    description: "Manual review required — no files will be deleted until you complete this step",
    icon: "circle-check",
  },
];

export type StepStatus = "completed" | "in-progress" | "ready" | "pending";

export function getStepStatus(stepIndex: number, currentStepIndex: number, isRunning: boolean): StepStatus {
  if (stepIndex < currentStepIndex) return "completed";
  if (stepIndex === currentStepIndex) return isRunning ? "in-progress" : "ready";
  return "pending";
}

export function hasPendingWork(state: PipelineState | null): boolean {
  return Boolean(
    state &&
      (state.hasUnscannedFolders ||
        state.hasFilesNeedingMetadata ||
        state.hasUnhashedFiles ||
        state.hasUndetectedDuplicates),
  );
}

export function pendingGroups(summary: ResultsSummary | null): number {
  return summary ? summary.pendingSha256 + summary.pendingContentHash + summary.pendingPhash : 0;
}

/** Index of the current step: from live progress, else derived from the persisted pipeline state. */
export function currentStepIndex(progress: PipelineProgress | null, isRunning: boolean, state: PipelineState): number {
  if (progress) return PIPELINE_STEPS.findIndex((s) => s.stage === progress.stage);
  if (isRunning) return -1;
  if (state.hasUnscannedFolders) return 0;
  if (state.hasFilesNeedingMetadata) return 1;
  if (state.hasUnhashedFiles) return 2;
  if (state.hasUndetectedDuplicates) return 3;
  // All processing stages complete (with or without duplicates to review): at review
  return state.hasFolders ? 5 : -1;
}

/** Paused between stages (stage at 100%): the finished stage counts as done, the next as not running. */
export function isPausedBetweenStages(
  progress: PipelineProgress | null,
  isPaused: boolean,
  isRunning: boolean,
): boolean {
  return Boolean(
    isPaused &&
      isRunning &&
      progress?.stageProgress === 100 &&
      progress.stage !== "complete" &&
      progress.stage !== "error",
  );
}

/** Step id to expand automatically (1-based), or 0 for none. */
export function autoExpandTarget(stepIndex: number, isRunning: boolean): number {
  if (stepIndex < 0) return 0;
  return isRunning ? stepIndex + 1 : Math.min(stepIndex + 1, PIPELINE_STEPS.length);
}

const PROCESSING_STAGES = ["scanning", "metadata", "hashing", "detecting"];
const TOTAL_STAGES = 4;
const STAGE_NAMES: Record<string, string> = {
  scanning: "File Discovery",
  metadata: "Metadata Extraction",
  hashing: "Evaluate and Analyze Media",
  detecting: "Similarity Analysis",
  complete: "Complete",
};

export interface OverallProgress {
  statusText: string;
  percent: number;
  showPercent: boolean;
}

/** Bottom bar: stage-based overall progress across the 4 processing stages. */
export function overallProgress(
  progress: PipelineProgress | null,
  isRunning: boolean,
  isPaused: boolean,
  effectiveStepIndex: number,
  state: PipelineState | null,
): OverallProgress {
  const stageIndex = progress ? PROCESSING_STAGES.indexOf(progress.stage) : -1;
  let completed = stageIndex >= 0 ? stageIndex : progress?.stage === "complete" ? TOTAL_STAGES : 0;
  const stageProgress = progress?.stageProgress ?? 0;
  const pausedAtStageEnd = isPaused && isRunning && stageProgress === 100;
  if (pausedAtStageEnd && stageIndex >= 0) completed = stageIndex + 1;
  // After a restart (no progress), derive completed stages from the persisted state
  if (!progress && !isRunning && effectiveStepIndex > 0 && effectiveStepIndex < PIPELINE_STEPS.length) {
    completed = Math.min(effectiveStepIndex, TOTAL_STAGES);
  }
  const stageName = progress ? STAGE_NAMES[progress.stage] || progress.stage : "";
  // Paused at a stage end: that stage is already counted in `completed`
  const effectiveStageProgress = pausedAtStageEnd && stageIndex >= 0 ? 0 : stageProgress;
  // Clamped: at "complete" the old view added stageProgress (100) on top of 4 completed stages (125%)
  const percent = Math.min(100, Math.round(((completed + effectiveStageProgress / 100) / TOTAL_STAGES) * 100));

  let statusText: string;
  if (progress?.stage === "complete") statusText = "4 of 4 complete";
  else if (pausedAtStageEnd) statusText = `${completed} of ${TOTAL_STAGES} complete`;
  else if (isRunning && stageName)
    statusText = `${completed} of ${TOTAL_STAGES} complete: ${stageName} — ${Math.round(stageProgress)}%`;
  else if (hasPendingWork(state))
    statusText = completed > 0 ? `${completed} of ${TOTAL_STAGES} complete` : "Ready to process";
  else statusText = "No pending work";

  return { statusText, percent, showPercent: isRunning || progress?.stage === "complete" || completed > 0 };
}

const TIMER_NAMES: Record<string, string> = {
  imageMetadata: "Image",
  videoMetadata: "Video",
  sha256: "SHA-256",
  contentHash: "Content hash",
  perceptualHash: "pHash",
};

/** "SHA-256: 12ms avg  |  pHash: 3ms avg" for the non-zero timers. */
export function formatTimings(timings: Record<string, number> | undefined): string[] {
  const entries = Object.entries(timings ?? {}).filter(([, v]) => v > 0);
  return entries.map(
    ([name, avg], idx) =>
      `${TIMER_NAMES[name] ?? name}: ${Math.round(avg)}ms avg${idx < entries.length - 1 ? "  |  " : ""}`,
  );
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return "< 1s";
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) {
    const tenths = Math.floor((ms % 1000) / 100);
    return tenths > 0 ? `${totalSeconds}.${tenths}s` : `${totalSeconds}s`;
  }
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
}
