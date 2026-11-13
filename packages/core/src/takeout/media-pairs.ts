/**
 * Media that belong together within one folder (RFD-003 §D):
 * - "motion": a still and its companion video with the same base name (live/motion photos);
 *   decisions apply to both, and they are never split.
 * - "edited": an edited copy and its original; both kept by default, never deleted against each other.
 *
 * Pixel motion photos are usually one file (`PXL_….MP.jpg`, video embedded). When Takeout emits a
 * separate companion, its name may or may not keep the `.MP`; both are accepted until a real export
 * shows which.
 */
import { parseMediaName } from "./sidecar-names";

export type PairKind = "motion" | "edited";

export interface PairMedia {
  id: number;
  name: string;
}

export interface MediaPair {
  kind: PairKind;
  /** The still (motion) or the original (edited). */
  primaryId: number;
  /** The video (motion) or the edited copy (edited). */
  secondaryId: number;
}

const STILL_EXTENSIONS = new Set(["jpg", "jpeg", "heic", "heif"]);
const VIDEO_EXTENSIONS = new Set(["mp4", "mov", "m4v", "3gp"]);
const PIXEL_MOTION_SUFFIX = /\.mp(~\d+)?$/i;

const stemOf = (counterless: string, extension: string) =>
  extension ? counterless.slice(0, -(extension.length + 1)) : counterless;
const pairKey = (stem: string, counter: number | null) => `${stem.toLowerCase()}#${counter ?? ""}`;

/** Detect motion and edited pairs among the media of one folder. Deterministic (input order). */
export function detectMediaPairs(media: readonly PairMedia[]): MediaPair[] {
  const parsed = media.map((m) => ({ id: m.id, ...parseMediaName(m.name) }));
  const pairs: MediaPair[] = [];

  // Motion: index stills by key (and by key without a Pixel ".MP" suffix), then look up videos.
  const stills = new Map<string, number>();
  for (const m of parsed) {
    if (!STILL_EXTENSIONS.has(m.extension.toLowerCase())) continue;
    const stem = stemOf(m.counterless, m.extension);
    for (const s of new Set([stem, stem.replace(PIXEL_MOTION_SUFFIX, "")])) {
      const key = pairKey(s, m.counter);
      if (!stills.has(key)) stills.set(key, m.id);
    }
  }
  const pairedStills = new Set<number>();
  for (const m of parsed) {
    if (!VIDEO_EXTENSIONS.has(m.extension.toLowerCase())) continue;
    const stillId = stills.get(pairKey(stemOf(m.counterless, m.extension), m.counter));
    if (stillId !== undefined && !pairedStills.has(stillId)) {
      pairedStills.add(stillId);
      pairs.push({ kind: "motion", primaryId: stillId, secondaryId: m.id });
    }
  }

  // Edited: "X-edited.jpg" (localized suffix) next to "X.jpg", same duplicate counter.
  const byName = new Map(parsed.map((m) => [`${m.counterless.toLowerCase()}#${m.counter ?? ""}`, m.id]));
  for (const m of parsed) {
    if (!m.editedOf) continue;
    const originalId = byName.get(`${m.editedOf.toLowerCase()}#${m.counter ?? ""}`);
    if (originalId !== undefined && originalId !== m.id) {
      pairs.push({ kind: "edited", primaryId: originalId, secondaryId: m.id });
    }
  }
  return pairs;
}
