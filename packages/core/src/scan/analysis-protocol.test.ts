import { describe, expect, test } from "bun:test";
import { categorizeAnalysisError, pickExif } from "./analysis-protocol";

describe("categorizeAnalysisError", () => {
  // Messages below are the exact texts observed from sharp/libvips/Bun on the benchmark sample.
  test.each([
    ["VipsJpeg: premature end of JPEG image", "corrupt_or_truncated"],
    ["Warning treated as error due to failOn setting", "corrupt_or_truncated"],
    ["Warning treated as error due to failOn setting\nerror in tile 0 x 1224", "corrupt_or_truncated"],
    ["ENOENT: no such file or directory, open '/x.jpg'", "file_not_found"],
    ["EACCES: permission denied, open '/x.jpg'", "permission_denied"],
    ["something nobody anticipated", "unknown"],
  ])("%p → %s", (message, category) => {
    expect(categorizeAnalysisError(message, "jpg").category).toBe(category);
  });

  test("unsupported formats keep the extension, even when the text also says 'corrupt'", () => {
    expect(categorizeAnalysisError("Input buffer contains unsupported image format", "heic")).toEqual({
      category: "unsupported_format",
      message: "Input buffer contains unsupported image format",
      format: "heic",
    });
    expect(
      categorizeAnalysisError("Input file has corrupt header: heif: Unsupported feature: Unsupported codec", "heic")
        .category,
    ).toBe("unsupported_format");
  });
});

describe("pickExif", () => {
  test("keeps only the fields the metadata mapping uses, with dates as ISO strings", () => {
    const picked = pickExif({
      Orientation: 6,
      Make: "Google",
      DateTimeOriginal: new Date("2021-07-04T12:30:00Z"),
      latitude: 47.6,
      MakerNote: new Uint8Array(1000),
      thumbnail: { a: 1 },
    });
    expect(picked).toEqual({
      Orientation: 6,
      Make: "Google",
      DateTimeOriginal: "2021-07-04T12:30:00.000Z",
      latitude: 47.6,
    });
  });

  test("returns null when nothing useful is present", () => {
    expect(pickExif(undefined)).toBeNull();
    expect(pickExif({ MakerNote: new Uint8Array(4), DateTime: new Date("not a date") })).toBeNull();
  });
});
