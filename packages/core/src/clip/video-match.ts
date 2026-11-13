/**
 * Video pair candidates (RFD-002 §E): durations within max(1 s, 1%), and the median per-frame
 * best-match distance (taken in both directions, the larger kept) at or under `maxDistance`.
 * Frame embeddings are L2-normalised, so cosine distance = 1 − dot product.
 */
import type { ClipPair } from "./match";

export interface VideoFrames {
  id: number;
  durationSec: number;
  /** Frame embeddings in position order (5 when complete). */
  frames: Float32Array[];
}

const dot = (a: Float32Array, b: Float32Array) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] as number) * (b[i] as number);
  return s;
};

const median = (values: number[]) => {
  const s = [...values].sort((x, y) => x - y);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
};

/** Median over `a`'s frames of the distance to its closest frame in `b`. */
function directed(a: Float32Array[], b: Float32Array[]): number {
  return median(a.map((fa) => Math.max(0, 1 - Math.max(...b.map((fb) => dot(fa, fb))))));
}

/** Symmetric video distance: the larger of the two directed medians. */
export function videoDistance(a: Float32Array[], b: Float32Array[]): number {
  return Math.max(directed(a, b), directed(b, a));
}

/** Whether two durations are close enough to be the same video (max of 1 s and 1%). */
export function durationsMatch(a: number, b: number): boolean {
  return Math.abs(a - b) <= Math.max(1, 0.01 * Math.max(a, b));
}

export function findVideoPairs(videos: readonly VideoFrames[], maxDistance: number): ClipPair[] {
  const sorted = videos
    .filter((v) => v.frames.length > 0 && v.durationSec > 0)
    .sort((x, y) => x.durationSec - y.durationSec);
  const pairs: ClipPair[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i] as VideoFrames;
    for (let j = i + 1; j < sorted.length; j++) {
      const b = sorted[j] as VideoFrames;
      if (!durationsMatch(a.durationSec, b.durationSec)) break; // sorted: later ones are even longer
      const distance = videoDistance(a.frames, b.frames);
      if (distance <= maxDistance) {
        pairs.push({ mediaFileId1: Math.min(a.id, b.id), mediaFileId2: Math.max(a.id, b.id), distance });
      }
    }
  }
  return pairs.sort((x, y) => x.mediaFileId1 - y.mediaFileId1 || x.mediaFileId2 - y.mediaFileId2);
}
