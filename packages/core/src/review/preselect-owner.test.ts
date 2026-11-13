import { describe, expect, test } from "bun:test";
import { type PreselectFile, preselect } from "./preselect";

// RFD-005: two people's Takeouts. Files 1–2 are in Jim's folder, 3–4 in Heather's; the photo was
// taken with Heather's phone, so her folder's copies are "owned".
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
  ownedDevice: false,
  ...over,
});
const jimAlbum = f(1, { folderKind: "album" });
const jimYear = f(2);
const heatherYear = f(3, { ownedDevice: true });
const heatherAlbum = f(4, { folderKind: "album", ownedDevice: true });

describe("preselect — owner devices (RFD-005)", () => {
  test("without an album copy, the owner's copy is kept", () => {
    const r = preselect("sha256", [jimYear, heatherYear]);
    expect(r).toMatchObject({ keepFileIds: [3], reason: "Taken with this folder owner's device" });
  });

  test("default order (album first): the other person's album copy beats the owner's year copy", () => {
    const r = preselect("sha256", [jimAlbum, jimYear, heatherYear]);
    expect(r).toMatchObject({ keepFileIds: [1], rule: "album_copies" });
  });

  test("owner first: the owner's year copy wins over the other person's album copy", () => {
    const r = preselect("sha256", [jimAlbum, jimYear, heatherYear], ["owner_device", "album"]);
    expect(r).toMatchObject({ keepFileIds: [3], rule: "best_copy", reason: "Taken with this folder owner's device" });
  });

  test("owner first, then album: keeps the owner's album copies only", () => {
    const r = preselect("sha256", [jimAlbum, jimYear, heatherYear, heatherAlbum], ["owner_device", "album"]);
    expect(r).toMatchObject({ keepFileIds: [4], rule: "album_copies" });
    expect(r.reason).toBe("Taken with this folder owner's device; album copy beats year folder");
  });

  test("album first, then owner: every album copy is kept (both people's albums)", () => {
    const r = preselect("sha256", [jimAlbum, jimYear, heatherYear, heatherAlbum]);
    expect(r).toMatchObject({ keepFileIds: [1, 4], rule: "album_copies", reason: "Keep every album copy" });
  });

  test("owner rule breaks ties among near-duplicates and same-content copies", () => {
    expect(preselect("phash", [f(1, { pixels: 20_000_000 }), heatherYear]).keepFileIds).toEqual([3]);
    expect(preselect("content_hash", [jimYear, heatherYear]).keepFileIds).toEqual([3]);
  });

  test("no file owned, or every file owned: the rule does not decide", () => {
    expect(preselect("sha256", [jimYear, f(5)]).reason).not.toMatch(/owner/);
    expect(preselect("sha256", [heatherYear, f(6, { ownedDevice: true })]).reason).not.toMatch(/owner/);
  });

  test("a kept owner copy keeps its motion video", () => {
    const r = preselect("sha256", [
      jimYear,
      f(3, { ownedDevice: true, motionPartnerId: 9 }),
      f(9, { ownedDevice: false }),
    ]);
    expect(r.keepFileIds).toEqual([3, 9]);
  });
});
