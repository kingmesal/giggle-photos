import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { ImageMetadata, NewImageMetadata } from "../zod/image-metadata";
import type { MediaFile } from "../zod/media-file";

// Mock modules
const mockInsertImageMetadata = mock(() => Promise.resolve({} as ImageMetadata));
const mockExistsForMediaFile = mock(() => Promise.resolve(false));
const mockGetImageMetadataProvider = mock(() => ({
  insertImageMetadata: mockInsertImageMetadata,
  existsForMediaFile: mockExistsForMediaFile,
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
import { extractImageMetadata } from "./metadata-image";

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
    mockExistsForMediaFile.mockReset();
    mockExistsForMediaFile.mockImplementation(() => Promise.resolve(false));
    mockGetImageMetadataProvider.mockImplementation(() => ({
      insertImageMetadata: mockInsertImageMetadata,
      existsForMediaFile: mockExistsForMediaFile,
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

    test("zero-byte file skips exifr (handle leak) but still records metadata", async () => {
      const { mkdtempSync, rmSync, writeFileSync } = await import("node:fs");
      const { join } = await import("node:path");
      const { tmpdir } = await import("node:os");
      const dir = mkdtempSync(join(tmpdir(), "meta-empty-"));
      const empty = join(dir, "empty.jpg");
      writeFileSync(empty, new Uint8Array());
      try {
        await extractImageMetadata(1, empty);
        expect(mockExifrParse).not.toHaveBeenCalled();
        expect(mockInsertImageMetadata).toHaveBeenCalledTimes(1);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
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

  describe("extractImageMetadata with worker results (prefetched)", () => {
    const decoded = { width: 4032, height: 3024, format: "jpeg", hasAlpha: false };

    test("does not read the file: exifr is never called", async () => {
      await extractImageMetadata(1, "/test/image.jpg", { exif: { Orientation: 6 }, decoded });
      expect(mockExifrParse).not.toHaveBeenCalled();
      const inserted = mockInsertImageMetadata.mock.calls[0][0] as NewImageMetadata;
      expect(inserted.orientation).toBe(6);
    });

    test("decoded dimensions, format and alpha override EXIF guesses", async () => {
      await extractImageMetadata(1, "/test/image.png", {
        exif: { ExifImageWidth: 10, ExifImageHeight: 10 },
        decoded: { width: 640, height: 480, format: "png", hasAlpha: true },
      });
      const inserted = mockInsertImageMetadata.mock.calls[0][0] as NewImageMetadata;
      expect([inserted.width, inserted.height, inserted.format, inserted.hasAlpha]).toEqual([640, 480, "png", true]);
    });

    test("ISO-string dates from the worker become Dates; GPS passes through", async () => {
      await extractImageMetadata(1, "/test/image.jpg", {
        exif: { DateTimeOriginal: "2021-07-04T12:30:00.000Z", latitude: 47.6, longitude: -122.3, GPSAltitude: 40 },
        decoded,
      });
      const inserted = mockInsertImageMetadata.mock.calls[0][0] as NewImageMetadata;
      expect((inserted.dateTaken as Date).toISOString()).toBe("2021-07-04T12:30:00.000Z");
      expect([inserted.gpsLatitude, inserted.gpsLongitude, inserted.gpsAltitude]).toEqual([47.6, -122.3, 40]);
    });

    test("a failed decode (no decoded info, no EXIF) still records a row with fallbacks", async () => {
      await extractImageMetadata(1, "/test/broken.jpg", { exif: null });
      const inserted = mockInsertImageMetadata.mock.calls[0][0] as NewImageMetadata;
      expect([inserted.width, inserted.height, inserted.format]).toEqual([1, 1, "jpeg"]);
    });

    test("keeps an existing row on a resumed run", async () => {
      mockExistsForMediaFile.mockImplementation(() => Promise.resolve(true));
      await extractImageMetadata(1, "/test/image.jpg", { exif: null, decoded });
      expect(mockInsertImageMetadata).not.toHaveBeenCalled();
    });
  });
});
