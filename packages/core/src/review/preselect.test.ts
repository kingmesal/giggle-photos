import { describe, expect, test } from "bun:test";
import { type PreselectFile, type PreselectMethod, preselect } from "./preselect";

/** A Google year-folder copy with a sidecar, unless overridden. */
const f = (id: number, over: Partial<PreselectFile> = {}): PreselectFile => ({
  id,
  folderPriority: 3,
  dateTaken: new Date("2023-05-01T10:00:00Z"),
  folderKind: "year",
  albumReferenced: false,
  hasSidecar: true,
  pixels: 12_000_000,
  size: 4_000_000,
  exifFields: 6,
  motionPartnerId: null,
  editedPartnerId: null,
  ...over,
});

describe("preselect — RFD-003 §E", () => {
  test("clip groups are never preselected (review only)", () => {
    expect(preselect("clip", [f(1), f(2)])).toMatchObject({ keepFileIds: [], rule: "clip_review_only" });
  });

  test("E.1: exact duplicates keep every album copy and delete the year-folder copy", () => {
    const r = preselect("sha256", [f(1), f(2, { folderKind: "album" }), f(3, { folderKind: "album" })]);
    expect(r).toMatchObject({ keepFileIds: [2, 3], rule: "album_copies", reason: "Keep every album copy" });
  });

  test("E.1: a year-folder photo referenced by an album-only sidecar counts as in an album", () => {
    const r = preselect("sha256", [
      f(1, { albumReferenced: true }),
      f(2),
      f(3, { folderKind: null, hasSidecar: false }),
    ]);
    expect(r.keepFileIds).toEqual([1]);
    expect(r.rule).toBe("album_copies");
  });

  test("E.1 applies to sha256 only; near-duplicates keep one (album first)", () => {
    // Two album copies: still one keep (E.1 is for exact duplicates only).
    expect(
      preselect("phash", [f(1), f(2, { folderKind: "album" }), f(3, { folderKind: "album" })]).keepFileIds,
    ).toEqual([2]);
    // The reason names what separated the winner from the runner-up.
    expect(preselect("phash", [f(1), f(2, { folderKind: "album" })])).toMatchObject({
      keepFileIds: [2],
      reason: "In an album",
    });
  });

  test("E.2: year-only exact duplicates keep one, preferring the copy with a sidecar", () => {
    const r = preselect("sha256", [f(1, { hasSidecar: false }), f(2)]);
    expect(r).toMatchObject({ keepFileIds: [2], reason: "Has a JSON sidecar" });
  });

  test("E.3: a Google copy beats a non-Google copy of the same file", () => {
    const r = preselect("sha256", [f(1, { folderKind: null, hasSidecar: false, folderPriority: 1 }), f(2)]);
    expect(r).toMatchObject({ keepFileIds: [2], reason: "Google Takeout copy (has its JSON)" });
  });

  test("a copy in Trash/Archive is not kept over a normal one", () => {
    expect(preselect("content_hash", [f(1, { folderKind: "special" }), f(2)]).keepFileIds).toEqual([2]);
  });

  test("E.4: near-duplicate tie-breakers — sidecar, resolution, size, EXIF", () => {
    expect(preselect("phash", [f(1, { hasSidecar: false }), f(2)]).reason).toBe("Has a JSON sidecar");
    expect(preselect("phash", [f(1, { pixels: 3_000_000 }), f(2)])).toMatchObject({
      keepFileIds: [2],
      reason: "Higher resolution",
    });
    expect(preselect("phash", [f(1), f(2, { size: 5_000_000 })])).toMatchObject({
      keepFileIds: [2],
      reason: "Larger file",
    });
    expect(preselect("phash", [f(1, { exifFields: 2 }), f(2)])).toMatchObject({
      keepFileIds: [2],
      reason: "More EXIF metadata",
    });
  });

  test("fallbacks: folder priority, then oldest, then lowest id", () => {
    expect(preselect("sha256", [f(1, { folderPriority: 4 }), f(2, { folderPriority: 2 })])).toMatchObject({
      keepFileIds: [2],
      reason: "Higher folder priority",
    });
    expect(preselect("sha256", [f(1), f(2, { dateTaken: new Date("2020-01-01") })])).toMatchObject({
      keepFileIds: [2],
      reason: "Oldest date taken",
    });
    expect(preselect("sha256", [f(5), f(3)])).toMatchObject({
      keepFileIds: [3],
      reason: "Stable fallback (lowest file ID)",
    });
  });

  test("an original and its edited copy in one group are both kept", () => {
    const r = preselect("phash", [
      f(1, { editedPartnerId: 2 }),
      f(2, { editedPartnerId: 1, pixels: 1 }),
      f(3, { pixels: 1 }),
    ]);
    expect(r.keepFileIds).toEqual([1, 2]);
  });

  test("a kept file keeps its motion partner when both are in the group (pairs never split)", () => {
    const r = preselect("sha256", [
      f(1, { folderKind: "album", motionPartnerId: 2 }),
      f(2, { motionPartnerId: 1 }),
      f(3),
    ]);
    expect(r.keepFileIds).toEqual([1, 2]);
  });

  test("never the last copy: every non-clip method keeps at least one file", () => {
    const methods: PreselectMethod[] = ["sha256", "content_hash", "phash"];
    const groups: PreselectFile[][] = [
      [f(1)],
      [f(1, { folderKind: "special" }), f(2, { folderKind: "special" })],
      [f(1, { folderKind: null, hasSidecar: false }), f(2, { folderKind: null, hasSidecar: false })],
    ];
    for (const method of methods) {
      for (const group of groups) {
        const keep = preselect(method, group).keepFileIds;
        expect(keep.length).toBeGreaterThan(0);
        expect(keep.every((id) => group.some((g) => g.id === id))).toBe(true);
      }
    }
  });
});
