import { describe, expect, test } from "bun:test";
import { durationsMatch, findVideoPairs, videoDistance } from "./video-match";

/** Unit vector at angle `deg` in the first two dimensions (dot of two = cos of the angle between). */
const at = (deg: number) => {
  const r = (deg * Math.PI) / 180;
  return Float32Array.from([Math.cos(r), Math.sin(r), 0, 0]);
};
const frames = (...degs: number[]) => degs.map(at);
const SCENE = frames(0, 20, 40, 60, 80);

describe("durationsMatch", () => {
  test("within 1 s, or 1% for long videos", () => {
    expect(durationsMatch(10, 10.9)).toBe(true);
    expect(durationsMatch(10, 11.2)).toBe(false);
    expect(durationsMatch(600, 605)).toBe(true); // 1% of 605 = 6.05 s
    expect(durationsMatch(600, 610)).toBe(false);
  });
});

describe("videoDistance", () => {
  test("identical frames → 0; slightly shifted frames → small; different scenes → large", () => {
    expect(videoDistance(SCENE, SCENE)).toBeCloseTo(0, 6);
    const reencoded = frames(2, 22, 42, 62, 82); // every frame 2° off: 1 − cos 2° ≈ 0.0006
    expect(videoDistance(SCENE, reencoded)).toBeCloseTo(1 - Math.cos((2 * Math.PI) / 180), 5);
    const other = frames(170, 175, 180, 185, 190);
    expect(videoDistance(SCENE, other)).toBeGreaterThan(1);
  });

  test("the median ignores one bad frame (e.g. a different first frame)", () => {
    expect(videoDistance(SCENE, frames(150, 20, 40, 60, 80))).toBeCloseTo(0, 6);
  });

  test("symmetric: a clip that only matches part of the other is not a pair", () => {
    const trimmed = frames(0, 0, 0, 0, 0); // matches only the first frame of SCENE
    expect(videoDistance(SCENE, trimmed)).toBe(videoDistance(trimmed, SCENE));
    expect(videoDistance(SCENE, trimmed)).toBeGreaterThan(0.1);
  });
});

describe("findVideoPairs", () => {
  const v = (id: number, durationSec: number, f = SCENE) => ({ id, durationSec, frames: f });

  test("pairs videos of matching duration and content, ordered ids", () => {
    const pairs = findVideoPairs(
      [v(9, 30.4), v(3, 30), v(5, 30.2, frames(170, 175, 180, 185, 190)), v(7, 45), v(8, 0)],
      0.12,
    );
    expect(pairs.map((p) => [p.mediaFileId1, p.mediaFileId2])).toEqual([[3, 9]]);
    expect(pairs[0]?.distance).toBeCloseTo(0, 6);
  });

  test("respects the distance cutoff", () => {
    const still = frames(0, 0, 0, 0, 0);
    const off = frames(30, 30, 30, 30, 30); // 30° from every frame: 1 − cos 30° ≈ 0.134
    expect(findVideoPairs([v(1, 10, still), v(2, 10, off)], 0.12)).toEqual([]);
    expect(findVideoPairs([v(1, 10, still), v(2, 10, off)], 0.2)).toHaveLength(1);
  });
});
