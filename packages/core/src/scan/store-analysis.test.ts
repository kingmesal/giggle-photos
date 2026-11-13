import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { UpdateMediaFile } from "../zod/media-file";
import type { AnalysisResponse } from "./analysis-protocol";

const mockExtractImageMetadata = mock(async (_id: number, _path: string, _prefetched?: unknown) => {});
mock.module("./metadata-image", () => ({ extractImageMetadata: mockExtractImageMetadata }));

import { createHashStats, storeImageAnalysis } from "./store-analysis";

const SHA = "a".repeat(64);
const file = { id: 7, path: "/photos/IMG_1.jpg" };
let updates: UpdateMediaFile[];
const mediaFiles = {
  updateMediaFile: async (data: UpdateMediaFile) => {
    updates.push(data);
  },
};
const ok: AnalysisResponse = {
  id: 1,
  sha256: SHA,
  exif: { Orientation: 6 },
  decoded: { width: 10, height: 20, format: "jpeg", hasAlpha: false },
  contentHash: "b".repeat(64),
  perceptualHash: "0123456789abcdef",
  timings: {},
};

beforeEach(() => {
  updates = [];
  mockExtractImageMetadata.mockClear();
});

describe("storeImageAnalysis", () => {
  test("success: one update with all hashes and status hashed; metadata from the worker", async () => {
    const stats = createHashStats();
    expect(await storeImageAnalysis(file, ok, mediaFiles, stats)).toBeNull();
    expect(updates).toEqual([
      { id: 7, sha256Hash: SHA, contentHash: ok.contentHash, perceptualHash: ok.perceptualHash, status: "hashed" },
    ]);
    expect(mockExtractImageMetadata).toHaveBeenCalledWith(7, file.path, { exif: ok.exif, decoded: ok.decoded });
    expect(stats.processed).toBe(1);
    expect(stats.errors).toBe(0);
    expect(stats.algorithmStats.perceptualHash.computed).toBe(1);
  });

  test("decode failure: an error (not a skip), sha256 still stored, unsupported formats counted per format", async () => {
    const stats = createHashStats();
    const response: AnalysisResponse = {
      id: 2,
      sha256: SHA,
      exif: null,
      timings: {},
      failure: { category: "unsupported_format", message: "Unsupported codec", format: "heic" },
    };
    const error = await storeImageAnalysis(file, response, mediaFiles, stats);

    expect(error?.breakdownKey).toBe("unsupported_format:heic");
    expect(updates).toEqual([
      { id: 7, sha256Hash: SHA, status: "error", errorMessage: "unsupported_format:heic: Unsupported codec" },
    ]);
    expect(stats.errors).toBe(1);
    expect(stats.skipped).toBe(0);
    expect(stats.errorBreakdown).toEqual({ "unsupported_format:heic": 1 });
    expect(stats.algorithmStats.contentHash.errors).toBe(1);
    // Metadata is still recorded (fallback values) so the file shows up with what is known.
    expect(mockExtractImageMetadata).toHaveBeenCalledTimes(1);
  });

  test("read failure: no sha256, no metadata row, categorized error", async () => {
    const stats = createHashStats();
    const response: AnalysisResponse = {
      id: 3,
      timings: {},
      failure: { category: "file_not_found", message: "ENOENT: no such file" },
    };
    await storeImageAnalysis(file, response, mediaFiles, stats);
    expect(updates[0]).toEqual({ id: 7, status: "error", errorMessage: "file_not_found: ENOENT: no such file" });
    expect(stats.algorithmStats.sha256.errors).toBe(1);
    expect(stats.errorBreakdown).toEqual({ file_not_found: 1 });
    expect(mockExtractImageMetadata).not.toHaveBeenCalled();
  });

  test("a response with no hashes and no failure is still an error", async () => {
    const stats = createHashStats();
    const { contentHash: _c, perceptualHash: _p, ...partial } = ok;
    await storeImageAnalysis(file, partial, mediaFiles, stats);
    expect(stats.errorBreakdown).toEqual({ unknown: 1 });
    expect(updates[0]?.status).toBe("error");
  });
});
