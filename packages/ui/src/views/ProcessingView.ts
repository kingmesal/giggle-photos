/**
 * Processing view component
 * Displays scanning progress and processing status
 * Note: HTML element functions are globals provided by Sigment
 */
import { createSignal, signal } from "sigment";
import { getLogger } from "../services/logger-service";
import { getSystemHealth as getSystemHealthService, type SystemHealth } from "../services/system-health-service";
import { navigateTo } from "../state/navigation";
import { errorCategoryLabel } from "./error-labels";

const log = getLogger("ui:processing-view");

/** Pipeline processing stages */
type PipelineStage = "idle" | "scanning" | "metadata" | "hashing" | "detecting" | "complete" | "error";

/** Per-stage completion statistics with optional detailed breakdowns */
interface StageStatsEntry {
  processed: number;
  errors: number;
  skipped: number;
  images?: number;
  videos?: number;
  errorBreakdown?: Record<string, number>;
  timingMs?: Record<string, number>;
  algorithmStats?: {
    sha256: { computed: number; skipped: number; errors: number };
    contentHash: { computed: number; skipped: number; errors: number };
    perceptualHash: { computed: number; skipped: number; errors: number };
  };
}

/** Progress information for the pipeline */
interface PipelineProgress {
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
  /** Image count processed so far in current stage */
  liveImages?: number;
  /** Video count processed so far in current stage */
  liveVideos?: number;
  /** Estimated time remaining for current stage in ms */
  etaMs?: number;
}

/** Processing status response */
interface ProcessingStatus {
  isRunning: boolean;
  isPaused: boolean;
  progress: PipelineProgress | null;
}

/** State information for pipeline resumability */
interface PipelineState {
  hasFolders: boolean;
  hasUnscannedFolders: boolean;
  hasFilesNeedingMetadata: boolean;
  hasUnhashedFiles: boolean;
  hasUndetectedDuplicates: boolean;
  totalFiles: number;
  statusCounts: {
    pending: number;
    metadata: number;
    hashed: number;
    processed: number;
    error: number;
  };
}

/** Results summary statistics (from review query service) */
interface ResultsSummary {
  pendingSha256: number;
  pendingContentHash: number;
  pendingPhash: number;
  decidedKeep: number;
  decidedDelete: number;
}

/** Pipeline result from a completed run */
interface PipelineResult {
  totalFiles: number;
  phashPairsComputed: number;
  totalComparisons: number;
  errors: number;
  duration: number;
}

// Signals for reactive state
const [getStatus, setStatus] = signal<ProcessingStatus | null>(null);
const [getPipelineState, setPipelineState] = signal<PipelineState | null>(null);
const [getResultsSummary, setResultsSummary] = signal<ResultsSummary | null>(null);
const [_getLastResult, setLastResult] = signal<PipelineResult | null>(null);
const [getError, setError] = signal<string | null>(null);
const [getLoading, setLoading] = signal<boolean>(false);
const [getSystemHealth, setSystemHealth] = signal<SystemHealth | null>(null);

// Task #1: Collapsed state for pipeline panels - tracks which step IDs are expanded
const [getExpandedSteps, setExpandedSteps] = createSignal<Set<number>>(new Set([1]));

// Task #3: Pause after each segment toggle (default ON)
const [getPauseAfterSegment, setPauseAfterSegment] = signal<boolean>(true);

// Track if processing is paused (different from cancelled)
const [getIsPaused, setIsPaused] = signal<boolean>(false);

// RPC client reference (will be initialized from mainview.ts)
let rpcClient: {
  startProcessing: (params?: { pauseAfterSegment?: boolean }) => Promise<{ started: boolean; error?: string }>;
  getProcessingStatus: () => Promise<ProcessingStatus>;
  pauseProcessing: () => Promise<{ paused: boolean }>;
  resumeProcessing: () => Promise<{ resumed: boolean }>;
  cancelProcessing: () => Promise<{ cancelled: boolean }>;
  getProcessingState: () => Promise<PipelineState>;
  getReviewSummary: () => Promise<ResultsSummary>;
} | null = null;

// Polling interval reference
let pollInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Initialize the processing service with an RPC client
 */
export function initProcessingService(rpc: typeof rpcClient): void {
  rpcClient = rpc;
}

/**
 * Check if two ProcessingStatus objects are meaningfully different.
 * Avoids unnecessary signal updates (and DOM re-renders) when polling
 * returns the same state.
 */
function statusChanged(prev: ProcessingStatus | null, next: ProcessingStatus): boolean {
  if (!prev) return true;
  if (prev.isRunning !== next.isRunning) return true;
  if (prev.isPaused !== next.isPaused) return true;
  if (!prev.progress && next.progress) return true;
  if (prev.progress && !next.progress) return true;
  if (prev.progress && next.progress) {
    if (prev.progress.stage !== next.progress.stage) return true;
    if (prev.progress.stageProgress !== next.progress.stageProgress) return true;
    if (prev.progress.filesProcessed !== next.progress.filesProcessed) return true;
    if (prev.progress.totalFiles !== next.progress.totalFiles) return true;
    if (prev.progress.duplicatesFound !== next.progress.duplicatesFound) return true;
    if (prev.progress.errors !== next.progress.errors) return true;
    if (prev.progress.liveImages !== next.progress.liveImages) return true;
    if (prev.progress.liveVideos !== next.progress.liveVideos) return true;
    if (prev.progress.etaMs !== next.progress.etaMs) return true;
    // Check liveTimingMs changes (shallow key comparison)
    const prevTiming = prev.progress.liveTimingMs;
    const nextTiming = next.progress.liveTimingMs;
    if (!prevTiming !== !nextTiming) return true;
    if (prevTiming && nextTiming) {
      const keys = new Set([...Object.keys(prevTiming), ...Object.keys(nextTiming)]);
      for (const k of keys) {
        if (Math.round(prevTiming[k] ?? 0) !== Math.round(nextTiming[k] ?? 0)) return true;
      }
    }
  }
  return false;
}

/**
 * Apply a status update only if it differs from the current state.
 */
function applyStatusUpdate(status: ProcessingStatus): void {
  if (statusChanged(getStatus(), status)) {
    setStatus(status);
  }
  if (status.isPaused !== getIsPaused()) {
    setIsPaused(status.isPaused);
  }
}

/** Map internal timer names to human-readable labels */
function formatTimerName(name: string): string {
  const names: Record<string, string> = {
    imageMetadata: "Image",
    videoMetadata: "Video",
    sha256: "SHA-256",
    contentHash: "Content hash",
    perceptualHash: "pHash",
  };
  return names[name] ?? name;
}

/** Format a duration in milliseconds to a human-readable string */
function formatDuration(ms: number): string {
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

/**
 * Start polling for status updates
 */
function startPolling(): void {
  if (pollInterval) return;

  // Immediate first poll — don't wait 500ms for the first update
  (async () => {
    if (!rpcClient) return;
    try {
      const status = await rpcClient.getProcessingStatus();
      applyStatusUpdate(status);
    } catch (error) {
      log.error("Failed initial status poll", error);
    }
  })();

  pollInterval = setInterval(async () => {
    if (!rpcClient) return;

    try {
      const status = await rpcClient.getProcessingStatus();
      applyStatusUpdate(status);

      // Store the last result when processing completes
      if (status.progress && status.progress.stage === "complete" && !status.isRunning) {
        setLastResult({
          totalFiles: status.progress.totalFiles,
          phashPairsComputed: status.progress.duplicatesFound,
          totalComparisons: 0,
          errors: status.progress.errors,
          duration: 0,
        });
        const summary = await rpcClient.getReviewSummary();
        setResultsSummary(summary);
      }

      // Stop polling when not running
      if (!status.isRunning) {
        stopPolling();
        await loadInitialState();
      }
    } catch (error) {
      log.error("Failed to get processing status", error);
    }
  }, 500);
}

/**
 * Stop polling for status updates
 */
function stopPolling(): void {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
}

/**
 * Load initial state from RPC
 */
async function loadInitialState(): Promise<void> {
  if (!rpcClient) return;

  setLoading(true);
  setError(null);

  try {
    const [status, pipelineState, summary, health] = await Promise.all([
      rpcClient.getProcessingStatus(),
      rpcClient.getProcessingState(),
      rpcClient.getReviewSummary(),
      getSystemHealthService(),
    ]);

    setStatus(status);
    setPipelineState(pipelineState);
    setResultsSummary(summary);
    setSystemHealth(health);

    if (status.isRunning) {
      startPolling();
    }
  } catch (error) {
    log.error("Failed to load initial state", error);
    setError(error instanceof Error ? error.message : "Failed to load processing state");
  } finally {
    setLoading(false);
  }
}

/**
 * Handle starting processing
 */
async function handleStartProcessing(): Promise<void> {
  if (!rpcClient) {
    setError("RPC client not initialized");
    return;
  }

  setError(null);
  setLastResult(null);
  setIsPaused(false);

  try {
    const pauseAfterSegment = getPauseAfterSegment();
    const result = await rpcClient.startProcessing({ pauseAfterSegment });

    if (!result.started) {
      setError(result.error || "Failed to start processing");
      return;
    }

    // Fetch status immediately before starting polling interval
    const status = await rpcClient.getProcessingStatus();
    setStatus(status);
    startPolling();
  } catch (error) {
    log.error("Failed to start processing", error);
    setError(error instanceof Error ? error.message : "Failed to start processing");
  }
}

/**
 * Handle pausing processing
 */
async function handlePauseProcessing(): Promise<void> {
  if (!rpcClient) return;

  try {
    const result = await rpcClient.pauseProcessing();
    if (result.paused) {
      setIsPaused(true);
    }
  } catch (error) {
    log.error("Failed to pause processing", error);
  }
}

/**
 * Handle resuming processing
 */
async function handleResumeProcessing(): Promise<void> {
  if (!rpcClient) return;

  try {
    const result = await rpcClient.resumeProcessing();
    if (result.resumed) {
      // Don't clear isPaused immediately — let the next poll update it
      // naturally once the pipeline has actually moved to the next stage.
      // This avoids a brief flash back to "in-progress" on the old stage.
      startPolling();
    } else {
      log.warn("Resume returned false — pipeline may have already finished");
      // Pipeline might have finished while paused; refresh full state
      setIsPaused(false);
      stopPolling();
      await loadInitialState();
    }
  } catch (error) {
    log.error("Failed to resume processing", error);
    setError(error instanceof Error ? error.message : "Failed to resume processing");
  }
}

/** Step definition for the pipeline */
interface PipelineStep {
  id: number;
  stage: PipelineStage;
  title: string;
  description: string;
  icon: string;
}

const PIPELINE_STEPS: PipelineStep[] = [
  {
    id: 1,
    stage: "scanning",
    title: "File Discovery",
    description: "Scan folders and identify image files",
    icon: "fa-folder-open",
  },
  {
    id: 2,
    stage: "metadata",
    title: "Metadata Extraction",
    description: "Read EXIF data, dimensions, and file properties",
    icon: "fa-database",
  },
  {
    id: 3,
    stage: "hashing",
    title: "Evaluate and Analyze Media",
    description: "Generate hashes for duplicate detection",
    icon: "fa-fingerprint",
  },
  {
    id: 4,
    stage: "detecting",
    title: "Similarity Analysis",
    description: "Compare hashes and group similar images",
    icon: "fa-clone",
  },
  {
    id: 5,
    stage: "complete",
    title: "Review Duplicates",
    description: "Manual review required — no files will be deleted until you complete this step",
    icon: "fa-circle-check",
  },
];

/** Get the current step index based on stage */
function getStepIndex(stage: PipelineStage): number {
  const idx = PIPELINE_STEPS.findIndex((s) => s.stage === stage);
  return idx >= 0 ? idx : -1;
}

// Track the last auto-expanded step to avoid infinite loops
let lastAutoExpandedStep: number | null = null;

/**
 * Update expanded steps based on processing state
 * - When running: expand the currently active step
 * - When not running: expand the current/ready step (e.g., next step after completion, or review step)
 * Only updates if the target step changed to avoid render loops.
 */
function updateExpandedSteps(currentStepIndex: number, isRunning: boolean): void {
  let targetStepId: number;

  if (isRunning && currentStepIndex >= 0) {
    // While running, expand the current step (step IDs are 1-based)
    targetStepId = currentStepIndex + 1;
  } else if (!isRunning && currentStepIndex >= 0) {
    // When not running but there's a relevant step (ready, or all complete),
    // expand it so the user can see the state
    targetStepId = Math.min(currentStepIndex + 1, PIPELINE_STEPS.length);
  } else {
    targetStepId = 0; // Nothing to expand
  }

  // Only update if the target step changed to avoid infinite render loops
  if (targetStepId !== lastAutoExpandedStep) {
    lastAutoExpandedStep = targetStepId;
    const newExpanded = new Set<number>();
    if (targetStepId > 0) {
      newExpanded.add(targetStepId);
    }
    setExpandedSteps(newExpanded);
  }
}

/**
 * Toggle a specific step's expanded state
 */
function toggleStepExpanded(stepId: number): void {
  const current = getExpandedSteps();
  const newExpanded = new Set(current);

  if (newExpanded.has(stepId)) {
    newExpanded.delete(stepId);
  } else {
    newExpanded.add(stepId);
  }

  setExpandedSteps(newExpanded);
}

/** Determine step status */
type StepStatus = "completed" | "in-progress" | "ready" | "pending";

function getStepStatus(stepIndex: number, currentStepIndex: number, isRunning: boolean): StepStatus {
  if (stepIndex < currentStepIndex) return "completed";
  if (stepIndex === currentStepIndex && isRunning) return "in-progress";
  if (stepIndex === currentStepIndex && !isRunning) return "ready";
  return "pending";
}

/**
 * Render a single pipeline step
 * - Pending items: no expand/collapse, just title
 * - Running items: always show details (auto-expanded)
 * - Completed items: can be manually expanded/collapsed
 */
function PipelineStepComponent(
  step: PipelineStep,
  stepIndex: number,
  currentStepIndex: number,
  isRunning: boolean,
  isLastStep: boolean,
  progress: PipelineProgress | null,
  _state: PipelineState | null, // kept for potential future use
  summary: ResultsSummary | null,
  isExpanded: boolean,
) {
  const status = getStepStatus(stepIndex, currentStepIndex, isRunning);

  // Pending items are not expandable - they have no content to show
  const isExpandable = status !== "pending";
  // Running items are always expanded
  const shouldShowContent = status === "in-progress" || (isExpandable && isExpanded);

  // Determine circle styling
  let circleClass = "";
  let iconContent: HTMLElement;
  let lineClass = "bg-zinc-300 dark:bg-zinc-600";

  if (status === "completed") {
    circleClass = "bg-emerald-500";
    iconContent = i({ class: "fadr fa-check text-white" });
    lineClass = "bg-emerald-500";
  } else if (status === "in-progress") {
    circleClass = "bg-blue-500";
    iconContent = i({ class: `fadr ${step.icon} fa-beat-fade text-white` });
    lineClass = "bg-gradient-to-b from-blue-500 to-zinc-300 dark:to-zinc-600";
  } else if (status === "ready") {
    circleClass = "bg-surface-card border-2 border-blue-500";
    iconContent = span({ class: "text-sm font-semibold text-accent-blue" }, String(step.id));
    lineClass = "bg-zinc-300 dark:bg-zinc-600";
  } else {
    circleClass = "bg-surface-inset border-2 border-zinc-300 dark:border-zinc-600";
    iconContent = span({ class: "text-sm font-semibold text-fg-muted" }, String(step.id));
  }

  // Title color
  const titleClass =
    status === "completed"
      ? "text-accent-green"
      : status === "in-progress" || status === "ready"
        ? "text-accent-blue"
        : "text-fg-muted";
  const descClass = status === "pending" ? "text-fg-faint" : "text-fg-muted";

  // Status badge
  let badgeClass = "";
  let badgeText = "";
  if (status === "completed") {
    badgeClass = "bg-emerald-500/20 text-accent-green";
    badgeText = "Completed";
  } else if (status === "in-progress") {
    badgeClass = "bg-blue-500/20 text-accent-blue";
    badgeText = "In Progress";
  } else if (status === "ready") {
    badgeClass = "bg-blue-500/20 text-accent-blue";
    badgeText = "Ready";
  } else {
    badgeClass = "bg-surface-inset text-fg-muted";
    badgeText = "Pending";
  }

  // Build content based on step and status (only for non-pending)
  let contentArea: HTMLElement | null = null;

  if (status === "completed") {
    // Show completion stats for scanning step
    if (step.stage === "scanning" && progress) {
      const scanStats = progress.stageStats?.scanning;
      contentArea = div(
        {
          class:
            "mt-3 p-3 rounded-lg bg-zinc-200/50 dark:bg-zinc-700/50 border border-zinc-300/50 dark:border-zinc-600/50",
        },
        div(
          { class: "flex items-center justify-between text-sm" },
          span({ class: "text-fg-muted" }, "Total files found"),
          span({ class: "font-medium text-fg-2" }, String(progress.totalFiles)),
        ),
        scanStats && (scanStats.images || scanStats.videos)
          ? div(
              { class: "flex items-center gap-4 text-sm text-fg-3 mt-1" },
              scanStats.images ? span({}, `${scanStats.images} images`) : null,
              scanStats.videos ? span({}, `${scanStats.videos} videos`) : null,
            )
          : null,
      );
    } else if (step.stage === "scanning" && !progress && _state && _state.totalFiles > 0) {
      // After restart: show file count from PipelineState
      contentArea = div(
        {
          class:
            "mt-3 p-3 rounded-lg bg-zinc-200/50 dark:bg-zinc-700/50 border border-zinc-300/50 dark:border-zinc-600/50",
        },
        div(
          { class: "flex items-center justify-between text-sm" },
          span({ class: "text-fg-muted" }, "Total files found"),
          span({ class: "font-medium text-fg-2" }, String(_state.totalFiles)),
        ),
      );
    } else if (progress?.stageStats?.[step.stage]) {
      // Show per-stage stats when available (during active run)
      // biome-ignore lint/style/noNonNullAssertion: guarded by the `else if` condition above
      const stats = progress.stageStats[step.stage]!;

      // File type row (if image/video counts available)
      const fileTypeRow =
        stats.images != null || stats.videos != null
          ? div(
              { class: "flex items-center gap-4 text-sm mb-1" },
              stats.images != null && stats.images > 0
                ? div(
                    {},
                    span({ class: "text-fg-3" }, "Images: "),
                    span({ class: "text-fg-2 font-medium" }, String(stats.images)),
                  )
                : null,
              stats.videos != null && stats.videos > 0
                ? div(
                    {},
                    span({ class: "text-fg-3" }, "Videos: "),
                    span({ class: "text-fg-2 font-medium" }, String(stats.videos)),
                  )
                : null,
              div(
                {},
                span({ class: "text-fg-3" }, "Total: "),
                span({ class: "text-fg-2 font-medium" }, String(stats.processed)),
              ),
            )
          : div(
              { class: "flex items-center gap-4 text-sm mb-1" },
              div(
                {},
                span({ class: "text-fg-3" }, "Processed: "),
                span({ class: "text-fg-2 font-medium" }, String(stats.processed)),
              ),
            );

      // Timing row
      const timingRow =
        stats.timingMs && Object.keys(stats.timingMs).length > 0
          ? div(
              { class: "text-sm text-fg-3 mb-1" },
              ...Object.entries(stats.timingMs)
                .filter(([, v]) => v > 0)
                .map(([name, avg], idx, arr) =>
                  span({}, `${formatTimerName(name)}: ${Math.round(avg)}ms avg${idx < arr.length - 1 ? "  |  " : ""}`),
                ),
            )
          : null;

      // Error breakdown
      const errorRow =
        stats.errors > 0
          ? div(
              { class: "flex items-center gap-4 text-sm" },
              div(
                {},
                span({ class: "text-fg-3" }, "Errors: "),
                span({ class: "text-accent-amber" }, String(stats.errors)),
              ),
              stats.skipped > 0
                ? div(
                    {},
                    span({ class: "text-fg-3" }, "Skipped: "),
                    span({ class: "text-fg-3" }, String(stats.skipped)),
                  )
                : null,
            )
          : stats.skipped > 0
            ? div(
                { class: "flex items-center gap-4 text-sm" },
                div({}, span({ class: "text-fg-3" }, "Skipped: "), span({ class: "text-fg-3" }, String(stats.skipped))),
              )
            : null;

      const errorBreakdownRow =
        stats.errorBreakdown && Object.keys(stats.errorBreakdown).length > 0
          ? div(
              { class: "text-sm text-accent-amber mt-1" },
              ...Object.entries(stats.errorBreakdown).map(([category, count]) =>
                span({ class: "mr-3" }, `${errorCategoryLabel(category)}: ${count}`),
              ),
            )
          : null;

      contentArea = div(
        {
          class:
            "mt-3 p-3 rounded-lg bg-zinc-200/50 dark:bg-zinc-700/50 border border-zinc-300/50 dark:border-zinc-600/50",
        },
        div(
          { class: "flex items-center gap-2 text-sm text-fg-muted mb-2" },
          i({ class: "fadr fa-circle-check text-accent-green" }),
          "Step completed successfully",
        ),
        fileTypeRow,
        timingRow,
        errorRow,
        errorBreakdownRow,
      );
    } else if (!progress && _state && _state.totalFiles > 0) {
      // After restart: derive file count for completed non-scanning stages from statusCounts
      // Files past a stage = files at that stage's status + all later statuses
      const sc = _state.statusCounts;
      let filesCompleted = 0;
      if (step.stage === "metadata") {
        // Files that have completed metadata: metadata + hashed + processed
        filesCompleted = sc.metadata + sc.hashed + sc.processed;
      } else if (step.stage === "hashing") {
        // Files that have completed hashing: hashed + processed
        filesCompleted = sc.hashed + sc.processed;
      } else if (step.stage === "detecting") {
        // Files that have completed detection: processed
        filesCompleted = sc.processed;
      }
      contentArea = div(
        {
          class:
            "mt-3 p-3 rounded-lg bg-zinc-200/50 dark:bg-zinc-700/50 border border-zinc-300/50 dark:border-zinc-600/50",
        },
        div(
          { class: "flex items-center gap-2 text-sm text-fg-muted mb-2" },
          i({ class: "fadr fa-circle-check text-accent-green" }),
          "Step completed successfully",
        ),
        div(
          { class: "flex items-center gap-4 text-sm" },
          div(
            {},
            span({ class: "text-fg-3" }, "Files: "),
            span({ class: "text-fg-2 font-medium" }, String(filesCompleted)),
          ),
          sc.error > 0
            ? div({}, span({ class: "text-fg-3" }, "Errors: "), span({ class: "text-accent-amber" }, String(sc.error)))
            : null,
        ),
      );
    } else {
      // Fallback
      contentArea = div(
        {
          class:
            "mt-3 p-3 rounded-lg bg-zinc-200/50 dark:bg-zinc-700/50 border border-zinc-300/50 dark:border-zinc-600/50 text-sm text-fg-muted",
        },
        i({ class: "fadr fa-circle-check text-accent-green mr-2" }),
        "Step completed successfully",
      );
    }
  } else if (status === "in-progress" && progress) {
    const progressPercent = Math.round(progress.stageProgress);

    // Live image/video counts
    const hasLiveCounts = progress.liveImages != null || progress.liveVideos != null;
    const liveCountsRow = hasLiveCounts
      ? div(
          { class: "flex items-center gap-3 text-sm text-fg-3 mt-2" },
          progress.liveImages != null && progress.liveImages > 0 ? span({}, `${progress.liveImages} images`) : null,
          progress.liveVideos != null && progress.liveVideos > 0 ? span({}, `${progress.liveVideos} videos`) : null,
        )
      : null;

    // Live timing row
    const hasLiveTiming = progress.liveTimingMs && Object.values(progress.liveTimingMs).some((v) => v > 0);
    const liveTimingRow = hasLiveTiming
      ? div(
          { class: "text-sm text-fg-3 mt-1" },
          ...Object.entries(progress.liveTimingMs ?? {})
            .filter(([, v]) => v > 0)
            .map(([name, avg], idx, arr) =>
              span({}, `${formatTimerName(name)}: ${Math.round(avg)}ms avg${idx < arr.length - 1 ? "  |  " : ""}`),
            ),
        )
      : null;

    // ETA row
    const etaRow =
      progress.etaMs != null && progress.etaMs > 0
        ? div(
            { class: "text-sm text-accent-blue mt-1" },
            i({ class: "fadr fa-clock mr-1" }),
            `Estimated time remaining: ${formatDuration(progress.etaMs)}`,
          )
        : null;

    contentArea = div(
      { class: "mt-3 space-y-2" },
      div(
        {
          class: "p-3 rounded-lg bg-zinc-200/50 dark:bg-zinc-700/50 border border-zinc-300/50 dark:border-zinc-600/50",
        },
        div(
          { class: "flex items-center justify-between text-sm mb-2" },
          span({ class: "text-fg-muted" }, "Processing files..."),
          span({ class: "font-medium text-fg-2" }, `${progressPercent}%`),
        ),
        div(
          { class: "h-2 bg-zinc-300 dark:bg-zinc-600 rounded-full overflow-hidden" },
          (() => {
            const bar = div({ class: "h-full bg-blue-500 rounded-full" });
            bar.style.width = `${progressPercent}%`;
            return bar;
          })(),
        ),
        progress.totalFiles > 0
          ? div(
              { class: "flex items-center justify-between text-sm text-fg-3 mt-2" },
              span({}, `${progress.filesProcessed} / ${progress.totalFiles} files`),
            )
          : null,
        liveCountsRow,
        liveTimingRow,
        etaRow,
      ),
      progress.currentOperation
        ? div(
            { class: "px-3 py-2 rounded bg-zinc-200/30 dark:bg-zinc-700/30 text-sm text-fg-3 font-mono truncate" },
            i({ class: "fadr fa-arrow-right mr-1" }),
            progress.currentOperation,
          )
        : null,
    );
  } else if (status === "ready") {
    // Determine file count to show for the ready step
    let readyFileCount = 0;
    if (progress && progress.totalFiles > 0) {
      readyFileCount = progress.totalFiles;
    } else if (_state && _state.totalFiles > 0) {
      // After restart: derive count of files needing this step from statusCounts
      const sc = _state.statusCounts;
      if (step.stage === "scanning") {
        readyFileCount = 0; // Don't know until scanning runs
      } else if (step.stage === "metadata") {
        readyFileCount = sc.pending;
      } else if (step.stage === "hashing") {
        readyFileCount = sc.metadata;
      } else if (step.stage === "detecting") {
        readyFileCount = sc.hashed;
      }
    }

    contentArea = div(
      { class: "mt-3 p-3 rounded-lg bg-blue-500/10 border border-blue-500/20 text-sm text-accent-blue" },
      i({ class: "fadr fa-circle-play mr-2" }),
      readyFileCount > 0 ? `Ready — ${readyFileCount} files to process` : "Ready to process",
    );
  }
  // No content for pending items

  // Special content for the Review & Clean step when complete
  if (step.stage === "complete") {
    const totalPendingGroups = summary ? summary.pendingSha256 + summary.pendingContentHash + summary.pendingPhash : 0;
    const totalDecisions = summary ? summary.decidedKeep + summary.decidedDelete : 0;
    if (summary && (totalPendingGroups > 0 || totalDecisions > 0)) {
      // Has duplicates to review
      contentArea = div(
        { class: "mt-3 p-4 rounded-lg bg-emerald-500/10 border border-emerald-500/30" },
        div(
          { class: "flex items-center gap-3 mb-3" },
          i({ class: "fadr fa-circle-check text-accent-green text-xl" }),
          span({ class: "text-accent-green font-medium" }, "All processing is complete!"),
        ),
        p(
          { class: "text-fg-3 text-sm mb-3" },
          "Review all potential duplicates in the Duplicates tab to decide which files to keep.",
        ),
        div(
          { class: "flex items-center justify-between text-sm pt-3 border-t border-emerald-500/20" },
          div(
            { class: "flex items-center gap-4" },
            span(
              { class: "text-fg-muted" },
              `${totalPendingGroups} pending group${totalPendingGroups !== 1 ? "s" : ""} to review`,
            ),
            totalDecisions > 0 ? span({ class: "text-fg-3" }, "•") : null,
            totalDecisions > 0
              ? span({ class: "text-fg-muted" }, `${totalDecisions} decision${totalDecisions !== 1 ? "s" : ""} made`)
              : null,
          ),
        ),
      );
    } else if (status === "completed") {
      // Processing complete but no duplicates found
      contentArea = div(
        { class: "mt-3 p-4 rounded-lg bg-emerald-500/10 border border-emerald-500/30" },
        div(
          { class: "flex items-center gap-3" },
          i({ class: "fadr fa-circle-check text-accent-green text-xl" }),
          div(
            {},
            span({ class: "text-accent-green font-medium block" }, "All processing is complete!"),
            span({ class: "text-fg-muted text-sm" }, "No duplicate files were found in your folders."),
          ),
        ),
      );
    }
  }

  // Chevron icon for expand/collapse (only for expandable items)
  const chevronIcon = isExpandable
    ? i({
        class: `fadr fa-chevron-${shouldShowContent ? "down" : "right"} text-fg-faint text-xs transition-transform`,
      })
    : null;

  return div(
    { class: "relative" },
    div(
      { class: "flex items-start gap-4" },
      // Left column: circle and connecting line
      div(
        { class: "flex flex-col items-center" },
        div({ class: `w-10 h-10 rounded-full ${circleClass} flex items-center justify-center` }, iconContent),
        !isLastStep
          ? div({
              class: `w-0.5 ${shouldShowContent && contentArea ? "h-full" : "h-8"} ${lineClass} mt-2`,
            })
          : null,
      ),
      // Right column: content
      div(
        { class: `flex-1 ${isLastStep ? "" : "pb-4"}` },
        // Header - clickable only for expandable items
        div(
          {
            class: `flex items-center justify-between ${isExpandable ? "cursor-pointer hover:bg-zinc-200/30 dark:hover:bg-zinc-700/30" : ""} -mx-2 px-2 py-1 rounded-lg`,
            onclick: isExpandable ? () => toggleStepExpanded(step.id) : undefined,
          },
          div(
            { class: "flex items-center gap-2" },
            // Spacer for alignment when no chevron
            chevronIcon ?? div({ class: "w-3" }),
            div(
              {},
              h4({ class: `font-medium ${titleClass}` }, step.title),
              p({ class: `text-sm ${descClass} mt-0.5` }, step.description),
            ),
          ),
          span({ class: `px-2.5 py-1 rounded-full text-xs font-medium ${badgeClass}` }, badgeText),
        ),
        // Content area - shown for running items always, or expanded completed items
        shouldShowContent && contentArea
          ? div({ class: "overflow-hidden transition-all duration-200 ease-in-out" }, contentArea)
          : null,
      ),
    ),
  );
}

/**
 * Get FFmpeg installation instructions based on platform
 */
function getFfmpegInstructions(platform: string): string {
  switch (platform) {
    case "darwin":
      return "brew install ffmpeg";
    case "win32":
      return "# Option 1: Download from https://ffmpeg.org/download.html\n# Option 2: Using Chocolatey\nchoco install ffmpeg\n# Option 3: Using winget\nwinget install ffmpeg";
    default:
      return "# Ubuntu/Debian\nsudo apt install ffmpeg\n# Fedora\nsudo dnf install ffmpeg\n# Arch Linux\nsudo pacman -S ffmpeg";
  }
}

/**
 * Render the FFmpeg warning banner
 */
function FfmpegWarningBanner(health: SystemHealth) {
  const instructions = getFfmpegInstructions(health.platform);

  return div(
    { class: "mb-6 p-4 rounded-lg bg-amber-500/20 border border-amber-500/30" },
    div(
      { class: "flex items-start gap-3" },
      i({ class: "fadr fa-triangle-exclamation text-accent-amber text-xl mt-0.5" }),
      div(
        { class: "flex-1" },
        h3({ class: "text-accent-amber font-semibold mb-1" }, "FFmpeg Not Installed"),
        p(
          { class: "text-amber-200/80 text-sm mb-3" },
          "FFmpeg is required for video processing and metadata extraction. Video files will be skipped during processing until ffprobe is installed.",
        ),
        div(
          { class: "bg-zinc-50/50 dark:bg-zinc-900/50 rounded-lg p-3 mb-3" },
          p({ class: "text-fg-muted text-xs mb-2 font-medium" }, "Installation instructions:"),
          pre({ class: "text-amber-200/90 text-xs font-mono whitespace-pre-wrap" }, instructions),
        ),
        p(
          { class: "text-amber-200/60 text-xs" },
          i({ class: "fadr fa-info-circle mr-1" }),
          "Restart the application after installing FFmpeg to enable video processing.",
        ),
      ),
    ),
  );
}

/**
 * Main processing view
 */
export function ProcessingView() {
  if (rpcClient) {
    loadInitialState();
  }

  return div(
    { class: "h-full flex flex-col" },
    // Header
    header(
      { class: "flex-shrink-0 bg-zinc-50/95 dark:bg-zinc-900/95 backdrop-blur border-b border-edge px-6 py-4 z-10" },
      div(
        { class: "flex items-center justify-between" },
        div(
          {},
          h2({ class: "text-xl font-semibold text-fg" }, "Processing Pipeline"),
          p({ class: "text-sm text-fg-muted mt-0.5" }, "Step-by-step progress through deduplication stages"),
        ),
        // Header buttons - Start/Pause/Resume
        () => {
          const state = getPipelineState();
          const status = getStatus();
          const health = getSystemHealth();
          const isRunning = status?.isRunning ?? false;
          const isPaused = getIsPaused();
          const hasFolders = state?.hasFolders ?? false;
          const hasWork =
            state &&
            (state.hasUnscannedFolders ||
              state.hasFilesNeedingMetadata ||
              state.hasUnhashedFiles ||
              state.hasUndetectedDuplicates);
          const ffprobeAvailable = health?.ffprobe.available ?? true;

          const pauseAfterSegment = getPauseAfterSegment();

          return div(
            { class: "flex items-center gap-3" },
            // Pause after each step toggle - always visible when folders exist, disabled while actively processing
            (() => {
              if (!hasFolders || !ffprobeAvailable) return null;
              const isToggleDisabled = isRunning && !isPaused;
              return div(
                { class: "flex items-center gap-2 mr-2" },
                label(
                  {
                    class: `flex items-center gap-2 select-none ${isToggleDisabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`,
                    onclick: isToggleDisabled ? undefined : () => setPauseAfterSegment(!pauseAfterSegment),
                  },
                  div(
                    {
                      class: `relative w-9 h-5 rounded-full ${pauseAfterSegment ? "bg-blue-500/40" : "bg-zinc-300/40 dark:bg-zinc-600/40"}`,
                    },
                    div({
                      class: `absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white ${pauseAfterSegment ? "translate-x-4" : "translate-x-0"}`,
                    }),
                  ),
                  span({ class: "text-sm text-fg-muted" }, "Pause after each step"),
                ),
              );
            })(),
            // Action button - toggles between Start/Pause/Resume
            (() => {
              if (isRunning && !isPaused) {
                // Running: show Pause button
                return button(
                  {
                    class:
                      "px-4 py-2 rounded-lg bg-amber-600/20 hover:bg-amber-600/30 text-accent-amber text-sm font-medium border border-amber-500/30 flex items-center gap-2",
                    onclick: handlePauseProcessing,
                  },
                  i({ class: "fadr fa-pause" }),
                  "Pause",
                );
              } else if (isRunning && isPaused) {
                // Paused: show Resume button
                return button(
                  {
                    class:
                      "px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium flex items-center gap-2",
                    onclick: handleResumeProcessing,
                  },
                  i({ class: "fadr fa-play" }),
                  "Resume",
                );
              } else if (hasFolders && hasWork && ffprobeAvailable) {
                // Idle with work: show Start/Continue Processing button
                const isPartiallyComplete = state && !state.hasUnscannedFolders;
                return button(
                  {
                    class:
                      "px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium flex items-center gap-2",
                    onclick: handleStartProcessing,
                  },
                  i({ class: "fadr fa-play" }),
                  isPartiallyComplete ? "Continue Processing" : "Start Processing",
                );
              }
              return null;
            })(),
          );
        },
      ),
    ),
    // Content
    div(
      { class: "flex-1 overflow-auto p-6" },
      // Error message
      () => {
        const error = getError();
        if (error) {
          return div(
            { class: "mb-6 p-4 rounded-lg bg-red-500/20 border border-red-500/30 text-accent-red text-sm" },
            i({ class: "fadr fa-circle-exclamation mr-2" }),
            error,
          );
        }
        return null;
      },
      // FFmpeg warning banner
      () => {
        const health = getSystemHealth();
        if (health && !health.ffprobe.available) {
          return FfmpegWarningBanner(health);
        }
        return null;
      },
      // Pipeline section
      () => {
        const loading = getLoading();
        const state = getPipelineState();
        const status = getStatus();
        const summary = getResultsSummary();
        const health = getSystemHealth();
        const progress = status?.progress ?? null;
        const isRunning = status?.isRunning ?? false;

        if (loading && state === null) {
          return div(
            { class: "flex items-center justify-center py-12 text-fg-muted" },
            i({ class: "fadr fa-spinner animate-spin text-2xl mr-3" }),
            "Loading...",
          );
        }

        // Hide pipeline when ffprobe is not available
        if (health && !health.ffprobe.available) {
          return null;
        }

        // No folders - show empty state
        if (!state?.hasFolders) {
          return div(
            { class: "bg-surface-card rounded-xl border border-edge p-12 text-center" },
            i({ class: "fadr fa-folder-open text-5xl text-zinc-300 dark:text-zinc-600 mb-4" }),
            h3({ class: "text-lg font-medium text-fg mb-2" }, "No Folders Configured"),
            p({ class: "text-fg-muted mb-6" }, "Add folders to scan for images and videos before processing."),
            button(
              {
                class:
                  "px-6 py-3 rounded-lg bg-gradient-to-r from-blue-600 to-violet-600 hover:from-blue-500 hover:to-violet-500 text-white font-medium transition-all flex items-center gap-3 mx-auto",
                onclick: () => navigateTo("folders"),
              },
              i({ class: "fadr fa-folder-plus" }),
              "Add Folders",
            ),
          );
        }

        // Determine current step index
        let currentStepIndex = -1;
        if (progress) {
          currentStepIndex = getStepIndex(progress.stage);
        } else if (!isRunning) {
          // Not running - determine what step we're at based on state
          if (state.hasUnscannedFolders) {
            currentStepIndex = 0; // Will start at scanning
          } else if (state.hasFilesNeedingMetadata) {
            currentStepIndex = 1; // Will start at metadata extraction
          } else if (state.hasUnhashedFiles) {
            currentStepIndex = 2; // Will start at hashing
          } else if (state.hasUndetectedDuplicates) {
            currentStepIndex = 3; // Will start at detecting
          } else if (summary && summary.pendingSha256 + summary.pendingContentHash + summary.pendingPhash > 0) {
            currentStepIndex = 5; // All done, at review
          } else if (
            state.hasFolders &&
            !state.hasUnscannedFolders &&
            !state.hasFilesNeedingMetadata &&
            !state.hasUnhashedFiles &&
            !state.hasUndetectedDuplicates
          ) {
            // All processing stages complete, even if no duplicates were found
            currentStepIndex = 5;
          } else {
            currentStepIndex = -1; // Nothing to do
          }
        }

        const expandedSteps = getExpandedSteps();
        const isPaused = getIsPaused();

        // When paused between stages (stage completed at 100%), treat the completed
        // stage as done and the next stage as not-yet-running
        let effectiveStepIndex = currentStepIndex;
        let effectiveIsRunning = isRunning;

        if (
          isPaused &&
          isRunning &&
          progress?.stageProgress === 100 &&
          progress.stage !== "complete" &&
          progress.stage !== "error"
        ) {
          effectiveStepIndex = currentStepIndex + 1;
          effectiveIsRunning = false;
        }

        // Auto-update expanded steps when processing state changes
        updateExpandedSteps(effectiveStepIndex, effectiveIsRunning);

        return div(
          { class: "bg-surface-card rounded-xl border border-edge overflow-hidden" },
          // Pipeline steps
          div(
            { class: "p-5" },
            div(
              { class: "space-y-2" },
              ...PIPELINE_STEPS.map((step, idx) =>
                PipelineStepComponent(
                  step,
                  idx,
                  effectiveStepIndex,
                  effectiveIsRunning,
                  idx === PIPELINE_STEPS.length - 1,
                  progress,
                  state,
                  summary,
                  expandedSteps.has(step.id),
                ),
              ),
            ),
          ),
          // Bottom progress bar - stage-based progress indicator (always visible)
          (() => {
            // Calculate completed stages (4 processing stages: scanning, metadata, hashing, detecting)
            const PROCESSING_STAGES = ["scanning", "metadata", "hashing", "detecting"];
            const currentStageIndex = progress ? PROCESSING_STAGES.indexOf(progress.stage) : -1;
            let completedStages = currentStageIndex >= 0 ? currentStageIndex : progress?.stage === "complete" ? 4 : 0;
            const totalStages = 4;
            const stageProgress = progress?.stageProgress ?? 0;

            // When paused between stages (current stage at 100%), count the current stage as completed
            if (isPaused && isRunning && stageProgress === 100 && currentStageIndex >= 0) {
              completedStages = currentStageIndex + 1;
            }

            // When progress is null (e.g., after app restart), derive completedStages from PipelineState.
            // effectiveStepIndex is already computed from state: 0=scanning, 1=metadata, 2=hashing, 3=detecting, 4+=review
            if (!progress && !isRunning && effectiveStepIndex > 0 && effectiveStepIndex < PIPELINE_STEPS.length) {
              completedStages = Math.min(effectiveStepIndex, totalStages);
            }

            // Get current stage name for display
            const stageNames: Record<string, string> = {
              scanning: "File Discovery",
              metadata: "Metadata Extraction",
              hashing: "Evaluate and Analyze Media",
              detecting: "Similarity Analysis",
              complete: "Complete",
            };
            const currentStageName = progress ? stageNames[progress.stage] || progress.stage : "";

            // Calculate overall progress percentage
            // When paused between stages, stageProgress is 100 but the stage is already
            // counted in completedStages — use 0 to avoid double-counting
            const effectiveStageProgress =
              isPaused && isRunning && stageProgress === 100 && currentStageIndex >= 0 ? 0 : stageProgress;
            const overallPercent = Math.round(((completedStages + effectiveStageProgress / 100) / totalStages) * 100);

            // Determine status text
            let statusText: string;
            if (progress?.stage === "complete") {
              statusText = "4 of 4 complete";
            } else if (isPaused && isRunning && stageProgress === 100) {
              statusText = `${completedStages} of ${totalStages} complete`;
            } else if (isRunning && currentStageName) {
              statusText = `${completedStages} of ${totalStages} complete: ${currentStageName} — ${Math.round(stageProgress)}%`;
            } else if (
              state?.hasUnscannedFolders ||
              state?.hasFilesNeedingMetadata ||
              state?.hasUnhashedFiles ||
              state?.hasUndetectedDuplicates
            ) {
              statusText = completedStages > 0 ? `${completedStages} of ${totalStages} complete` : "Ready to process";
            } else {
              statusText = "No pending work";
            }

            return div(
              { class: "px-5 py-4 border-t border-edge bg-zinc-200/30 dark:bg-zinc-700/30" },
              // Paused indicator - only show when actively running and paused
              isPaused && isRunning
                ? div(
                    {
                      class:
                        "flex items-center justify-center gap-2 mb-3 px-3 py-2 rounded-lg bg-amber-500/20 border border-amber-500/30",
                    },
                    i({ class: "fadr fa-pause text-accent-amber" }),
                    span({ class: "text-accent-amber font-medium" }, "Paused"),
                    span({ class: "text-amber-400/70" }, "— Click Resume to continue"),
                  )
                : null,
              // Progress info
              div(
                { class: "flex items-center justify-between text-sm mb-2" },
                span({ class: "text-fg-muted" }, statusText),
                isRunning || progress?.stage === "complete" || completedStages > 0
                  ? span({ class: "text-fg-3 font-medium" }, `${overallPercent}%`)
                  : null,
              ),
              // Progress bar
              div(
                { class: "h-2 bg-zinc-300 dark:bg-zinc-600 rounded-full overflow-hidden" },
                (() => {
                  const bar = div({
                    class: `h-full bg-gradient-to-r from-emerald-500 to-blue-500 rounded-full transition-all duration-300`,
                  });
                  bar.style.width = `${overallPercent}%`;
                  return bar;
                })(),
              ),
            );
          })(),
        );
      },
    ),
  );
}
