import { describe, expect, test } from "bun:test";
import { clipAnchorId, groupClipPairs } from "./clip-groups";

const p = (mediaFileId1: number, mediaFileId2: number, distance: number) => ({ mediaFileId1, mediaFileId2, distance });

describe("groupClipPairs", () => {
  test("joins chained pairs into one group keyed by the lowest id", () => {
    const groups = groupClipPairs([p(5, 7, 0.03), p(3, 5, 0.01), p(10, 11, 0.05)], new Set());
    expect(groups.map((g) => [g.anchorId, g.memberIds, g.minDistance])).toEqual([
      [3, [3, 5, 7], 0.01],
      [10, [10, 11], 0.05],
    ]);
  });

  test("records each member's closest match inside the group", () => {
    const [g] = groupClipPairs([p(1, 2, 0.04), p(2, 3, 0.02)], new Set());
    expect(Object.fromEntries(g?.closest ?? [])).toEqual({ 1: 0.04, 2: 0.02, 3: 0.02 });
  });

  test("leaves out files already marked delete", () => {
    const groups = groupClipPairs([p(1, 2, 0.01), p(2, 3, 0.02)], new Set([2]));
    expect(groups).toEqual([]);
  });

  test("leaves out pairs already grouped by an earlier method, splitting a chain", () => {
    const groups = groupClipPairs(
      [p(1, 2, 0.01), p(2, 3, 0.02), p(4, 5, 0.03)],
      new Set(),
      (a, b) => a === 1 && b === 2,
    );
    expect(groups.map((g) => g.memberIds)).toEqual([
      [2, 3],
      [4, 5],
    ]);
  });

  test("no pairs, no groups", () => {
    expect(groupClipPairs([], new Set())).toEqual([]);
  });
});

describe("clipAnchorId", () => {
  test("parses clip:{anchor} and refuses other keys", () => {
    expect(clipAnchorId("clip:42")).toBe(42);
    expect(() => clipAnchorId("phash:42")).toThrow(/Invalid clip group key/);
    expect(() => clipAnchorId("clip:x")).toThrow(/Invalid clip group key/);
  });
});
