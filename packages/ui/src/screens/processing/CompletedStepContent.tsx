/** Content of a completed step: live per-stage stats, or counts derived from the persisted state after a restart. */
import { CircleCheck } from "lucide-react";
import type { ReactNode } from "react";
import { errorCategoryLabel } from "../../lib/error-labels";
import type { PipelineProgress, PipelineState, StageStatsEntry } from "../../services/processing-view-service";
import { ClipStatsLine } from "./ClipStats";
import { INLINE_ICON } from "./icons";
import type { PipelineStep } from "./pipeline-logic";
import { formatTimings } from "./pipeline-logic";
import { TakeoutReportPanel } from "./TakeoutReport";

export const PANEL =
  "mt-3 p-3 rounded-lg bg-zinc-200/50 dark:bg-zinc-700/50 border border-zinc-300/50 dark:border-zinc-600/50";

function Stat({
  label,
  value,
  valueClass = "text-fg-2 font-medium",
}: {
  label: string;
  value: number;
  valueClass?: string;
}) {
  return (
    <div>
      <span className="text-fg-3">{label}</span>
      <span className={valueClass}>{value}</span>
    </div>
  );
}

function CompletedLine(): ReactNode {
  return (
    <div className="flex items-center gap-2 text-sm text-fg-muted mb-2">
      <CircleCheck size="1em" className="text-accent-green" aria-hidden="true" />
      Step completed successfully
    </div>
  );
}

function TotalFound({ total, stats }: { total: number; stats?: StageStatsEntry }): ReactNode {
  const images = stats?.images;
  const videos = stats?.videos;
  return (
    <div className={PANEL}>
      <div className="flex items-center justify-between text-sm">
        <span className="text-fg-muted">Total files found</span>
        <span className="font-medium text-fg-2">{total}</span>
      </div>
      {Boolean(images || videos) && (
        <div className="flex items-center gap-4 text-sm text-fg-3 mt-1">
          {images ? <span>{images} images</span> : null}
          {videos ? <span>{videos} videos</span> : null}
        </div>
      )}
      {stats?.takeout && <TakeoutReportPanel takeout={stats.takeout} />}
    </div>
  );
}

function StageStats({ stage, stats }: { stage: string; stats: StageStatsEntry }): ReactNode {
  const hasTypes = stats.images != null || stats.videos != null;
  const timings = formatTimings(stats.timingMs);
  const breakdown = Object.entries(stats.errorBreakdown ?? {});
  return (
    <div className={PANEL}>
      <CompletedLine />
      <div className="flex items-center gap-4 text-sm mb-1">
        {hasTypes && stats.images != null && stats.images > 0 && <Stat label="Images: " value={stats.images} />}
        {hasTypes && stats.videos != null && stats.videos > 0 && <Stat label="Videos: " value={stats.videos} />}
        <Stat label={hasTypes ? "Total: " : "Processed: "} value={stats.processed} />
      </div>
      {timings.length > 0 && (
        <div className="text-sm text-fg-3 mb-1">
          {timings.map((t) => (
            <span key={t}>{t}</span>
          ))}
        </div>
      )}
      {(stats.errors > 0 || stats.skipped > 0) && (
        <div className="flex items-center gap-4 text-sm">
          {stats.errors > 0 && <Stat label="Errors: " value={stats.errors} valueClass="text-accent-amber" />}
          {stats.skipped > 0 && <Stat label="Skipped: " value={stats.skipped} valueClass="text-fg-3" />}
        </div>
      )}
      {breakdown.length > 0 && (
        <div className="text-sm text-accent-amber mt-1">
          {breakdown.map(([category, count]) => (
            <span key={category} className="mr-3">
              {`${errorCategoryLabel(category)}: ${count}`}
            </span>
          ))}
        </div>
      )}
      {stage === "scanning" && stats.takeout && <TakeoutReportPanel takeout={stats.takeout} />}
      {stage === "detecting" && stats.clip && <ClipStatsLine clip={stats.clip} />}
    </div>
  );
}

/** Files past a stage after a restart = files at that stage's status plus all later statuses. */
function filesPastStage(stage: string, sc: PipelineState["statusCounts"]): number {
  if (stage === "metadata") return sc.metadata + sc.hashed + sc.processed;
  if (stage === "hashing") return sc.hashed + sc.processed;
  if (stage === "detecting") return sc.processed;
  return 0;
}

export function CompletedStepContent({
  step,
  progress,
  state,
}: {
  step: PipelineStep;
  progress: PipelineProgress | null;
  state: PipelineState | null;
}): ReactNode {
  if (step.stage === "scanning" && progress) {
    return <TotalFound total={progress.totalFiles} stats={progress.stageStats?.scanning} />;
  }
  if (step.stage === "scanning" && !progress && state && state.totalFiles > 0) {
    return <TotalFound total={state.totalFiles} />;
  }
  const stats = progress?.stageStats?.[step.stage];
  if (stats) return <StageStats stage={step.stage} stats={stats} />;
  if (!progress && state && state.totalFiles > 0) {
    const sc = state.statusCounts;
    return (
      <div className={PANEL}>
        <CompletedLine />
        <div className="flex items-center gap-4 text-sm">
          <Stat label="Files: " value={filesPastStage(step.stage, sc)} />
          {sc.error > 0 && <Stat label="Errors: " value={sc.error} valueClass="text-accent-amber" />}
        </div>
      </div>
    );
  }
  return (
    <div className={`${PANEL} text-sm text-fg-muted`}>
      <CircleCheck size="1em" className={`${INLINE_ICON} text-accent-green mr-2`} aria-hidden="true" />
      Step completed successfully
    </div>
  );
}
