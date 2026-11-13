/** Video frame stepping for the comparison modal: step/auto-play through frames, swapping both panels together. */
import { ChevronsLeft, ChevronsRight, Pause, Play, SkipBack, SkipForward } from "lucide-react";
import { type ReactNode, useRef, useState } from "react";
import { useInterval } from "../../external/use-interval";

export interface FrameStepper {
  steps: number[];
  /** Step shown in the label (moves immediately). */
  index: number;
  /** Time whose frames are displayed (moves once both frames have preloaded). */
  shownTime: number;
  auto: boolean;
  seek: (index: number) => void;
  toggleAuto: () => void;
  stopAuto: () => void;
}

function preload(url: string | null): Promise<void> {
  if (!url) return Promise.resolve();
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve();
    img.onerror = () => resolve();
    img.src = url;
  });
}

/** `urlsAt(time)` gives the [left, right] frame URLs (null for a side that is not a video). */
export function useFrameStepper(
  steps: number[],
  urlsAt: (time: number) => [string | null, string | null],
): FrameStepper {
  const [index, setIndex] = useState(0);
  const [shownTime, setShownTime] = useState(0);
  const [auto, setAuto] = useState(false);
  const latestSeek = useRef(0);

  function seek(next: number): void {
    if (next < 0 || next >= steps.length) return;
    setIndex(next);
    const time = steps[next] ?? 0;
    const token = ++latestSeek.current;
    const [left, right] = urlsAt(time);
    // Preload both frames, then swap them together.
    void Promise.all([preload(left), preload(right)]).then(() => {
      if (token === latestSeek.current) setShownTime(time);
    });
  }

  useInterval(
    () => {
      if (index >= steps.length - 1) setAuto(false);
      else seek(index + 1);
    },
    auto ? 750 : null,
  );

  return {
    steps,
    index,
    shownTime,
    auto,
    seek,
    stopAuto: () => setAuto(false),
    toggleAuto: () => {
      if (auto) {
        setAuto(false);
        return;
      }
      if (index >= steps.length - 1) seek(0);
      setAuto(true);
    },
  };
}

const CTRL =
  "px-2 py-1 rounded text-sm bg-surface-inset hover:bg-surface-active text-fg-3 hover:text-fg flex items-center gap-1";

export function FrameStepperBar({ stepper }: { stepper: FrameStepper }): ReactNode {
  const { steps, index, seek, stopAuto } = stepper;
  const go = (i: number) => () => {
    stopAuto();
    seek(i);
  };
  const time = steps[index] ?? 0;
  return (
    <div className="flex-shrink-0 flex items-center justify-center gap-2 px-6 py-2 bg-surface border-b border-edge">
      <button type="button" className={CTRL} title="First frame" onClick={go(0)}>
        <ChevronsLeft size="1em" />
      </button>
      <button type="button" className={CTRL} title="Previous frame" onClick={go(index - 1)}>
        <SkipBack size="1em" />
      </button>
      <span className="text-sm text-fg-muted font-mono min-w-[10rem] text-center">
        {`Frame ${index + 1} / ${steps.length}  (${time.toFixed(1)}s)`}
      </span>
      <button type="button" className={CTRL} title="Next frame" onClick={go(index + 1)}>
        <SkipForward size="1em" />
      </button>
      <button type="button" className={CTRL} title="Last frame" onClick={go(steps.length - 1)}>
        <ChevronsRight size="1em" />
      </button>
      <button
        type="button"
        className="px-2 py-1 rounded text-sm bg-blue-600 hover:bg-blue-500 text-white flex items-center gap-1"
        title="Auto-step through frames"
        onClick={stepper.toggleAuto}
      >
        {stepper.auto ? <Pause size="1em" /> : <Play size="1em" />}
        {stepper.auto ? " Stop" : " Auto"}
      </button>
    </div>
  );
}
