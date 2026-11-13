/**
 * CLIP distance thresholds keep the order strong ≤ review ≤ store: moving one past a neighbour drags
 * the neighbour along, so the saved settings are always consistent.
 */
import type { ClipSettings } from "../../services/settings-service";

export type ClipDistanceField = "clipStrongMaxDistance" | "clipReviewMaxDistance" | "clipStoreMaxDistance";

/** Slider range for every CLIP distance (cosine distance; 0 = identical). */
export const CLIP_DISTANCE_MIN = 0;
export const CLIP_DISTANCE_MAX = 0.3;
export const CLIP_DISTANCE_STEP = 0.005;

type ClipDistances = Pick<ClipSettings, ClipDistanceField>;

const ORDER: ClipDistanceField[] = ["clipStrongMaxDistance", "clipReviewMaxDistance", "clipStoreMaxDistance"];

/** Round to the slider step so float noise never reaches the config file. */
function snap(value: number): number {
  const clamped = Math.min(CLIP_DISTANCE_MAX, Math.max(CLIP_DISTANCE_MIN, value));
  return Math.round(clamped / CLIP_DISTANCE_STEP) * CLIP_DISTANCE_STEP;
}

/** The changed fields after setting `field` to `value`, with lower/higher thresholds pushed to keep order. */
export function setClipDistance(current: ClipDistances, field: ClipDistanceField, value: number): ClipDistances {
  const next: ClipDistances = { ...current, [field]: Number(snap(value).toFixed(3)) };
  const at = ORDER.indexOf(field);
  for (let i = at - 1; i >= 0; i--) {
    const lower = ORDER[i] as ClipDistanceField;
    const upper = ORDER[i + 1] as ClipDistanceField;
    if (next[lower] > next[upper]) next[lower] = next[upper];
  }
  for (let i = at + 1; i < ORDER.length; i++) {
    const lower = ORDER[i - 1] as ClipDistanceField;
    const upper = ORDER[i] as ClipDistanceField;
    if (next[upper] < next[lower]) next[upper] = next[lower];
  }
  return next;
}

/** Display a distance with three decimals (e.g. 0.020). */
export function formatDistance(value: number): string {
  return value.toFixed(3);
}
