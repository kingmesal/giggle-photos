import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "bun:test";
import { isTooSmallForExif, MIN_EXIF_PARSE_BYTES } from "./exif-guard";

const dir = mkdtempSync(join(tmpdir(), "exif-guard-"));
const fileOfSize = (bytes: number): string => {
  const path = join(dir, `f${bytes}.jpg`);
  writeFileSync(path, new Uint8Array(bytes));
  return path;
};

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("isTooSmallForExif", () => {
  test("0- and 1-byte files are too small (exifr would leak a FileHandle)", async () => {
    expect(MIN_EXIF_PARSE_BYTES).toBe(2);
    expect(await isTooSmallForExif(fileOfSize(0))).toBe(true);
    expect(await isTooSmallForExif(fileOfSize(1))).toBe(true);
  });

  test("2-byte and larger files go to exifr", async () => {
    expect(await isTooSmallForExif(fileOfSize(2))).toBe(false);
    expect(await isTooSmallForExif(fileOfSize(4096))).toBe(false);
  });

  test("a missing file is not flagged, so the caller's error path still runs", async () => {
    expect(await isTooSmallForExif(join(dir, "does-not-exist.jpg"))).toBe(false);
  });
});
