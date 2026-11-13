import { describe, expect, test } from "bun:test";
import {
  EXPECTED_INHERITED,
  EXPECTED_PAIRS,
  EXPECTED_WITHOUT_SIDECAR,
  SYNTHETIC_TAKEOUT,
} from "./fixtures/synthetic-takeout";
import { classifyTakeoutFolder } from "./folder-classify";
import { type MatchFolder, type MatchMedia, type MatchSidecar, matchSidecars } from "./sidecar-match";

// Turn the fixture into matcher input with stable ids, and keep lookups for readable assertions.
const folders: MatchFolder[] = [];
const media: MatchMedia[] = [];
const sidecars: MatchSidecar[] = [];
const mediaLabel = new Map<number, string>(); // id → "folder/name"
const sidecarLabel = new Map<number, string>();
let nextId = 1;
for (const [index, folder] of Object.values(SYNTHETIC_TAKEOUT).entries()) {
  const { kind, year } = classifyTakeoutFolder(folder.name);
  const folderId = index + 1;
  folders.push({ id: folderId, rootId: 1, kind, year });
  for (const name of folder.media) {
    const id = nextId++;
    media.push({ id, folderId, name });
    mediaLabel.set(id, `${folder.name}/${name}`);
  }
  for (const sc of folder.sidecars) {
    const id = nextId++;
    const photoTakenTime = sc.takenYear ? new Date(Date.UTC(sc.takenYear, 5, 1)) : null;
    sidecars.push({ id, folderId, name: sc.name, title: sc.title, photoTakenTime });
    sidecarLabel.set(id, `${folder.name}/${sc.name}`);
  }
}
const result = matchSidecars(folders, media, sidecars);

describe("matchSidecars on the synthetic Takeout", () => {
  for (const folder of Object.values(SYNTHETIC_TAKEOUT)) {
    for (const sc of folder.sidecars) {
      const label = `${folder.name}/${sc.name}`;
      test(`${label} → ${sc.expect ? `${sc.expect.folder ?? folder.name}/${sc.expect.media} (${sc.expect.method})` : "unmatched"}`, () => {
        const sidecarId = [...sidecarLabel].find(([, l]) => l === label)?.[0];
        const link = result.links.find((l) => l.sidecarId === sidecarId);
        if (sc.expect === null) {
          expect(link).toBeUndefined();
          expect(result.unmatchedSidecarIds).toContain(sidecarId as number);
        } else {
          expect(link && mediaLabel.get(link.mediaFileId)).toBe(
            `${sc.expect.folder ?? folder.name}/${sc.expect.media}`,
          );
          expect(link?.method).toBe(sc.expect.method as NonNullable<typeof link>["method"]);
        }
      });
    }
  }

  test("pairs", () => {
    const labels = result.pairs.map((p) => {
      const primary = mediaLabel.get(p.primaryId) as string;
      return `${primary} → ${(mediaLabel.get(p.secondaryId) as string).split("/")[1]} (${p.kind})`;
    });
    expect(labels.sort()).toEqual([...EXPECTED_PAIRS].sort());
  });

  test("pair secondaries inherit the primary's sidecar", () => {
    const labels = result.inherited.map((i) => `${mediaLabel.get(i.mediaFileId)} (${i.method})`);
    expect(labels.sort()).toEqual([...EXPECTED_INHERITED].sort());
  });

  test("media without any sidecar are reported, nothing else", () => {
    expect(result.mediaWithoutSidecarIds.map((id) => mediaLabel.get(id))).toEqual(EXPECTED_WITHOUT_SIDECAR);
  });

  test("each media file has at most one sidecar of its own (album references aside)", () => {
    const own = result.links.filter((l) => l.method !== "album_reference").map((l) => l.mediaFileId);
    expect(new Set(own).size).toBe(own.length);
  });
});

describe("matchSidecars edge cases", () => {
  test("an ambiguous album reference (same name in two year folders, no taken time) stays unmatched", () => {
    const r = matchSidecars(
      [
        { id: 1, rootId: 1, kind: "year", year: 2020 },
        { id: 2, rootId: 1, kind: "year", year: 2021 },
        { id: 3, rootId: 1, kind: "album", year: null },
      ],
      [
        { id: 10, folderId: 1, name: "IMG_1.jpg" },
        { id: 11, folderId: 2, name: "IMG_1.jpg" },
      ],
      [{ id: 20, folderId: 3, name: "IMG_1.jpg.json", title: "IMG_1.jpg", photoTakenTime: null }],
    );
    expect(r.unmatchedSidecarIds).toEqual([20]);
  });

  test("files outside a Takeout are never reported as missing a sidecar", () => {
    const r = matchSidecars(
      [{ id: 1, rootId: 0, kind: "non_takeout", year: null }],
      [{ id: 1, folderId: 1, name: "a.jpg" }],
      [],
    );
    expect(r.mediaWithoutSidecarIds).toEqual([]);
  });
});
