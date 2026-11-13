/**
 * Slider for a CLIP cosine distance (0–0.3, step 0.005) with its value shown to three decimals.
 */
import type { ReactNode } from "react";
import { CLIP_DISTANCE_MAX, CLIP_DISTANCE_MIN, CLIP_DISTANCE_STEP, formatDistance } from "./clip-thresholds";

export function DistanceSlider({
  label,
  description,
  value,
  onChange,
}: {
  label: string;
  description: string;
  value: number;
  onChange: (next: number) => void;
}): ReactNode {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div>
          <p className="text-sm text-fg-2">{label}</p>
          <p className="text-xs text-fg-faint">{description}</p>
        </div>
        <span className="text-sm font-medium text-accent-blue min-w-[50px] text-right font-mono">
          {formatDistance(value)}
        </span>
      </div>
      <input
        type="range"
        aria-label={label}
        min={CLIP_DISTANCE_MIN}
        max={CLIP_DISTANCE_MAX}
        step={CLIP_DISTANCE_STEP}
        value={value}
        className="w-full h-2 bg-zinc-300 dark:bg-zinc-600 rounded-full appearance-none cursor-pointer accent-blue-500"
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <div className="flex justify-between text-xs text-fg-faint mt-1">
        <span>{`${CLIP_DISTANCE_MIN} (Identical)`}</span>
        <span>{`${CLIP_DISTANCE_MAX} (Loose)`}</span>
      </div>
    </div>
  );
}
