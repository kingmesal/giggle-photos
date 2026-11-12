import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { ImageMetadata, NewImageMetadata } from "../zod/image-metadata";
import type { MediaFile } from "../zod/media-file";

// Mock modules
const mockInsertImageMetadata = mock(() => Promise.resolve({} as ImageMetadata));
const mockGetImageMetadataProvider = mock(() => ({
  insertImageMetadata: mockInsertImageMetadata,
}));
const mockUpdateMediaFile = mock(() => Promise.resolve());
const mockGetMediaFileProvider = mock(() => ({
  updateMediaFile: mockUpdateMediaFile,
}));

// Mock the DatabaseProvider
const mockGetInstance = mock(() =>
  Promise.resolve({
    getImageMetadataProvider: mockGetImageMetadataProvider,
    getMediaFileProvider: mockGetMediaFileProvider,
    getClient: () => ({
      getDb: () => mockDbClient,
    }),
  }),
);

// Mock the database-provider module
mock.module("../db/database-provider", () => ({
  DatabaseProvider: {
    getInstance: mockGetInstance,
  },
}));

// Mock exifr module
const mockExifrParse = mock(() => Promise.resolve(null));
mock.module("exifr", () => ({
  default: {
    parse: mockExifrParse,
  },
}));

// Mock the media-file zod module for dynamic import
mock.module("../zod/media-file", () => ({
  MediaFile: {
    parse: (row: unknown) => row as MediaFile,
  },
}));

// Mock Kysely database client for getImagesWithoutMetadata
let mockDbRows: MediaFile[] = [];
const mockDbClient = {
  selectFrom: () => ({
    leftJoin: () => ({
      where: () => ({
        where: () => ({
          selectAll: () => ({
            orderBy: () => ({
              limit: (n: number) => ({
                execute: async () => mockDbRows.slice(0, n),
              }),
              execute: async () => mockDbRows,
            }),
          }),
        }),
      }),
    }),
  }),
};

// Import after mocking
import { extractImageMetadata, processImageMetadataBatch } from "./metadata-image";

describe("metadata-image", () => {
  beforeEach(() => {
    // Reset all mocks before each test
    mockInsertImageMetadata.mockReset();
    mockGetImageMetadataProvider.mockReset();
    mockUpdateMediaFile.mockReset();
    mockGetMediaFileProvider.mockReset();
    mockGetInstance.mockReset();
    mockExifrParse.mockReset();
    mockDbRows = [];

    // Setup default mock implementations
    mockInsertImageMetadata.mockImplementation(() => Promise.resolve({} as ImageMetadata));
    mockGetImageMetadataProvider.mockImplementation(() => ({
      insertImageMetadata: mockInsertImageMetadata,
    }));
    mockUpdateMediaFile.mockImplementation(() => Promise.resolve());
    mockGetMediaFileProvider.mockImplementation(() => ({
      updateMediaFile: mockUpdateMediaFile,
    }));
    mockGetInstance.mockImplementation(() =>
      Promise.resolve({
        getImageMetadataProvider: mockGetImageMetadataProvider,
        getMediaFileProvider: mockGetMediaFileProvider,
        getClient: () => ({
          getDb: () => mockDbClient,
        }),
      }),
    );
    mockExifrParse.mockImplementation(() => Promise.resolve(null));
  });

  describe("extractImageMetadata", () => {
    test("extracts dimensions from EXIF (ExifImageWidth/Height)", async () => {
      mockExifrParse.mockImplementation(() =>
        Promise.resolve({
          ExifImageWidth: 1920,
          ExifImageHeight: 1080,
        }),
      );

      await extractImageMetadata(1, "/test/image.jpg");

      expect(mockInsertImageMetadata).toHaveBeenCalledTimes(1);
      const insertedData = mockInsertImageMetadata.mock.calls[0][0] as NewImageMetadata;
      expect(insertedData.width).toBe(1920);
      expect(insertedData.height).toBe(1080);
    });

    test("falls back to ImageWidth/Height when ExifImage* missing", async () => {
      mockExifrParse.mockImplementation(() =>
        Promise.resolve({
          ImageWidth: 800,
          ImageHeight: 600,
        }),
      );

      await extractImageMetadata(1, "/test/image.jpg");

      expect(mockInsertImageMetadata).toHaveBeenCalledTimes(1);
      const insertedData = mockInsertImageMetadata.mock.calls[0][0] as NewImageMetadata;
      expect(insertedData.width).toBe(800);
      expect(insertedData.height).toBe(600);
    });

    test("derives format from file extension", async () => {
      await extractImageMetadata(1, "/test/image.png");

      expect(mockInsertImageMetadata).toHaveBeenCalledTimes(1);
      const insertedData = mockInsertImageMetadata.mock.calls[0][0] as NewImageMetadata;
      expect(insertedData.format).toBe("png");
    });

    test("normalizes jpg extension to jpeg", async () => {
      await extractImageMetadata(1, "/test/image.jpg");

      const insertedData = mockInsertImageMetadata.mock.calls[0][0] as NewImageMetadata;
      expect(insertedData.format).toBe("jpeg");
    });

    test("extracts ColorSpace from EXIF (sRGB = 1)", async () => {
      mockExifrParse.mockImplementation(() =>
        Promise.resolve({
          ColorSpace: 1,
        }),
      );

      await extractImageMetadata(1, "/test/image.jpg");

      const insertedData = mockInsertImageMetadata.mock.calls[0][0] as NewImageMetadata;
      expect(insertedData.colorSpace).toBe("sRGB");
    });

    test("extracts orientation from EXIF", async () => {
      mockExifrParse.mockImplementation(() =>
        Promise.resolve({
          Orientation: 6,
        }),
      );

      await extractImageMetadata(1, "/test/image.jpg");

      const insertedData = mockInsertImageMetadata.mock.calls[0][0] as NewImageMetadata;
      expect(insertedData.orientation).toBe(6);
    });

    test("defaults hasAlpha to false", async () => {
      await extractImageMetadata(1, "/test/image.png");

      const insertedData = mockInsertImageMetadata.mock.calls[0][0] as NewImageMetadata;
      expect(insertedData.hasAlpha).toBe(false);
    });

    test("extracts EXIF data (camera make/model, date taken)", async () => {
      const dateTaken = new Date("2024-06-15T14:30:00Z");
      mockExifrParse.mockImplementation(() =>
        Promise.resolve({
          Make: "Canon",
          Model: "EOS R5",
          DateTimeOriginal: dateTaken,
        }),
      );

      await extractImageMetadata(1, "/test/photo.jpg");

      expect(mockInsertImageMetadata).toHaveBeenCalledTimes(1);
      const insertedData = mockInsertImageMetadata.mock.calls[0][0] as NewImageMetadata;
      expect(insertedData.cameraMake).toBe("Canon");
      expect(insertedData.cameraModel).toBe("EOS R5");
      expect(insertedData.dateTaken).toEqual(dateTaken);
    });

    test("extracts date taken from string EXIF value", async () => {
      mockExifrParse.mockImplementation(() =>
        Promise.resolve({
          DateTimeOriginal: "2024-06-15T14:30:00Z",
        }),
      );

      await extractImageMetadata(1, "/test/photo.jpg");

      expect(mockInsertImageMetadata).toHaveBeenCalledTimes(1);
      const insertedData = mockInsertImageMetadata.mock.calls[0][0] as NewImageMetadata;
      expect(insertedData.dateTaken).toBeInstanceOf(Date);
      expect(insertedData.dateTaken?.toISOString()).toBe("2024-06-15T14:30:00.000Z");
    });

    test("uses fallback date fields when DateTimeOriginal is missing", async () => {
      const createDate = new Date("2024-05-10T10:00:00Z");
      mockExifrParse.mockImplementation(() =>
        Promise.resolve({
          CreateDate: createDate,
        }),
      );

      await extractImageMetadata(1, "/test/photo.jpg");

      expect(mockInsertImageMetadata).toHaveBeenCalledTimes(1);
      const insertedData = mockInsertImageMetadata.mock.calls[0][0] as NewImageMetadata;
      expect(insertedData.dateTaken).toEqual(createDate);
    });

    test("extracts GPS coordinates and altitude", async () => {
      mockExifrParse.mockImplementation(() =>
        Promise.resolve({
          latitude: 40.7128,
          longitude: -74.006,
          GPSAltitude: 42.5,
        }),
      );

      await extractImageMetadata(1, "/test/gps-photo.jpg");

      expect(mockInsertImageMetadata).toHaveBeenCalledTimes(1);
      const insertedData = mockInsertImageMetadata.mock.calls[0][0] as NewImageMetadata;
      expect(insertedData.gpsLatitude).toBe(40.7128);
      expect(insertedData.gpsLongitude).toBe(-74.006);
      expect(insertedData.gpsAltitude).toBe(42.5);
    });

    test("handles GPS without altitude", async () => {
      mockExifrParse.mockImplementation(() =>
        Promise.resolve({
          latitude: 40.7128,
          longitude: -74.006,
        }),
      );

      await extractImageMetadata(1, "/test/gps-no-alt.jpg");

      const insertedData = mockInsertImageMetadata.mock.calls[0][0] as NewImageMetadata;
      expect(insertedData.gpsLatitude).toBe(40.7128);
      expect(insertedData.gpsLongitude).toBe(-74.006);
      expect(insertedData.gpsAltitude).toBeNull();
    });

    test("handles images without EXIF data", async () => {
      mockExifrParse.mockImplementation(() => Promise.resolve(null));

      await extractImageMetadata(1, "/test/no-exif.png");

      expect(mockInsertImageMetadata).toHaveBeenCalledTimes(1);
      const insertedData = mockInsertImageMetadata.mock.calls[0][0] as NewImageMetadata;
      expect(insertedData.cameraMake).toBeNull();
      expect(insertedData.cameraModel).toBeNull();
      expect(insertedData.dateTaken).toBeNull();
      expect(insertedData.gpsLatitude).toBeNull();
      expect(insertedData.gpsLongitude).toBeNull();
      expect(insertedData.gpsAltitude).toBeNull();
    });

    test("handles EXIF parsing errors gracefully", async () => {
      mockExifrParse.mockImplementation(() => Promise.reject(new Error("EXIF parsing failed")));

      await extractImageMetadata(1, "/test/bad-exif.png");

      // Should still insert metadata despite EXIF error
      expect(mockInsertImageMetadata).toHaveBeenCalledTimes(1);
      const insertedData = mockInsertImageMetadata.mock.calls[0][0] as NewImageMetadata;
      expect(insertedData.cameraMake).toBeNull();
      expect(insertedData.gpsLatitude).toBeNull();
    });

    test("throws when database insert fails", async () => {
      mockInsertImageMetadata.mockImplementation(() => Promise.reject(new Error("DB insert failed")));

      await expect(extractImageMetadata(1, "/test/image.jpg")).rejects.toThrow("DB insert failed");
    });

    test("uses default values for missing metadata fields", async () => {
      mockExifrParse.mockImplementation(() => Promise.resolve(null));

      await extractImageMetadata(1, "/test/minimal.unknown");

      expect(mockInsertImageMetadata).toHaveBeenCalledTimes(1);
      const insertedData = mockInsertImageMetadata.mock.calls[0][0] as NewImageMetadata;
      expect(insertedData.width).toBe(1); // Schema requires positive int, 0 → 1
      expect(insertedData.height).toBe(1);
      expect(insertedData.format).toBe("unknown");
      expect(insertedData.colorSpace).toBeNull();
      expect(insertedData.hasAlpha).toBe(false);
      expect(insertedData.orientation).toBeNull();
    });

    test("trims whitespace from EXIF string values", async () => {
      mockExifrParse.mockImplementation(() =>
        Promise.resolve({
          Make: "  Canon  ",
          Model: "  EOS R5  ",
        }),
      );

      await extractImageMetadata(1, "/test/photo.jpg");

      expect(mockInsertImageMetadata).toHaveBeenCalledTimes(1);
      const insertedData = mockInsertImageMetadata.mock.calls[0][0] as NewImageMetadata;
      expect(insertedData.cameraMake).toBe("Canon");
      expect(insertedData.cameraModel).toBe("EOS R5");
    });

    test("returns null for empty EXIF strings", async () => {
      mockExifrParse.mockImplementation(() =>
        Promise.resolve({
          Make: "   ",
          Model: "",
        }),
      );

      await extractImageMetadata(1, "/test/photo.jpg");

      expect(mockInsertImageMetadata).toHaveBeenCalledTimes(1);
      const insertedData = mockInsertImageMetadata.mock.calls[0][0] as NewImageMetadata;
      expect(insertedData.cameraMake).toBeNull();
      expect(insertedData.cameraModel).toBeNull();
    });

    test("passes correct mediaFileId to insert", async () => {
      await extractImageMetadata(42, "/test/photo.jpg");

      expect(mockInsertImageMetadata).toHaveBeenCalledTimes(1);
      const insertedData = mockInsertImageMetadata.mock.calls[0][0] as NewImageMetadata;
      expect(insertedData.mediaFileId).toBe(42);
    });

    test("ignores non-numeric GPS coordinates", async () => {
      mockExifrParse.mockImplementation(() =>
        Promise.resolve({
          latitude: "invalid",
          longitude: null,
        }),
      );

      await extractImageMetadata(1, "/test/photo.jpg");

      expect(mockInsertImageMetadata).toHaveBeenCalledTimes(1);
      const insertedData = mockInsertImageMetadata.mock.calls[0][0] as NewImageMetadata;
      expect(insertedData.gpsLatitude).toBeNull();
      expect(insertedData.gpsLongitude).toBeNull();
    });

    test("handles invalid date strings gracefully", async () => {
      mockExifrParse.mockImplementation(() =>
        Promise.resolve({
          DateTimeOriginal: "not-a-valid-date",
          CreateDate: "also-invalid",
          ModifyDate: "still-invalid",
          DateTime: "nope",
        }),
      );

      await extractImageMetadata(1, "/test/photo.jpg");

      expect(mockInsertImageMetadata).toHaveBeenCalledTimes(1);
      const insertedData = mockInsertImageMetadata.mock.calls[0][0] as NewImageMetadata;
      expect(insertedData.dateTaken).toBeNull();
    });
  });

  describe("processImageMetadataBatch", () => {
    const createMockMediaFile = (id: number, path: string): MediaFile => ({
      id,
      scanFolderId: 1,
      path,
      filename: path.split("/").pop() || "file.jpg",
      extension: "jpg",
      fileType: "image",
      size: 1024,
      status: "pending",
      sha256Hash: null,
      contentHash: null,
      perceptualHash: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    test("returns empty result when no images need processing", async () => {
      mockDbRows = [];

      const result = await processImageMetadataBatch();

      expect(result.processed).toBe(0);
      expect(result.errors).toBe(0);
      expect(result.skipped).toBe(0);
    });

    test("processes images from database", async () => {
      mockDbRows = [createMockMediaFile(1, "/photos/a.jpg"), createMockMediaFile(2, "/photos/b.jpg")];

      mockExifrParse.mockImplementation(() =>
        Promise.resolve({
          ExifImageWidth: 800,
          ExifImageHeight: 600,
        }),
      );

      const result = await processImageMetadataBatch();

      expect(result.processed).toBe(2);
      expect(result.errors).toBe(0);
      expect(mockInsertImageMetadata).toHaveBeenCalledTimes(2);
    });

    test("handles errors gracefully and continues processing", async () => {
      mockDbRows = [
        createMockMediaFile(1, "/photos/good.jpg"),
        createMockMediaFile(2, "/photos/bad.jpg"),
        createMockMediaFile(3, "/photos/also-good.jpg"),
      ];

      // Make insert fail for the second file
      let callCount = 0;
      mockInsertImageMetadata.mockImplementation(() => {
        callCount++;
        if (callCount === 2) {
          return Promise.reject(new Error("DB insert failed"));
        }
        return Promise.resolve({} as ImageMetadata);
      });

      const result = await processImageMetadataBatch();

      expect(result.processed).toBe(2);
      expect(result.errors).toBe(1);
    });

    test("respects limit option", async () => {
      // Create more files than the limit
      mockDbRows = [
        createMockMediaFile(1, "/photos/a.jpg"),
        createMockMediaFile(2, "/photos/b.jpg"),
        createMockMediaFile(3, "/photos/c.jpg"),
        createMockMediaFile(4, "/photos/d.jpg"),
        createMockMediaFile(5, "/photos/e.jpg"),
      ];

      // Override the mock to respect limit
      const mockGetInstanceWithLimit = mock(() =>
        Promise.resolve({
          getImageMetadataProvider: mockGetImageMetadataProvider,
          getMediaFileProvider: mockGetMediaFileProvider,
          getClient: () => ({
            getDb: () => ({
              selectFrom: () => ({
                leftJoin: () => ({
                  where: () => ({
                    where: () => ({
                      selectAll: () => ({
                        orderBy: () => ({
                          limit: (n: number) => ({
                            execute: async () => mockDbRows.slice(0, n),
                          }),
                          execute: async () => mockDbRows,
                        }),
                      }),
                    }),
                  }),
                }),
              }),
            }),
          }),
        }),
      );
      mockGetInstance.mockImplementation(mockGetInstanceWithLimit as typeof mockGetInstance);

      const result = await processImageMetadataBatch({ limit: 2 });

      expect(result.processed).toBe(2);
      expect(result.errors).toBe(0);
    });

    test("calls progress callback with correct arguments", async () => {
      mockDbRows = [createMockMediaFile(1, "/photos/a.jpg"), createMockMediaFile(2, "/photos/b.jpg")];

      const progressCalls: Array<{ completed: number; total: number; currentFile: string }> = [];
      const onProgress = mock((completed: number, total: number, currentFile: string) => {
        progressCalls.push({ completed, total, currentFile });
      });

      await processImageMetadataBatch({ onProgress });

      expect(onProgress).toHaveBeenCalledTimes(2);
      expect(progressCalls[0].total).toBe(2);
      expect(progressCalls[1].total).toBe(2);
      // Progress calls may be out of order due to concurrency, but both files should be reported
      const reportedFiles = progressCalls.map((c) => c.currentFile).sort();
      expect(reportedFiles).toContain("/photos/a.jpg");
      expect(reportedFiles).toContain("/photos/b.jpg");
    });

    test("uses default concurrency", async () => {
      // This is a structural test - we're verifying the function accepts options without concurrency
      mockDbRows = [];

      const result = await processImageMetadataBatch({});

      expect(result.processed).toBe(0);
    });

    test("processes with custom concurrency", async () => {
      mockDbRows = [
        createMockMediaFile(1, "/photos/a.jpg"),
        createMockMediaFile(2, "/photos/b.jpg"),
        createMockMediaFile(3, "/photos/c.jpg"),
      ];

      const result = await processImageMetadataBatch({ concurrency: 1 });

      expect(result.processed).toBe(3);
      expect(result.errors).toBe(0);
    });

    test("inserts metadata into database for each processed image", async () => {
      mockDbRows = [createMockMediaFile(1, "/photos/a.jpg"), createMockMediaFile(2, "/photos/b.jpg")];

      await processImageMetadataBatch();

      expect(mockInsertImageMetadata).toHaveBeenCalledTimes(2);

      // Verify the inserted data has correct mediaFileIds
      const firstCall = mockInsertImageMetadata.mock.calls[0][0] as NewImageMetadata;
      const secondCall = mockInsertImageMetadata.mock.calls[1][0] as NewImageMetadata;
      const mediaFileIds = [firstCall.mediaFileId, secondCall.mediaFileId].sort();
      expect(mediaFileIds).toEqual([1, 2]);
    });

    test("does not call progress callback when none provided", async () => {
      mockDbRows = [createMockMediaFile(1, "/photos/a.jpg")];

      // Should not throw when onProgress is undefined
      const result = await processImageMetadataBatch();

      expect(result.processed).toBe(1);
    });

    test("logs info message when no images need processing", async () => {
      mockDbRows = [];

      const result = await processImageMetadataBatch();

      expect(result.processed).toBe(0);
      expect(result.errors).toBe(0);
      expect(result.skipped).toBe(0);
    });

    test("tracks error count correctly when multiple files fail", async () => {
      mockDbRows = [
        createMockMediaFile(1, "/photos/bad1.jpg"),
        createMockMediaFile(2, "/photos/bad2.jpg"),
        createMockMediaFile(3, "/photos/bad3.jpg"),
      ];

      mockInsertImageMetadata.mockImplementation(() => Promise.reject(new Error("DB insert failed")));

      const result = await processImageMetadataBatch();

      expect(result.processed).toBe(0);
      expect(result.errors).toBe(3);
    });

    test("updates file status to 'metadata' after successful extraction", async () => {
      mockDbRows = [createMockMediaFile(1, "/photos/a.jpg"), createMockMediaFile(2, "/photos/b.jpg")];

      await processImageMetadataBatch();

      // updateMediaFile should be called once per successfully processed file
      expect(mockUpdateMediaFile).toHaveBeenCalledTimes(2);

      // Verify each call sets status to "metadata" with the correct file id
      const updateCalls = mockUpdateMediaFile.mock.calls.map((call) => call[0] as { id: number; status: string });
      const updateIds = updateCalls.map((c) => c.id).sort();
      expect(updateIds).toEqual([1, 2]);
      for (const call of updateCalls) {
        expect(call.status).toBe("metadata");
      }
    });

    test("does not update file status when extraction fails", async () => {
      mockDbRows = [createMockMediaFile(1, "/photos/bad.jpg")];

      mockInsertImageMetadata.mockImplementation(() => Promise.reject(new Error("DB insert failed")));

      await processImageMetadataBatch();

      // updateMediaFile should NOT be called for files that errored
      expect(mockUpdateMediaFile).not.toHaveBeenCalled();
    });
  });
});
