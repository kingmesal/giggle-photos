import type { Dirent, Stats } from "node:fs";
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

// Mock the fs/promises module
const mockReaddir = mock(() => Promise.resolve([] as Dirent[]));
const mockStat = mock(() =>
  Promise.resolve({
    size: 0,
    isFile: () => true,
    isDirectory: () => false,
    isSymbolicLink: () => false,
  } as unknown as Stats),
);

mock.module("node:fs/promises", () => ({
  readdir: mockReaddir,
  stat: mockStat,
}));

// Mock the logger to suppress output during tests
mock.module("../logging/logger", () => ({
  getLogger: () => ({
    trace: () => {},
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  }),
}));

// Import after mocking
import { quickScan } from "./quick-scan";

/**
 * Helper to create a mock Dirent object
 */
function createMockDirent(name: string, type: "file" | "directory" | "symlink"): Dirent {
  return {
    name,
    isFile: () => type === "file",
    isDirectory: () => type === "directory",
    isSymbolicLink: () => type === "symlink",
    isBlockDevice: () => false,
    isCharacterDevice: () => false,
    isFIFO: () => false,
    isSocket: () => false,
    parentPath: "",
    path: "",
  } as Dirent;
}

/**
 * Helper to create a mock Stats object
 */
function createMockStats(size: number, type: "file" | "directory" = "file"): Stats {
  return {
    size: BigInt(size),
    isFile: () => type === "file",
    isDirectory: () => type === "directory",
    isSymbolicLink: () => false,
    isBlockDevice: () => false,
    isCharacterDevice: () => false,
    isFIFO: () => false,
    isSocket: () => false,
  } as unknown as Stats;
}

describe("quickScan", () => {
  beforeEach(() => {
    mockReaddir.mockReset();
    mockStat.mockReset();
  });

  afterEach(() => {
    mockReaddir.mockReset();
    mockStat.mockReset();
  });

  describe("counting image files", () => {
    test("counts jpg files correctly", async () => {
      mockReaddir.mockResolvedValue([
        createMockDirent("photo1.jpg", "file"),
        createMockDirent("photo2.JPG", "file"),
        createMockDirent("photo3.jpeg", "file"),
      ]);

      mockStat.mockResolvedValue(createMockStats(1000));

      const result = await quickScan("/test/folder");

      expect(result.imageCount).toBe(3);
      expect(result.videoCount).toBe(0);
      expect(result.totalSize).toBe(3000);
    });

    test("counts png files correctly", async () => {
      mockReaddir.mockResolvedValue([createMockDirent("image1.png", "file"), createMockDirent("image2.PNG", "file")]);

      mockStat.mockResolvedValue(createMockStats(2000));

      const result = await quickScan("/test/folder");

      expect(result.imageCount).toBe(2);
      expect(result.videoCount).toBe(0);
      expect(result.totalSize).toBe(4000);
    });

    test("counts various image formats", async () => {
      mockReaddir.mockResolvedValue([
        createMockDirent("photo.gif", "file"),
        createMockDirent("photo.webp", "file"),
        createMockDirent("photo.heic", "file"),
        createMockDirent("photo.heif", "file"),
        createMockDirent("photo.avif", "file"),
        createMockDirent("raw.cr2", "file"),
        createMockDirent("raw.nef", "file"),
        createMockDirent("raw.arw", "file"),
        createMockDirent("raw.dng", "file"),
      ]);

      mockStat.mockResolvedValue(createMockStats(500));

      const result = await quickScan("/test/folder");

      expect(result.imageCount).toBe(9);
      expect(result.videoCount).toBe(0);
    });
  });

  describe("counting video files", () => {
    test("counts mp4 files correctly", async () => {
      mockReaddir.mockResolvedValue([createMockDirent("video1.mp4", "file"), createMockDirent("video2.MP4", "file")]);

      mockStat.mockResolvedValue(createMockStats(10000));

      const result = await quickScan("/test/folder");

      expect(result.imageCount).toBe(0);
      expect(result.videoCount).toBe(2);
      expect(result.totalSize).toBe(20000);
    });

    test("counts various video formats", async () => {
      mockReaddir.mockResolvedValue([
        createMockDirent("video.mov", "file"),
        createMockDirent("video.avi", "file"),
        createMockDirent("video.mkv", "file"),
        createMockDirent("video.webm", "file"),
        createMockDirent("video.m4v", "file"),
        createMockDirent("video.mts", "file"),
        createMockDirent("video.m2ts", "file"),
      ]);

      mockStat.mockResolvedValue(createMockStats(5000));

      const result = await quickScan("/test/folder");

      expect(result.imageCount).toBe(0);
      expect(result.videoCount).toBe(7);
    });
  });

  describe("calculating total size", () => {
    test("calculates total size correctly for mixed files", async () => {
      mockReaddir.mockResolvedValue([createMockDirent("image.jpg", "file"), createMockDirent("video.mp4", "file")]);

      let callCount = 0;
      mockStat.mockImplementation(() => {
        callCount++;
        // First call for image, second for video
        return Promise.resolve(createMockStats(callCount === 1 ? 1000 : 5000));
      });

      const result = await quickScan("/test/folder");

      expect(result.totalSize).toBe(6000);
    });

    test("handles large file sizes", async () => {
      mockReaddir.mockResolvedValue([createMockDirent("large_video.mp4", "file")]);

      // 5GB file
      mockStat.mockResolvedValue(createMockStats(5 * 1024 * 1024 * 1024));

      const result = await quickScan("/test/folder");

      expect(result.totalSize).toBe(5 * 1024 * 1024 * 1024);
    });

    test("handles zero-byte files", async () => {
      mockReaddir.mockResolvedValue([createMockDirent("empty.jpg", "file")]);

      mockStat.mockResolvedValue(createMockStats(0));

      const result = await quickScan("/test/folder");

      expect(result.imageCount).toBe(1);
      expect(result.totalSize).toBe(0);
    });
  });

  describe("scanSubdirectories option", () => {
    test("scans subdirectories when scanSubdirectories is true (default)", async () => {
      // First call returns root directory contents
      // Second call returns subdirectory contents
      mockReaddir
        .mockResolvedValueOnce([createMockDirent("subdir", "directory"), createMockDirent("root.jpg", "file")])
        .mockResolvedValueOnce([createMockDirent("nested.jpg", "file")]);

      mockStat.mockResolvedValue(createMockStats(1000));

      const result = await quickScan("/test/folder");

      expect(result.imageCount).toBe(2);
      expect(mockReaddir).toHaveBeenCalledTimes(2);
    });

    test("does not scan subdirectories when scanSubdirectories is false", async () => {
      mockReaddir.mockResolvedValue([createMockDirent("subdir", "directory"), createMockDirent("root.jpg", "file")]);

      mockStat.mockResolvedValue(createMockStats(1000));

      const result = await quickScan("/test/folder", { scanSubdirectories: false });

      expect(result.imageCount).toBe(1);
      expect(mockReaddir).toHaveBeenCalledTimes(1);
    });

    test("handles deeply nested directories", async () => {
      // root -> level1 -> level2 -> image.jpg
      mockReaddir
        .mockResolvedValueOnce([createMockDirent("level1", "directory")])
        .mockResolvedValueOnce([createMockDirent("level2", "directory")])
        .mockResolvedValueOnce([createMockDirent("deep.jpg", "file")]);

      mockStat.mockResolvedValue(createMockStats(1000));

      const result = await quickScan("/test/folder", { scanSubdirectories: true });

      expect(result.imageCount).toBe(1);
      expect(mockReaddir).toHaveBeenCalledTimes(3);
    });
  });

  describe("followSymlinks option", () => {
    test("skips symlinks when followSymlinks is false (default)", async () => {
      mockReaddir.mockResolvedValue([createMockDirent("real.jpg", "file"), createMockDirent("symlink.jpg", "symlink")]);

      mockStat.mockResolvedValue(createMockStats(1000));

      const result = await quickScan("/test/folder");

      expect(result.imageCount).toBe(1);
    });

    test("follows symlinks to files when followSymlinks is true", async () => {
      mockReaddir.mockResolvedValue([createMockDirent("real.jpg", "file"), createMockDirent("symlink.jpg", "symlink")]);

      // stat is called for both real file and symlink target
      mockStat.mockResolvedValue(createMockStats(1000, "file"));

      const result = await quickScan("/test/folder", { followSymlinks: true });

      expect(result.imageCount).toBe(2);
    });

    test("follows symlinks to directories when followSymlinks is true", async () => {
      mockReaddir
        .mockResolvedValueOnce([createMockDirent("symlink_dir", "symlink")])
        .mockResolvedValueOnce([createMockDirent("nested.jpg", "file")]);

      mockStat
        .mockResolvedValueOnce(createMockStats(0, "directory"))
        .mockResolvedValueOnce(createMockStats(1000, "file"));

      const result = await quickScan("/test/folder", {
        followSymlinks: true,
        scanSubdirectories: true,
      });

      expect(result.imageCount).toBe(1);
    });

    test("handles broken symlinks gracefully", async () => {
      mockReaddir.mockResolvedValue([
        createMockDirent("broken_link.jpg", "symlink"),
        createMockDirent("real.jpg", "file"),
      ]);

      // First stat call (for broken symlink) throws ENOENT
      // Second stat call (for real file) succeeds
      mockStat
        .mockRejectedValueOnce({ code: "ENOENT", message: "No such file" })
        .mockResolvedValueOnce(createMockStats(1000));

      const result = await quickScan("/test/folder", { followSymlinks: true });

      // Should only count the real file, not the broken symlink
      expect(result.imageCount).toBe(1);
    });
  });

  describe("empty folders", () => {
    test("handles empty folder", async () => {
      mockReaddir.mockResolvedValue([]);

      const result = await quickScan("/test/empty");

      expect(result.imageCount).toBe(0);
      expect(result.videoCount).toBe(0);
      expect(result.totalSize).toBe(0);
    });

    test("handles folder with only subdirectories (no files)", async () => {
      mockReaddir
        .mockResolvedValueOnce([createMockDirent("subdir1", "directory"), createMockDirent("subdir2", "directory")])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      const result = await quickScan("/test/folder");

      expect(result.imageCount).toBe(0);
      expect(result.videoCount).toBe(0);
      expect(result.totalSize).toBe(0);
    });
  });

  describe("permission denied errors", () => {
    test("handles permission denied on directory read", async () => {
      const permissionError = new Error("Permission denied") as NodeJS.ErrnoException;
      permissionError.code = "EACCES";

      mockReaddir.mockRejectedValue(permissionError);

      const result = await quickScan("/test/forbidden");

      expect(result.imageCount).toBe(0);
      expect(result.videoCount).toBe(0);
      expect(result.totalSize).toBe(0);
    });

    test("handles permission denied on file stat", async () => {
      mockReaddir.mockResolvedValue([
        createMockDirent("forbidden.jpg", "file"),
        createMockDirent("allowed.jpg", "file"),
      ]);

      const permissionError = new Error("Permission denied") as NodeJS.ErrnoException;
      permissionError.code = "EACCES";

      // First file stat fails, second succeeds
      mockStat.mockRejectedValueOnce(permissionError).mockResolvedValueOnce(createMockStats(1000));

      const result = await quickScan("/test/folder");

      // Should only count the file that was accessible
      expect(result.imageCount).toBe(1);
    });

    test("continues scanning other directories after permission error", async () => {
      const permissionError = new Error("Permission denied") as NodeJS.ErrnoException;
      permissionError.code = "EACCES";

      mockReaddir
        .mockResolvedValueOnce([createMockDirent("forbidden", "directory"), createMockDirent("allowed", "directory")])
        .mockRejectedValueOnce(permissionError) // forbidden directory
        .mockResolvedValueOnce([createMockDirent("image.jpg", "file")]); // allowed directory

      mockStat.mockResolvedValue(createMockStats(1000));

      const result = await quickScan("/test/folder");

      expect(result.imageCount).toBe(1);
    });
  });

  describe("file type breakdown", () => {
    test("correctly separates images and videos in mixed folder", async () => {
      mockReaddir.mockResolvedValue([
        createMockDirent("photo1.jpg", "file"),
        createMockDirent("photo2.png", "file"),
        createMockDirent("video1.mp4", "file"),
        createMockDirent("video2.mov", "file"),
        createMockDirent("document.pdf", "file"),
        createMockDirent("text.txt", "file"),
      ]);

      mockStat.mockResolvedValue(createMockStats(1000));

      const result = await quickScan("/test/folder");

      expect(result.imageCount).toBe(2);
      expect(result.videoCount).toBe(2);
      // Only media files are counted in totalSize
      expect(result.totalSize).toBe(4000);
    });

    test("handles case-insensitive extensions", async () => {
      mockReaddir.mockResolvedValue([
        createMockDirent("UPPER.JPG", "file"),
        createMockDirent("lower.jpg", "file"),
        createMockDirent("Mixed.JpG", "file"),
        createMockDirent("VIDEO.MP4", "file"),
      ]);

      mockStat.mockResolvedValue(createMockStats(1000));

      const result = await quickScan("/test/folder");

      expect(result.imageCount).toBe(3);
      expect(result.videoCount).toBe(1);
    });
  });

  describe("excluding non-media files", () => {
    test("excludes text files", async () => {
      mockReaddir.mockResolvedValue([createMockDirent("readme.txt", "file"), createMockDirent("notes.md", "file")]);

      const result = await quickScan("/test/folder");

      expect(result.imageCount).toBe(0);
      expect(result.videoCount).toBe(0);
      expect(result.totalSize).toBe(0);
    });

    test("excludes document files", async () => {
      mockReaddir.mockResolvedValue([
        createMockDirent("document.pdf", "file"),
        createMockDirent("spreadsheet.xlsx", "file"),
        createMockDirent("presentation.pptx", "file"),
      ]);

      const result = await quickScan("/test/folder");

      expect(result.imageCount).toBe(0);
      expect(result.videoCount).toBe(0);
    });

    test("excludes executable files", async () => {
      mockReaddir.mockResolvedValue([
        createMockDirent("app.exe", "file"),
        createMockDirent("script.sh", "file"),
        createMockDirent("program.app", "file"),
      ]);

      const result = await quickScan("/test/folder");

      expect(result.imageCount).toBe(0);
      expect(result.videoCount).toBe(0);
    });

    test("excludes files without extensions", async () => {
      mockReaddir.mockResolvedValue([
        createMockDirent("Makefile", "file"),
        createMockDirent("LICENSE", "file"),
        createMockDirent("README", "file"),
      ]);

      const result = await quickScan("/test/folder");

      expect(result.imageCount).toBe(0);
      expect(result.videoCount).toBe(0);
    });

    test("excludes hidden files that are not media", async () => {
      mockReaddir.mockResolvedValue([
        createMockDirent(".gitignore", "file"),
        createMockDirent(".DS_Store", "file"),
        createMockDirent(".hidden.jpg", "file"), // This should be counted as image
      ]);

      mockStat.mockResolvedValue(createMockStats(1000));

      const result = await quickScan("/test/folder");

      expect(result.imageCount).toBe(1); // .hidden.jpg
      expect(result.videoCount).toBe(0);
    });
  });

  describe("default options", () => {
    test("uses default options when not specified", async () => {
      mockReaddir
        .mockResolvedValueOnce([
          createMockDirent("subdir", "directory"),
          createMockDirent("symlink.jpg", "symlink"),
          createMockDirent("file.jpg", "file"),
        ])
        .mockResolvedValueOnce([createMockDirent("nested.jpg", "file")]);

      mockStat.mockResolvedValue(createMockStats(1000));

      const result = await quickScan("/test/folder");

      // Default: scanSubdirectories=true, followSymlinks=false
      expect(result.imageCount).toBe(2); // file.jpg + nested.jpg (symlink skipped)
    });
  });

  describe("error handling", () => {
    test("handles ENOENT error when directory does not exist", async () => {
      const notFoundError = new Error("Directory not found") as NodeJS.ErrnoException;
      notFoundError.code = "ENOENT";

      mockReaddir.mockRejectedValue(notFoundError);

      const result = await quickScan("/nonexistent/path");

      expect(result.imageCount).toBe(0);
      expect(result.videoCount).toBe(0);
      expect(result.totalSize).toBe(0);
    });

    test("handles unexpected errors gracefully", async () => {
      const unexpectedError = new Error("Unexpected error");

      mockReaddir.mockRejectedValue(unexpectedError);

      const result = await quickScan("/test/folder");

      expect(result.imageCount).toBe(0);
      expect(result.videoCount).toBe(0);
      expect(result.totalSize).toBe(0);
    });

    test("handles stat errors with no error code", async () => {
      mockReaddir.mockResolvedValue([
        createMockDirent("problematic.jpg", "file"),
        createMockDirent("normal.jpg", "file"),
      ]);

      const genericError = new Error("Unknown error");

      mockStat.mockRejectedValueOnce(genericError).mockResolvedValueOnce(createMockStats(1000));

      const result = await quickScan("/test/folder");

      expect(result.imageCount).toBe(1);
    });
  });

  describe("return type", () => {
    test("returns QuickScanResult with correct shape", async () => {
      mockReaddir.mockResolvedValue([createMockDirent("test.jpg", "file")]);
      mockStat.mockResolvedValue(createMockStats(1000));

      const result = await quickScan("/test/folder");

      expect(typeof result.imageCount).toBe("number");
      expect(typeof result.videoCount).toBe("number");
      expect(typeof result.totalSize).toBe("number");
      expect(Object.keys(result).sort()).toEqual(["imageCount", "totalSize", "videoCount"]);
    });

    test("returns result even when all operations fail", async () => {
      mockReaddir.mockRejectedValue(new Error("Total failure"));

      const result = await quickScan("/test/folder");

      expect(result).toBeDefined();
      expect(result.imageCount).toBe(0);
      expect(result.videoCount).toBe(0);
      expect(result.totalSize).toBe(0);
    });
  });

  describe("concurrent file processing", () => {
    test("processes multiple files concurrently", async () => {
      const fileCount = 100;
      const files = Array.from({ length: fileCount }, (_, i) => createMockDirent(`image${i}.jpg`, "file"));

      mockReaddir.mockResolvedValue(files);
      mockStat.mockResolvedValue(createMockStats(1000));

      const result = await quickScan("/test/folder");

      expect(result.imageCount).toBe(fileCount);
      expect(result.totalSize).toBe(fileCount * 1000);
    });
  });

  describe("special file names", () => {
    test("handles files with spaces in names", async () => {
      mockReaddir.mockResolvedValue([
        createMockDirent("my photo.jpg", "file"),
        createMockDirent("vacation video.mp4", "file"),
      ]);

      mockStat.mockResolvedValue(createMockStats(1000));

      const result = await quickScan("/test/folder");

      expect(result.imageCount).toBe(1);
      expect(result.videoCount).toBe(1);
    });

    test("handles files with special characters in names", async () => {
      mockReaddir.mockResolvedValue([
        createMockDirent("photo (1).jpg", "file"),
        createMockDirent("photo-2022_01_01.jpg", "file"),
        createMockDirent("photo[backup].jpg", "file"),
      ]);

      mockStat.mockResolvedValue(createMockStats(1000));

      const result = await quickScan("/test/folder");

      expect(result.imageCount).toBe(3);
    });

    test("handles files with multiple dots in names", async () => {
      mockReaddir.mockResolvedValue([
        createMockDirent("photo.backup.2022.jpg", "file"),
        createMockDirent("video.final.cut.mp4", "file"),
      ]);

      mockStat.mockResolvedValue(createMockStats(1000));

      const result = await quickScan("/test/folder");

      expect(result.imageCount).toBe(1);
      expect(result.videoCount).toBe(1);
    });
  });
});
