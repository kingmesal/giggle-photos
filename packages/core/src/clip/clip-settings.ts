/** Effective CLIP thresholds from user settings (RFD-002 §D bands). */
import type { AppSettings } from "../config/user-config";

type ClipThresholdSettings = Pick<
  AppSettings,
  "clipStrongMaxDistance" | "clipReviewMaxDistance" | "clipSimilarShotsEnabled" | "clipStoreMaxDistance"
>;

export interface ClipThresholds {
  strong: number;
  review: number;
  store: number;
}

/**
 * Thresholds clamped into a consistent order (strong ≤ review ≤ store). "Similar shots" extends
 * review to the storage cutoff; nothing above the cutoff is ever stored, so review cannot exceed it.
 */
export function clipThresholds(settings: ClipThresholdSettings): ClipThresholds {
  const store = settings.clipStoreMaxDistance;
  const review = Math.min(settings.clipSimilarShotsEnabled ? store : settings.clipReviewMaxDistance, store);
  return { strong: Math.min(settings.clipStrongMaxDistance, review), review, store };
}
