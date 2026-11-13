/** Content of the running step (progress, live counts, timings, ETA) and of the step ready to run. */
import { ArrowRight, CirclePlay, Clock } from "lucide-react";
import type { ReactNode } from "react";
import type { PipelineProgress, PipelineState } from "../../services/processing-view-service";
import { INLINE_ICON } from "./icons";
import type { PipelineStep } from "./pipeline-logic";
import { formatDuration, formatTimings } from "./pipeline-logic";

export function InProgressContent({ progress }: { progress: PipelineProgress }): ReactNode {
  const percent = Math.round(progress.stageProgress);
  const hasLiveCounts = progress.liveImages != null || progress.liveVideos != null;
  const timings = formatTimings(progress.liveTimingMs);
  return (
    <div className="mt-3 space-y-2">
      <div className="p-3 rounded-lg bg-zinc-200/50 dark:bg-zinc-700/50 border border-zinc-300/50 dark:border-zinc-600/50">
        <div className="flex items-center justify-between text-sm mb-2">
          <span className="text-fg-muted">Processing files...</span>
          <span className="font-medium text-fg-2">{percent}%</span>
        </div>
        <div className="h-2 bg-zinc-300 dark:bg-zinc-600 rounded-full overflow-hidden">
          <div className="h-full bg-blue-500 rounded-full" role="progressbar" style={{ width: `${percent}%` }} />
        </div>
        {progress.totalFiles > 0 && (
          <div className="flex items-center justify-between text-sm text-fg-3 mt-2">
            <span>
              {progress.filesProcessed} / {progress.totalFiles} files
            </span>
          </div>
        )}
        {hasLiveCounts && (
          <div className="flex items-center gap-3 text-sm text-fg-3 mt-2">
            {progress.liveImages != null && progress.liveImages > 0 && <span>{progress.liveImages} images</span>}
            {progress.liveVideos != null && progress.liveVideos > 0 && <span>{progress.liveVideos} videos</span>}
          </div>
        )}
        {timings.length > 0 && (
          <div className="text-sm text-fg-3 mt-1">
            {timings.map((t) => (
              <span key={t}>{t}</span>
            ))}
          </div>
        )}
        {progress.etaMs != null && progress.etaMs > 0 && (
          <div className="text-sm text-accent-blue mt-1">
            <Clock size="1em" className={`${INLINE_ICON} mr-1`} aria-hidden="true" />
            {`Estimated time remaining: ${formatDuration(progress.etaMs)}`}
          </div>
        )}
      </div>
      {progress.currentOperation && (
        <div className="px-3 py-2 rounded bg-zinc-200/30 dark:bg-zinc-700/30 text-sm text-fg-3 font-mono truncate">
          <ArrowRight size="1em" className={`${INLINE_ICON} mr-1`} aria-hidden="true" />
          {progress.currentOperation}
        </div>
      )}
    </div>
  );
}

/** Files waiting for this step: the run's total, or derived from the persisted state after a restart. */
function readyFileCount(step: PipelineStep, progress: PipelineProgress | null, state: PipelineState | null): number {
  if (progress && progress.totalFiles > 0) return progress.totalFiles;
  if (!state || state.totalFiles <= 0) return 0;
  const sc = state.statusCounts;
  if (step.stage === "metadata") return sc.pending;
  if (step.stage === "hashing") return sc.metadata;
  if (step.stage === "detecting") return sc.hashed;
  return 0; // scanning: unknown until it runs
}

export function ReadyContent({
  step,
  progress,
  state,
}: {
  step: PipelineStep;
  progress: PipelineProgress | null;
  state: PipelineState | null;
}): ReactNode {
  const count = readyFileCount(step, progress, state);
  return (
    <div className="mt-3 p-3 rounded-lg bg-blue-500/10 border border-blue-500/20 text-sm text-accent-blue">
      <CirclePlay size="1em" className={`${INLINE_ICON} mr-2`} aria-hidden="true" />
      {count > 0 ? `Ready — ${count} files to process` : "Ready to process"}
    </div>
  );
}
