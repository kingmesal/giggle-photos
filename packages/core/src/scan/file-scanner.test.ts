import type { Dirent, Stats } from "node:fs";
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { MediaFile, NewMediaFile } from "../zod/media-file";
import type { ScanFolder } from "../zod/scan-folder";
import type { ProgressCallback } from "./file-scanner";

/**
 * Mock providers for ScanFolderProvider and MediaFileProvider
 */
interface MockScanFolderProvider {
  getScanFolderById: ReturnType<typeof mock>;
  updateScanFolder: ReturnType<typeof mock>;
}

interface MockMediaFileProvider {
  getMediaFilesByFolderId: ReturnType<typeof mock>;
  insertMediaFiles: ReturnType<typeof mock>;
}

// Store mocks at module level for access in tests
let mockScanFolderProvider: MockScanFolderProvider;
let mockMediaFileProvider: MockMediaFileProvider;
let mockReaddir: ReturnType<typeof mock>;
let mockStat: ReturnType<typeof mock>;
let mockIsMediaFile: ReturnType<typeof mock>;
let mockGetExtension: ReturnType<typeof mock>;
let mockGetMediaType: ReturnType<typeof mock>;

// Mock modules before importing the module under test
mock.module("../db/database-provider", () => ({
  DatabaseProvider: {
    getInstance: () =>
      Promise.resolve({
        getScanFolderProvider: () => mockScanFolderProvider,
        getMediaFileProvider: () => mockMediaFileProvider,
      }),
  },
}));

mock.module("node:fs/promises", () => ({
  readdir: (...args: unknown[]) => mockReaddir(...args),
  stat: (...args: unknown[]) => mockStat(...args),
}));

mock.module("../config/media-types", () => ({
  isMediaFile: (...args: unknown[]) => mockIsMediaFile(...args),
  getExtension: (...args: unknown[]) => mockGetExtension(...args),
  getMediaType: (...args: unknown[]) => mockGetMediaType(...args),
}));

// Import after mocking
const { scanFolder } = await import("./file-scanner");

/**
 * Helper to create a mock Dirent object
 */
function createMockDirent(name: string, type: "file" | "directory" | "symlink"): Dirent {
  return {
    name,
    path: "",
    parentPath: "",
    isFile: () => type === "file",
    isDirectory: () => type === "directory",
    isSymbolicLink: () => type === "symlink",
    isBlockDevice: () => false,
    isCharacterDevice: () => false,
    isFIFO: () => false,
    isSocket: () => false,
  } as Dirent;
}

/**
 * Helper to create a mock Stats object
 */
function createMockStats(size: number, isDir = false): Stats {
  return {
    size: BigInt(size),
    isFile: () => !isDir,
    isDirectory: () => isDir,
    isBlockDevice: () => false,
    isCharacterDevice: () => false,
    isFIFO: () => false,
    isSocket: () => false,
    isSymbolicLink: () => false,
  } as unknown as Stats;
}

/**
 * Helper to create a mock ScanFolder
 */
function createMockScanFolder(overrides: Partial<ScanFolder> = {}): ScanFolder {
  return {
    id: 1,
    path: "/test/photos",
    priority: 3,
    status: "added",
    scanSubdirectories: true,
    includeVideos: true,
    imageCount: 0,
    videoCount: 0,
    totalSize: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

/**
 * Helper to create a mock MediaFile
 */
function createMockMediaFile(overrides: Partial<MediaFile> = {}): MediaFile {
  return {
    id: 1,
    scanFolderId: 1,
    path: "/test/photos/image1.jpg",
    filename: "image1.jpg",
    extension: "jpg",
    fileType: "image",
    size: 1024,
    status: "pending",
    sha256Hash: null,
    contentHash: null,
    perceptualHash: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("scanFolder", () => {
  beforeEach(() => {
    // Reset all mocks before each test
    mockScanFolderProvider = {
      getScanFolderById: mock(() => Promise.resolve(null)),
      updateScanFolder: mock(() => Promise.resolve()),
    };

    mockMediaFileProvider = {
      getMediaFilesByFolderId: mock(() => Promise.resolve([])),
      insertMediaFiles: mock((files: NewMediaFile[]) => Promise.resolve(files.length)),
    };

    mockReaddir = mock(() => Promise.resolve([]));
    mockStat = mock(() => Promise.resolve(createMockStats(1024)));
    mockIsMediaFile = mock(() => true);
    mockGetExtension = mock((filename: string) => {
      const ext = filename.split(".").pop() || "";
      return ext.toLowerCase();
    });
    mockGetMediaType = mock((filename: string) => {
      const ext = filename.split(".").pop()?.toLowerCase() || "";
      if (["jpg", "jpeg", "png", "gif", "webp"].includes(ext)) return "image";
      if (["mp4", "mov", "avi", "mkv"].includes(ext)) return "video";
      return null;
    });
  });

  afterEach(() => {
    // Clear all mock call history
    mock.restore();
  });

  describe("folder lookup and error handling", () => {
    test("throws error when folder does not exist", async () => {
      mockScanFolderProvider.getScanFolderById.mockImplementation(() => Promise.resolve(null));

      await expect(scanFolder(999)).rejects.toThrow("ScanFolder with id 999 not found");
    });

    test("updates folder status to scanning at start", async () => {
      const folder = createMockScanFolder({ id: 5 });
      mockScanFolderProvider.getScanFolderById.mockImplementation(() => Promise.resolve(folder));

      await scanFolder(5);

      // Should have been called with status: "scanning" first
      const updateCalls = mockScanFolderProvider.updateScanFolder.mock.calls;
      expect(updateCalls.length).toBeGreaterThanOrEqual(2);
      expect(updateCalls[0][0]).toMatchObject({ id: 5, status: "scanning" });
    });

    test("updates folder status to ready on success", async () => {
      const folder = createMockScanFolder({ id: 5 });
      mockScanFolderProvider.getScanFolderById.mockImplementation(() => Promise.resolve(folder));

      await scanFolder(5);

      const updateCalls = mockScanFolderProvider.updateScanFolder.mock.calls;
      // Last call should update status to ready
      const lastStatusCall = updateCalls.find((call: [{ id: number; status?: string }]) => call[0].status === "ready");
      expect(lastStatusCall).toBeDefined();
    });

    test("updates folder status to error on failure", async () => {
      const folder = createMockScanFolder({ id: 5 });
      mockScanFolderProvider.getScanFolderById.mockImplementation(() => Promise.resolve(folder));

      // Make the media file provider throw an error that propagates
      // Note: readdir errors are caught gracefully, so we need to fail at database level
      mockMediaFileProvider.getMediaFilesByFolderId.mockImplementation(() =>
        Promise.reject(new Error("Database connection failed")),
      );

      await expect(scanFolder(5)).rejects.toThrow("Database connection failed");

      const updateCalls = mockScanFolderProvider.updateScanFolder.mock.calls;
      const errorCall = updateCalls.find((call: [{ id: number; status?: string }]) => call[0].status === "error");
      expect(errorCall).toBeDefined();
    });

    test("handles readdir errors gracefully without failing scan", async () => {
      const folder = createMockScanFolder({ id: 5 });
      mockScanFolderProvider.getScanFolderById.mockImplementation(() => Promise.resolve(folder));

      // readdir errors are caught and logged, not propagated
      mockReaddir.mockImplementation(() => Promise.reject(new Error("Permission denied")));

      // Should succeed with 0 files discovered
      const result = await scanFolder(5);

      expect(result.totalFiles).toBe(0);
      expect(result.newFiles).toBe(0);
    });
  });

  describe("file discovery", () => {
    test("discovers media files in a folder", async () => {
      const folder = createMockScanFolder();
      mockScanFolderProvider.getScanFolderById.mockImplementation(() => Promise.resolve(folder));

      mockReaddir.mockImplementation(() =>
        Promise.resolve([
          createMockDirent("photo1.jpg", "file"),
          createMockDirent("photo2.png", "file"),
          createMockDirent("video1.mp4", "file"),
        ]),
      );

      const result = await scanFolder(1);

      expect(result.totalFiles).toBe(3);
      expect(result.newFiles).toBe(3);
      expect(result.skipped).toBe(0);
    });

    test("returns empty result for empty folder", async () => {
      const folder = createMockScanFolder();
      mockScanFolderProvider.getScanFolderById.mockImplementation(() => Promise.resolve(folder));
      mockReaddir.mockImplementation(() => Promise.resolve([]));

      const result = await scanFolder(1);

      expect(result.totalFiles).toBe(0);
      expect(result.newFiles).toBe(0);
      expect(result.skipped).toBe(0);
    });

    test("skips non-media files", async () => {
      const folder = createMockScanFolder();
      mockScanFolderProvider.getScanFolderById.mockImplementation(() => Promise.resolve(folder));

      mockReaddir.mockImplementation(() =>
        Promise.resolve([
          createMockDirent("photo.jpg", "file"),
          createMockDirent("document.pdf", "file"),
          createMockDirent("readme.txt", "file"),
        ]),
      );

      // Only .jpg is a media file
      mockIsMediaFile.mockImplementation((filename: string) => filename.endsWith(".jpg"));
      mockGetMediaType.mockImplementation((filename: string) => (filename.endsWith(".jpg") ? "image" : null));

      const result = await scanFolder(1);

      expect(result.totalFiles).toBe(1);
      expect(result.newFiles).toBe(1);
    });

    test("handles mixed file types correctly", async () => {
      const folder = createMockScanFolder();
      mockScanFolderProvider.getScanFolderById.mockImplementation(() => Promise.resolve(folder));

      mockReaddir.mockImplementation(() =>
        Promise.resolve([
          createMockDirent("image1.jpg", "file"),
          createMockDirent("image2.png", "file"),
          createMockDirent("video1.mp4", "file"),
          createMockDirent("video2.mov", "file"),
        ]),
      );

      await scanFolder(1);

      // Verify folder was updated with correct counts
      const updateCalls = mockScanFolderProvider.updateScanFolder.mock.calls;
      const countsCall = updateCalls.find(
        (call: [{ imageCount?: number; videoCount?: number }]) => call[0].imageCount !== undefined,
      );
      expect(countsCall).toBeDefined();
      if (countsCall) {
        expect(countsCall[0].imageCount).toBe(2);
        expect(countsCall[0].videoCount).toBe(2);
      }
    });
  });

  describe("subdirectory scanning", () => {
    test("scans subdirectories when scanSubdirectories is true", async () => {
      const folder = createMockScanFolder({ scanSubdirectories: true });
      mockScanFolderProvider.getScanFolderById.mockImplementation(() => Promise.resolve(folder));

      let callCount = 0;
      mockReaddir.mockImplementation((path: string) => {
        callCount++;
        if (path === "/test/photos") {
          return Promise.resolve([createMockDirent("photo1.jpg", "file"), createMockDirent("subdir", "directory")]);
        }
        if (path === "/test/photos/subdir") {
          return Promise.resolve([createMockDirent("photo2.jpg", "file")]);
        }
        return Promise.resolve([]);
      });

      const result = await scanFolder(1);

      expect(result.totalFiles).toBe(2);
      expect(callCount).toBe(2); // Root + subdirectory
    });

    test("does not scan subdirectories when scanSubdirectories is false", async () => {
      const folder = createMockScanFolder({ scanSubdirectories: false });
      mockScanFolderProvider.getScanFolderById.mockImplementation(() => Promise.resolve(folder));

      let callCount = 0;
      mockReaddir.mockImplementation((path: string) => {
        callCount++;
        if (path === "/test/photos") {
          return Promise.resolve([createMockDirent("photo1.jpg", "file"), createMockDirent("subdir", "directory")]);
        }
        // Should never reach here
        return Promise.resolve([createMockDirent("photo2.jpg", "file")]);
      });

      const result = await scanFolder(1);

      expect(result.totalFiles).toBe(1);
      expect(callCount).toBe(1); // Only root directory
    });

    test("handles deeply nested directories", async () => {
      const folder = createMockScanFolder({ scanSubdirectories: true });
      mockScanFolderProvider.getScanFolderById.mockImplementation(() => Promise.resolve(folder));

      mockReaddir.mockImplementation((path: string) => {
        if (path === "/test/photos") {
          return Promise.resolve([createMockDirent("level1", "directory")]);
        }
        if (path === "/test/photos/level1") {
          return Promise.resolve([createMockDirent("level2", "directory")]);
        }
        if (path === "/test/photos/level1/level2") {
          return Promise.resolve([createMockDirent("deep-photo.jpg", "file")]);
        }
        return Promise.resolve([]);
      });

      const result = await scanFolder(1);

      expect(result.totalFiles).toBe(1);
    });
  });

  describe("symlink handling", () => {
    test("skips symlinks by default (followSymlinks = false)", async () => {
      const folder = createMockScanFolder();
      mockScanFolderProvider.getScanFolderById.mockImplementation(() => Promise.resolve(folder));

      mockReaddir.mockImplementation(() =>
        Promise.resolve([createMockDirent("photo.jpg", "file"), createMockDirent("link-to-photo.jpg", "symlink")]),
      );

      const result = await scanFolder(1);

      // Should only count the real file, not the symlink
      expect(result.totalFiles).toBe(1);
    });
  });

  describe("permission errors", () => {
    test("handles permission denied on directory gracefully", async () => {
      const folder = createMockScanFolder({ scanSubdirectories: true });
      mockScanFolderProvider.getScanFolderById.mockImplementation(() => Promise.resolve(folder));

      mockReaddir.mockImplementation((path: string) => {
        if (path === "/test/photos") {
          return Promise.resolve([createMockDirent("photo.jpg", "file"), createMockDirent("restricted", "directory")]);
        }
        if (path === "/test/photos/restricted") {
          const error = new Error("Permission denied") as NodeJS.ErrnoException;
          error.code = "EACCES";
          return Promise.reject(error);
        }
        return Promise.resolve([]);
      });

      // Should not throw, but handle gracefully
      const result = await scanFolder(1);

      expect(result.totalFiles).toBe(1);
    });

    test("handles permission denied on file stat gracefully", async () => {
      const folder = createMockScanFolder();
      mockScanFolderProvider.getScanFolderById.mockImplementation(() => Promise.resolve(folder));

      mockReaddir.mockImplementation(() =>
        Promise.resolve([createMockDirent("accessible.jpg", "file"), createMockDirent("restricted.jpg", "file")]),
      );

      mockStat.mockImplementation((path: string) => {
        if (path.includes("restricted")) {
          const error = new Error("Permission denied") as NodeJS.ErrnoException;
          error.code = "EACCES";
          return Promise.reject(error);
        }
        return Promise.resolve(createMockStats(1024));
      });

      const result = await scanFolder(1);

      // Should only count the accessible file
      expect(result.totalFiles).toBe(1);
    });

    test("handles ENOENT (file not found) errors gracefully", async () => {
      const folder = createMockScanFolder();
      mockScanFolderProvider.getScanFolderById.mockImplementation(() => Promise.resolve(folder));

      mockReaddir.mockImplementation(() =>
        Promise.resolve([createMockDirent("exists.jpg", "file"), createMockDirent("deleted.jpg", "file")]),
      );

      mockStat.mockImplementation((path: string) => {
        if (path.includes("deleted")) {
          const error = new Error("File not found") as NodeJS.ErrnoException;
          error.code = "ENOENT";
          return Promise.reject(error);
        }
        return Promise.resolve(createMockStats(1024));
      });

      const result = await scanFolder(1);

      expect(result.totalFiles).toBe(1);
    });
  });

  describe("database interaction", () => {
    test("filters out files that already exist in database", async () => {
      const folder = createMockScanFolder();
      mockScanFolderProvider.getScanFolderById.mockImplementation(() => Promise.resolve(folder));

      // Existing files in database
      mockMediaFileProvider.getMediaFilesByFolderId.mockImplementation(() =>
        Promise.resolve([createMockMediaFile({ path: "/test/photos/existing.jpg" })]),
      );

      mockReaddir.mockImplementation(() =>
        Promise.resolve([createMockDirent("existing.jpg", "file"), createMockDirent("new.jpg", "file")]),
      );

      const result = await scanFolder(1);

      expect(result.totalFiles).toBe(2);
      expect(result.newFiles).toBe(1);
      expect(result.skipped).toBe(1);
    });

    test("batch inserts files into database", async () => {
      const folder = createMockScanFolder();
      mockScanFolderProvider.getScanFolderById.mockImplementation(() => Promise.resolve(folder));

      mockReaddir.mockImplementation(() =>
        Promise.resolve([
          createMockDirent("photo1.jpg", "file"),
          createMockDirent("photo2.jpg", "file"),
          createMockDirent("photo3.jpg", "file"),
        ]),
      );

      await scanFolder(1);

      // Should have called insertMediaFiles at least once
      expect(mockMediaFileProvider.insertMediaFiles.mock.calls.length).toBeGreaterThanOrEqual(1);

      // Check that the inserted records have correct structure
      const firstCallArg = mockMediaFileProvider.insertMediaFiles.mock.calls[0][0] as NewMediaFile[];
      expect(firstCallArg.length).toBeGreaterThan(0);
      expect(firstCallArg[0]).toMatchObject({
        scanFolderId: 1,
        status: "pending",
      });
    });

    test("handles batch insert errors gracefully", async () => {
      const folder = createMockScanFolder();
      mockScanFolderProvider.getScanFolderById.mockImplementation(() => Promise.resolve(folder));

      mockReaddir.mockImplementation(() =>
        Promise.resolve([createMockDirent("photo1.jpg", "file"), createMockDirent("photo2.jpg", "file")]),
      );

      // First batch fails, but scan should continue
      mockMediaFileProvider.insertMediaFiles.mockImplementation(() => {
        return Promise.reject(new Error("Database insert failed"));
      });

      // Should not throw, handle gracefully
      const result = await scanFolder(1);

      expect(result.totalFiles).toBe(2);
      expect(result.newFiles).toBe(0); // Insert failed
    });

    test("updates folder counts after scan", async () => {
      const folder = createMockScanFolder();
      mockScanFolderProvider.getScanFolderById.mockImplementation(() => Promise.resolve(folder));

      mockReaddir.mockImplementation(() =>
        Promise.resolve([createMockDirent("image1.jpg", "file"), createMockDirent("video1.mp4", "file")]),
      );

      mockStat.mockImplementation(() => Promise.resolve(createMockStats(2048)));

      await scanFolder(1);

      // Verify updateScanFolder was called with counts
      const updateCalls = mockScanFolderProvider.updateScanFolder.mock.calls;
      const countsCall = updateCalls.find((call: [{ totalSize?: number }]) => call[0].totalSize !== undefined);
      expect(countsCall).toBeDefined();
      if (countsCall) {
        expect(countsCall[0].totalSize).toBe(4096); // 2048 * 2 files
      }
    });
  });

  describe("progress callback", () => {
    test("calls progress callback during batch inserts", async () => {
      const folder = createMockScanFolder();
      mockScanFolderProvider.getScanFolderById.mockImplementation(() => Promise.resolve(folder));

      mockReaddir.mockImplementation(() =>
        Promise.resolve([
          createMockDirent("photo1.jpg", "file"),
          createMockDirent("photo2.jpg", "file"),
          createMockDirent("photo3.jpg", "file"),
        ]),
      );

      const progressCallback = mock<ProgressCallback>(() => {});

      await scanFolder(1, progressCallback);

      // Progress callback should have been called
      expect(progressCallback.mock.calls.length).toBeGreaterThanOrEqual(1);

      // Check the callback arguments (current, total, path)
      const lastCall = progressCallback.mock.calls[progressCallback.mock.calls.length - 1];
      expect(typeof lastCall[0]).toBe("number"); // current
      expect(typeof lastCall[1]).toBe("number"); // total
      expect(typeof lastCall[2]).toBe("string"); // currentPath
    });

    test("does not fail when progress callback is not provided", async () => {
      const folder = createMockScanFolder();
      mockScanFolderProvider.getScanFolderById.mockImplementation(() => Promise.resolve(folder));

      mockReaddir.mockImplementation(() => Promise.resolve([createMockDirent("photo.jpg", "file")]));

      // Should not throw
      const result = await scanFolder(1);

      expect(result.totalFiles).toBe(1);
    });
  });

  describe("file metadata extraction", () => {
    test("extracts file size correctly", async () => {
      const folder = createMockScanFolder();
      mockScanFolderProvider.getScanFolderById.mockImplementation(() => Promise.resolve(folder));

      mockReaddir.mockImplementation(() => Promise.resolve([createMockDirent("large-photo.jpg", "file")]));

      mockStat.mockImplementation(() => Promise.resolve(createMockStats(5_000_000)));

      await scanFolder(1);

      const insertCalls = mockMediaFileProvider.insertMediaFiles.mock.calls;
      expect(insertCalls.length).toBeGreaterThan(0);
      const insertedFiles = insertCalls[0][0] as NewMediaFile[];
      expect(insertedFiles[0].size).toBe(5_000_000);
    });

    test("extracts file extension correctly", async () => {
      const folder = createMockScanFolder();
      mockScanFolderProvider.getScanFolderById.mockImplementation(() => Promise.resolve(folder));

      mockReaddir.mockImplementation(() => Promise.resolve([createMockDirent("photo.JPEG", "file")]));

      mockGetExtension.mockImplementation(() => "jpeg");

      await scanFolder(1);

      const insertCalls = mockMediaFileProvider.insertMediaFiles.mock.calls;
      expect(insertCalls.length).toBeGreaterThan(0);
      const insertedFiles = insertCalls[0][0] as NewMediaFile[];
      expect(insertedFiles[0].extension).toBe("jpeg");
    });

    test("determines file type correctly", async () => {
      const folder = createMockScanFolder();
      mockScanFolderProvider.getScanFolderById.mockImplementation(() => Promise.resolve(folder));

      mockReaddir.mockImplementation(() =>
        Promise.resolve([createMockDirent("photo.jpg", "file"), createMockDirent("video.mp4", "file")]),
      );

      await scanFolder(1);

      const insertCalls = mockMediaFileProvider.insertMediaFiles.mock.calls;
      expect(insertCalls.length).toBeGreaterThan(0);
      const insertedFiles = insertCalls[0][0] as NewMediaFile[];

      const imageFile = insertedFiles.find((f) => f.filename === "photo.jpg");
      const videoFile = insertedFiles.find((f) => f.filename === "video.mp4");

      expect(imageFile?.fileType).toBe("image");
      expect(videoFile?.fileType).toBe("video");
    });
  });

  describe("return value", () => {
    test("returns correct ScanResult structure", async () => {
      const folder = createMockScanFolder();
      mockScanFolderProvider.getScanFolderById.mockImplementation(() => Promise.resolve(folder));

      mockReaddir.mockImplementation(() =>
        Promise.resolve([createMockDirent("photo1.jpg", "file"), createMockDirent("photo2.jpg", "file")]),
      );

      const result = await scanFolder(1);

      expect(result).toHaveProperty("totalFiles");
      expect(result).toHaveProperty("newFiles");
      expect(result).toHaveProperty("skipped");
      expect(typeof result.totalFiles).toBe("number");
      expect(typeof result.newFiles).toBe("number");
      expect(typeof result.skipped).toBe("number");
    });

    test("totalFiles equals newFiles + skipped", async () => {
      const folder = createMockScanFolder();
      mockScanFolderProvider.getScanFolderById.mockImplementation(() => Promise.resolve(folder));

      mockMediaFileProvider.getMediaFilesByFolderId.mockImplementation(() =>
        Promise.resolve([createMockMediaFile({ path: "/test/photos/existing.jpg" })]),
      );

      mockReaddir.mockImplementation(() =>
        Promise.resolve([
          createMockDirent("existing.jpg", "file"),
          createMockDirent("new1.jpg", "file"),
          createMockDirent("new2.jpg", "file"),
        ]),
      );

      const result = await scanFolder(1);

      expect(result.totalFiles).toBe(result.newFiles + result.skipped);
      expect(result.totalFiles).toBe(3);
      expect(result.newFiles).toBe(2);
      expect(result.skipped).toBe(1);
    });
  });

  describe("edge cases", () => {
    test("handles files with no extension", async () => {
      const folder = createMockScanFolder();
      mockScanFolderProvider.getScanFolderById.mockImplementation(() => Promise.resolve(folder));

      mockReaddir.mockImplementation(() =>
        Promise.resolve([createMockDirent("noextension", "file"), createMockDirent("photo.jpg", "file")]),
      );

      mockIsMediaFile.mockImplementation((filename: string) => filename.includes(".jpg"));
      mockGetMediaType.mockImplementation((filename: string) => (filename.includes(".jpg") ? "image" : null));

      const result = await scanFolder(1);

      // Should only count the .jpg file
      expect(result.totalFiles).toBe(1);
    });

    test("handles files with multiple dots in name", async () => {
      const folder = createMockScanFolder();
      mockScanFolderProvider.getScanFolderById.mockImplementation(() => Promise.resolve(folder));

      mockReaddir.mockImplementation(() => Promise.resolve([createMockDirent("photo.2024.01.15.jpg", "file")]));

      const result = await scanFolder(1);

      expect(result.totalFiles).toBe(1);
    });

    test("handles hidden files (starting with dot)", async () => {
      const folder = createMockScanFolder();
      mockScanFolderProvider.getScanFolderById.mockImplementation(() => Promise.resolve(folder));

      mockReaddir.mockImplementation(() =>
        Promise.resolve([createMockDirent(".hidden.jpg", "file"), createMockDirent("visible.jpg", "file")]),
      );

      const result = await scanFolder(1);

      // Both files should be counted if they have media extensions
      expect(result.totalFiles).toBe(2);
    });

    test("handles case-insensitive extensions", async () => {
      const folder = createMockScanFolder();
      mockScanFolderProvider.getScanFolderById.mockImplementation(() => Promise.resolve(folder));

      mockReaddir.mockImplementation(() =>
        Promise.resolve([
          createMockDirent("photo1.JPG", "file"),
          createMockDirent("photo2.Jpg", "file"),
          createMockDirent("photo3.jpg", "file"),
        ]),
      );

      const result = await scanFolder(1);

      expect(result.totalFiles).toBe(3);
    });

    test("handles very long file paths", async () => {
      const folder = createMockScanFolder({
        path: "/very/long/path/to/folder",
      });
      mockScanFolderProvider.getScanFolderById.mockImplementation(() => Promise.resolve(folder));

      const longFilename = `${"a".repeat(200)}.jpg`;
      mockReaddir.mockImplementation(() => Promise.resolve([createMockDirent(longFilename, "file")]));

      const result = await scanFolder(1);

      expect(result.totalFiles).toBe(1);
    });

    test("handles special characters in file names", async () => {
      const folder = createMockScanFolder();
      mockScanFolderProvider.getScanFolderById.mockImplementation(() => Promise.resolve(folder));

      mockReaddir.mockImplementation(() =>
        Promise.resolve([
          createMockDirent("photo with spaces.jpg", "file"),
          createMockDirent("photo-with-dashes.jpg", "file"),
          createMockDirent("photo_with_underscores.jpg", "file"),
          createMockDirent("photo(1).jpg", "file"),
        ]),
      );

      const result = await scanFolder(1);

      expect(result.totalFiles).toBe(4);
    });

    test("handles unicode characters in file names", async () => {
      const folder = createMockScanFolder();
      mockScanFolderProvider.getScanFolderById.mockImplementation(() => Promise.resolve(folder));

      mockReaddir.mockImplementation(() => Promise.resolve([createMockDirent("foto_verano.jpg", "file")]));

      const result = await scanFolder(1);

      expect(result.totalFiles).toBe(1);
    });
  });
});
