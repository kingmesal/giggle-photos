import { describe, expect, test } from "bun:test";
import { detectMediaPairs, type PairMedia } from "./media-pairs";

const folder = (...names: string[]): PairMedia[] => names.map((name, i) => ({ id: i + 1, name }));

describe("detectMediaPairs", () => {
  test("still + companion video with the same base name is a motion pair", () => {
    expect(detectMediaPairs(folder("IMG_0042.HEIC", "IMG_0042.MP4", "IMG_0043.jpg"))).toEqual([
      { kind: "motion", primaryId: 1, secondaryId: 2 },
    ]);
  });

  test("duplicate counters must agree", () => {
    const pairs = detectMediaPairs(folder("IMG_0042.HEIC", "IMG_0042(1).HEIC", "IMG_0042(1).MP4", "IMG_0042.MP4"));
    expect(pairs).toEqual([
      { kind: "motion", primaryId: 2, secondaryId: 3 },
      { kind: "motion", primaryId: 1, secondaryId: 4 },
    ]);
  });

  test("Pixel motion stills pair with a companion with or without the .MP in its name", () => {
    expect(detectMediaPairs(folder("PXL_20240102_101010101.MP.jpg", "PXL_20240102_101010101.mp4"))).toEqual([
      { kind: "motion", primaryId: 1, secondaryId: 2 },
    ]);
    expect(detectMediaPairs(folder("PXL_20240102_101010101.MP.jpg", "PXL_20240102_101010101.MP.mp4"))).toEqual([
      { kind: "motion", primaryId: 1, secondaryId: 2 },
    ]);
  });

  test("a single-file motion photo or a lone video is not a pair", () => {
    expect(detectMediaPairs(folder("PXL_20240102_101010101.MP.jpg", "PXL_20240102_202020202.LS.mp4"))).toEqual([]);
  });

  test("edited copies pair with their original (localized suffixes)", () => {
    expect(
      detectMediaPairs(folder("IMG_0042.jpg", "IMG_0042-edited.jpg", "IMG_0050.jpg", "IMG_0050-bearbeitet.jpg")),
    ).toEqual([
      { kind: "edited", primaryId: 1, secondaryId: 2 },
      { kind: "edited", primaryId: 3, secondaryId: 4 },
    ]);
  });

  test("an edited copy without its original in the folder is not a pair", () => {
    expect(detectMediaPairs(folder("IMG_0042-edited.jpg"))).toEqual([]);
  });

  test("a video is never paired with two stills", () => {
    const pairs = detectMediaPairs(folder("IMG_1.jpg", "IMG_1.heic", "IMG_1.mp4"));
    expect(pairs).toEqual([{ kind: "motion", primaryId: 1, secondaryId: 3 }]);
  });
});
