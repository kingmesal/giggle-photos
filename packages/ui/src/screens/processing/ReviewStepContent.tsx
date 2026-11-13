/** Content of the final "Review Duplicates" step once processing is complete. */
import { CircleCheck } from "lucide-react";
import type { ReactNode } from "react";
import type { ResultsSummary } from "../../services/processing-view-service";
import { pendingGroups } from "./pipeline-logic";

const plural = (n: number, word: string): string => `${n} ${word}${n !== 1 ? "s" : ""}`;

/** Null when there is nothing special to show (the step then uses its regular content). */
export function reviewStepContent(summary: ResultsSummary | null, stepCompleted: boolean): ReactNode {
  const groups = pendingGroups(summary);
  const decisions = summary ? summary.decidedKeep + summary.decidedDelete : 0;
  if (summary && (groups > 0 || decisions > 0)) {
    return (
      <div className="mt-3 p-4 rounded-lg bg-emerald-500/10 border border-emerald-500/30">
        <div className="flex items-center gap-3 mb-3">
          <CircleCheck size="1em" className="text-accent-green text-xl" aria-hidden="true" />
          <span className="text-accent-green font-medium">All processing is complete!</span>
        </div>
        <p className="text-fg-3 text-sm mb-3">
          Review all potential duplicates in the Duplicates tab to decide which files to keep.
        </p>
        <div className="flex items-center justify-between text-sm pt-3 border-t border-emerald-500/20">
          <div className="flex items-center gap-4">
            <span className="text-fg-muted">{`${plural(groups, "pending group")} to review`}</span>
            {decisions > 0 && <span className="text-fg-3">•</span>}
            {decisions > 0 && <span className="text-fg-muted">{`${plural(decisions, "decision")} made`}</span>}
          </div>
        </div>
      </div>
    );
  }
  if (!stepCompleted) return null;
  return (
    <div className="mt-3 p-4 rounded-lg bg-emerald-500/10 border border-emerald-500/30">
      <div className="flex items-center gap-3">
        <CircleCheck size="1em" className="text-accent-green text-xl" aria-hidden="true" />
        <div>
          <span className="text-accent-green font-medium block">All processing is complete!</span>
          <span className="text-fg-muted text-sm">No duplicate files were found in your folders.</span>
        </div>
      </div>
    </div>
  );
}
