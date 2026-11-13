/**
 * CLIP threshold presets. Giggle defaults: the app's bands (RFD-002 §D). Immich defaults: Immich's
 * duplicate detection (`maxDistance` 0.01, Immich v3.4.1, same ViT-B-32 openai model), so the
 * Visually Similar tab shows roughly what Immich will group after import. The storage cutoff is
 * kept, so switching back needs no recompute.
 */
import type { ClipSettings } from "../../services/settings-service";

export type ClipPresetId = "giggle" | "immich";

type PresetFields = Pick<ClipSettings, "clipStrongMaxDistance" | "clipReviewMaxDistance" | "clipSimilarShotsEnabled">;

export const CLIP_PRESETS: { id: ClipPresetId; label: string; description: string; values: PresetFields }[] = [
  {
    id: "giggle",
    label: "Giggle defaults",
    description: "Same photo ≤ 0.02, review ≤ 0.06: also finds crops, edits and burst shots",
    values: { clipStrongMaxDistance: 0.02, clipReviewMaxDistance: 0.06, clipSimilarShotsEnabled: false },
  },
  {
    id: "immich",
    label: "Immich defaults",
    description: "≤ 0.01, Immich's duplicate detection: what Immich will group after import",
    values: { clipStrongMaxDistance: 0.01, clipReviewMaxDistance: 0.01, clipSimilarShotsEnabled: false },
  },
];

/** The preset the settings match exactly, or null when they were customised. */
export function activePreset(s: PresetFields): ClipPresetId | null {
  const same = (a: number, b: number) => Math.abs(a - b) < 1e-9;
  const match = CLIP_PRESETS.find(
    (p) =>
      same(p.values.clipStrongMaxDistance, s.clipStrongMaxDistance) &&
      same(p.values.clipReviewMaxDistance, s.clipReviewMaxDistance) &&
      p.values.clipSimilarShotsEnabled === s.clipSimilarShotsEnabled,
  );
  return match?.id ?? null;
}
