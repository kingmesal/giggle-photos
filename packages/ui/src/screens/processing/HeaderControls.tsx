/** Header controls: the "Pause after each step" toggle and the Start / Pause / Resume button. */
import { Pause, Play } from "lucide-react";
import type { ReactNode } from "react";
import { useAction } from "../../external/use-action";
import {
  type ProcessingViewState,
  pauseProcessing,
  resumeProcessing,
  setPauseAfterSegment,
  startProcessing,
} from "../../services/processing-view-service";
import { hasPendingWork } from "./pipeline-logic";

const PRIMARY =
  "px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium flex items-center gap-2";

function PauseAfterStepToggle({ on, disabled }: { on: boolean; disabled: boolean }): ReactNode {
  return (
    <div className="flex items-center gap-2 mr-2">
      <label
        className={`flex items-center gap-2 select-none ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
      >
        <input
          type="checkbox"
          className="sr-only"
          checked={on}
          disabled={disabled}
          onChange={() => setPauseAfterSegment(!on)}
        />
        <div
          className={`relative w-9 h-5 rounded-full ${on ? "bg-blue-500/40" : "bg-zinc-300/40 dark:bg-zinc-600/40"}`}
        >
          <div
            className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white ${on ? "translate-x-4" : "translate-x-0"}`}
          />
        </div>
        <span className="text-sm text-fg-muted">Pause after each step</span>
      </label>
    </div>
  );
}

export function HeaderControls({ view }: { view: ProcessingViewState }): ReactNode {
  const start = useAction(startProcessing);
  const pause = useAction(pauseProcessing);
  const resume = useAction(resumeProcessing);
  const isRunning = view.status?.isRunning ?? false;
  const { isPaused, pipelineState: state } = view;
  const hasFolders = state?.hasFolders ?? false;
  const ffprobeAvailable = view.health?.ffprobe.available ?? true;

  let action: ReactNode = null;
  if (isRunning && !isPaused) {
    action = (
      <button
        type="button"
        className="px-4 py-2 rounded-lg bg-amber-600/20 hover:bg-amber-600/30 text-accent-amber text-sm font-medium border border-amber-500/30 flex items-center gap-2"
        disabled={pause.pending}
        onClick={() => void pause.run()}
      >
        <Pause size="1em" aria-hidden="true" />
        Pause
      </button>
    );
  } else if (isRunning && isPaused) {
    action = (
      <button type="button" className={PRIMARY} disabled={resume.pending} onClick={() => void resume.run()}>
        <Play size="1em" aria-hidden="true" />
        Resume
      </button>
    );
  } else if (hasFolders && hasPendingWork(state) && ffprobeAvailable) {
    action = (
      <button type="button" className={PRIMARY} disabled={start.pending} onClick={() => void start.run()}>
        <Play size="1em" aria-hidden="true" />
        {state && !state.hasUnscannedFolders ? "Continue Processing" : "Start Processing"}
      </button>
    );
  }

  return (
    <div className="flex items-center gap-3">
      {hasFolders && ffprobeAvailable && (
        <PauseAfterStepToggle on={view.pauseAfterSegment} disabled={isRunning && !isPaused} />
      )}
      {action}
    </div>
  );
}
