/** Bottom bar of the pipeline card: paused notice, stage-based status text and overall progress. */
import { Pause } from "lucide-react";
import type { ReactNode } from "react";
import type { OverallProgress } from "./pipeline-logic";

export function OverallProgressBar({ overall, paused }: { overall: OverallProgress; paused: boolean }): ReactNode {
  return (
    <div className="px-5 py-4 border-t border-edge bg-zinc-200/30 dark:bg-zinc-700/30">
      {paused && (
        <div className="flex items-center justify-center gap-2 mb-3 px-3 py-2 rounded-lg bg-amber-500/20 border border-amber-500/30">
          <Pause size="1em" className="text-accent-amber" aria-hidden="true" />
          <span className="text-accent-amber font-medium">Paused</span>
          <span className="text-amber-400/70">— Click Resume to continue</span>
        </div>
      )}
      <div className="flex items-center justify-between text-sm mb-2">
        <span className="text-fg-muted">{overall.statusText}</span>
        {overall.showPercent && <span className="text-fg-3 font-medium">{overall.percent}%</span>}
      </div>
      <div className="h-2 bg-zinc-300 dark:bg-zinc-600 rounded-full overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-emerald-500 to-blue-500 rounded-full transition-all duration-300"
          style={{ width: `${overall.percent}%` }}
        />
      </div>
    </div>
  );
}
