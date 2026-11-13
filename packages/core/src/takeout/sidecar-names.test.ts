import { describe, expect, test } from "bun:test";
import { parseMediaName, parseSidecarName, SIDECAR_NAME_CAP, sidecarNameRefersTo } from "./sidecar-names";

/** Does sidecar `json` describe media `media`? (Synthetic names following observed Takeout patterns.) */
const refers = (json: string, media: string) =>
  sidecarNameRefersTo(
    parseSidecarName(json) as NonNullable<ReturnType<typeof parseSidecarName>>,
    parseMediaName(media),
  );

describe("parseSidecarName", () => {
  test("classic and supplemental forms", () => {
    expect(parseSidecarName("PXL_20240102_101010101.jpg.json")).toEqual({
      base: "PXL_20240102_101010101.jpg",
      counter: null,
      supplemental: false,
      truncated: false,
    });
    expect(parseSidecarName("IMG_0042.jpg.supplemental-metadata.json")).toMatchObject({
      base: "IMG_0042.jpg",
      supplemental: true,
    });
  });

  test("counters in both positions", () => {
    expect(parseSidecarName("IMG_0042.JPG(2).json")).toMatchObject({ base: "IMG_0042.JPG", counter: 2 });
    expect(parseSidecarName("IMG_0042.jpg.supplemental-metadata(3).json")).toMatchObject({
      base: "IMG_0042.jpg",
      counter: 3,
      supplemental: true,
    });
  });

  test("a cut-down 'supplemental-metadata' is recognised only at the length cap", () => {
    const capped = "Screenshot_20240311_084512_Messages.jpg.supple.json";
    expect(capped.length).toBe(SIDECAR_NAME_CAP);
    expect(parseSidecarName(capped)).toMatchObject({
      base: "Screenshot_20240311_084512_Messages.jpg",
      supplemental: true,
      truncated: true,
    });
    // Short name with a ".supple" segment: not truncated, so it is part of the name.
    expect(parseSidecarName("odd.supple.json")).toMatchObject({ base: "odd.supple", supplemental: false });
  });

  test("the counter is appended after the cap is applied", () => {
    const capped = "Screenshot_20240311_084512_Messages.jpg.supple(1).json";
    expect(parseSidecarName(capped)).toMatchObject({ counter: 1, truncated: true, supplemental: true });
  });

  test("non-JSON files are not sidecars", () => {
    expect(parseSidecarName("IMG_0042.jpg")).toBeNull();
  });
});

describe("parseMediaName", () => {
  test("counter, extension, edited copies (localized)", () => {
    expect(parseMediaName("IMG_0042(1).JPG")).toEqual({
      name: "IMG_0042(1).JPG",
      counterless: "IMG_0042.JPG",
      counter: 1,
      extension: "JPG",
      editedOf: null,
    });
    expect(parseMediaName("IMG_0042-edited.jpg").editedOf).toBe("IMG_0042.jpg");
    expect(parseMediaName("IMG_0042-bearbeitet.jpg").editedOf).toBe("IMG_0042.jpg");
    expect(parseMediaName("IMG_0042-modifié.jpg".normalize("NFD")).editedOf).toBe("IMG_0042.jpg");
    expect(parseMediaName("-edited.jpg").editedOf).toBeNull();
  });
});

describe("sidecarNameRefersTo", () => {
  test.each([
    // [sidecar, media, expected]
    ["PXL_20240102_101010101.jpg.json", "PXL_20240102_101010101.jpg", "exact"],
    ["PXL_20240102_101010101.jpg.json", "PXL_20240102_101010102.jpg", null],
    ["PXL_20240102_101010101.MP.jpg.json", "PXL_20240102_101010101.MP.jpg", "exact"],
    ["PXL_20240102_101010101.MP~2.jpg.json", "PXL_20240102_101010101.MP~2.jpg", "exact"],
    ["IMG_0042.JPG(1).json", "IMG_0042(1).JPG", "exact"],
    ["IMG_0042.JPG(2).json", "IMG_0042(1).JPG", null],
    ["IMG_0042.JPG(1).json", "IMG_0042.JPG", null],
    ["IMG_0042.JPG.json", "IMG_0042(1).JPG", null],
    ["IMG_0042.jpg.supplemental-metadata(1).json", "IMG_0042(1).jpg", "exact"],
    ["CLIP0007.AVI.supplemental-metadata(12).json", "CLIP0007(12).AVI", "exact"],
    ["Screenshot_20240311_084512_Messages.jpg.supple.json", "Screenshot_20240311_084512_Messages.jpg", "exact"],
    ["Screenshot_20240311_084512_Messages.jpg.supple(1).json", "Screenshot_20240311_084512_Messages(1).jpg", "exact"],
    // The media name itself was cut: 46 characters + ".json" = 51.
    [
      "Screenshot_2024-03-11-08-45-12-123_com.whatsap.json",
      "Screenshot_2024-03-11-08-45-12-123_com.whatsapp.jpg",
      "truncated",
    ],
    // A "(1)" that is part of the original name, with no sidecar counter.
    ["PXL_20240615_101533000(1).jpg.supplemental-metadata.json", "PXL_20240615_101533000(1).jpg", "exact"],
  ])("%p ↔ %p → %p", (json, media, expected) => {
    expect(refers(json, media)).toBe(expected as "exact" | "truncated" | null);
  });

  test("the truncated fixture really is at the cap", () => {
    expect("Screenshot_2024-03-11-08-45-12-123_com.whatsap.json".length).toBe(SIDECAR_NAME_CAP);
  });
});
