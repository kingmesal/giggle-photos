import { describe, expect, test } from "bun:test";
import { FileStatus, FileType, MediaFile, MediaFileRecord, NewMediaFile, UpdateMediaFile } from "./media-file";

const validDate = new Date("2024-01-15T12:00:00.000Z");
const validDate2 = new Date("2024-01-16T12:00:00.000Z");

function validMediaFileInput(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    scanFolderId: 10,
    path: "/some/folder/image.jpg",
    filename: "image.jpg",
    extension: "jpg",
    fileType: "image" as const,
    size: 1024,
    status: "pending" as const,
    sha256Hash: null,
    contentHash: null,
    perceptualHash: null,
    createdAt: validDate,
    updatedAt: validDate2,
    ...overrides,
  };
}

describe("media-file", () => {
  describe("FileType", () => {
    test("accepts 'image' literal", () => {
      expect(FileType.parse("image")).toBe("image");
    });

    test("accepts 'video' literal", () => {
      expect(FileType.parse("video")).toBe("video");
    });

    test("rejects invalid file type", () => {
      expect(FileType.safeParse("audio").success).toBe(false);
      expect(FileType.safeParse("document").success).toBe(false);
      expect(FileType.safeParse("").success).toBe(false);
      expect(FileType.safeParse(1).success).toBe(false);
      expect(FileType.safeParse(null).success).toBe(false);
    });
  });

  describe("FileStatus", () => {
    test("accepts 'pending' literal", () => {
      expect(FileStatus.parse("pending")).toBe("pending");
    });

    test("accepts 'metadata' literal", () => {
      expect(FileStatus.parse("metadata")).toBe("metadata");
    });

    test("accepts 'hashed' literal", () => {
      expect(FileStatus.parse("hashed")).toBe("hashed");
    });

    test("accepts 'processed' literal", () => {
      expect(FileStatus.parse("processed")).toBe("processed");
    });

    test("accepts 'error' literal", () => {
      expect(FileStatus.parse("error")).toBe("error");
    });

    test("defaults to 'pending' when used as default in object", () => {
      const obj = MediaFile.parse(validMediaFileInput({ status: undefined }));
      expect(obj.status).toBe("pending");
    });

    test("rejects invalid status", () => {
      expect(FileStatus.safeParse("processing").success).toBe(false);
      expect(FileStatus.safeParse("complete").success).toBe(false);
      expect(FileStatus.safeParse("").success).toBe(false);
      expect(FileStatus.safeParse(1).success).toBe(false);
      expect(FileStatus.safeParse(null).success).toBe(false);
    });
  });

  describe("MediaFile", () => {
    test("parses valid full input", () => {
      const input = validMediaFileInput();
      const result = MediaFile.parse(input);
      expect(result.id).toBe(1);
      expect(result.scanFolderId).toBe(10);
      expect(result.path).toBe("/some/folder/image.jpg");
      expect(result.filename).toBe("image.jpg");
      expect(result.extension).toBe("jpg");
      expect(result.fileType).toBe("image");
      expect(result.size).toBe(1024);
      expect(result.status).toBe("pending");
      expect(result.sha256Hash).toBeNull();
      expect(result.contentHash).toBeNull();
      expect(result.perceptualHash).toBeNull();
      expect(result.createdAt).toEqual(validDate);
      expect(result.updatedAt).toEqual(validDate2);
    });

    test("applies defaults for optional fields", () => {
      const input = {
        id: 1,
        scanFolderId: 5,
        path: "/path/to/file.png",
        filename: "file.png",
        extension: "png",
        fileType: "image",
        size: 2048,
        createdAt: validDate,
        updatedAt: validDate2,
      };
      const result = MediaFile.parse(input);
      expect(result.status).toBe("pending");
      expect(result.sha256Hash).toBeNull();
      expect(result.contentHash).toBeNull();
      expect(result.perceptualHash).toBeNull();
    });

    test("accepts video file type", () => {
      const result = MediaFile.parse(
        validMediaFileInput({ fileType: "video", extension: "mp4", filename: "video.mp4", path: "/path/video.mp4" }),
      );
      expect(result.fileType).toBe("video");
    });

    test("accepts all valid status values", () => {
      const statuses = ["pending", "metadata", "hashed", "processed", "error"] as const;
      for (const status of statuses) {
        const result = MediaFile.parse(validMediaFileInput({ status }));
        expect(result.status).toBe(status);
      }
    });

    test("accepts non-null hash values", () => {
      const result = MediaFile.parse(
        validMediaFileInput({
          sha256Hash: "abc123def456",
          contentHash: "xyz789",
          perceptualHash: "pHash001",
        }),
      );
      expect(result.sha256Hash).toBe("abc123def456");
      expect(result.contentHash).toBe("xyz789");
      expect(result.perceptualHash).toBe("pHash001");
    });

    test("rejects id zero or negative", () => {
      expect(MediaFile.safeParse(validMediaFileInput({ id: 0 })).success).toBe(false);
      expect(MediaFile.safeParse(validMediaFileInput({ id: -1 })).success).toBe(false);
    });

    test("rejects non-integer id", () => {
      expect(MediaFile.safeParse(validMediaFileInput({ id: 1.5 })).success).toBe(false);
    });

    test("rejects scanFolderId zero or negative", () => {
      expect(MediaFile.safeParse(validMediaFileInput({ scanFolderId: 0 })).success).toBe(false);
      expect(MediaFile.safeParse(validMediaFileInput({ scanFolderId: -1 })).success).toBe(false);
    });

    test("rejects non-integer scanFolderId", () => {
      expect(MediaFile.safeParse(validMediaFileInput({ scanFolderId: 2.5 })).success).toBe(false);
    });

    test("rejects empty path", () => {
      expect(MediaFile.safeParse(validMediaFileInput({ path: "" })).success).toBe(false);
    });

    test("rejects empty filename", () => {
      expect(MediaFile.safeParse(validMediaFileInput({ filename: "" })).success).toBe(false);
    });

    test("rejects empty extension", () => {
      expect(MediaFile.safeParse(validMediaFileInput({ extension: "" })).success).toBe(false);
    });

    test("rejects negative size", () => {
      expect(MediaFile.safeParse(validMediaFileInput({ size: -1 })).success).toBe(false);
    });

    test("accepts size of zero", () => {
      const result = MediaFile.parse(validMediaFileInput({ size: 0 }));
      expect(result.size).toBe(0);
    });

    test("rejects non-integer size", () => {
      expect(MediaFile.safeParse(validMediaFileInput({ size: 1024.5 })).success).toBe(false);
    });

    test("accepts date-like inputs for createdAt/updatedAt", () => {
      const input = validMediaFileInput({
        createdAt: validDate.getTime(),
        updatedAt: validDate2.getTime(),
      });
      const result = MediaFile.parse(input);
      expect(result.createdAt).toBeInstanceOf(Date);
      expect(result.updatedAt).toBeInstanceOf(Date);
    });

    test("rejects invalid fileType", () => {
      expect(MediaFile.safeParse(validMediaFileInput({ fileType: "audio" })).success).toBe(false);
    });

    test("rejects invalid status", () => {
      expect(MediaFile.safeParse(validMediaFileInput({ status: "processing" })).success).toBe(false);
    });
  });

  describe("MediaFileRecord", () => {
    test("parses input with SQL types for dates", () => {
      const input = {
        scanFolderId: 10,
        path: "/some/folder/image.jpg",
        filename: "image.jpg",
        extension: "jpg",
        fileType: "image",
        size: 1024,
        status: "hashed",
        sha256Hash: "hash123",
        contentHash: "content456",
        perceptualHash: "phash789",
        createdAt: validDate.getTime(),
        updatedAt: validDate2.getTime(),
      };
      const result = MediaFileRecord.parse(input);
      expect(result.scanFolderId).toBe(10);
      expect(result.path).toBe("/some/folder/image.jpg");
      expect(result.filename).toBe("image.jpg");
      expect(result.extension).toBe("jpg");
      expect(result.fileType).toBe("image");
      expect(result.size).toBe(1024);
      expect(result.status).toBe("hashed");
      expect(result.sha256Hash).toBe("hash123");
      expect(result.contentHash).toBe("content456");
      expect(result.perceptualHash).toBe("phash789");
      expect(result.createdAt).toBe(validDate.getTime());
      expect(result.updatedAt).toBe(validDate2.getTime());
    });

    test("accepts null hash values", () => {
      const input = {
        scanFolderId: 5,
        path: "/path/file.png",
        filename: "file.png",
        extension: "png",
        fileType: "image",
        size: 512,
        status: "pending",
        sha256Hash: null,
        contentHash: null,
        perceptualHash: null,
        createdAt: 0,
        updatedAt: 0,
      };
      const result = MediaFileRecord.parse(input);
      expect(result.sha256Hash).toBeNull();
      expect(result.contentHash).toBeNull();
      expect(result.perceptualHash).toBeNull();
    });

    test("parsed result omits id (schema has no id field)", () => {
      const input = {
        id: 1,
        scanFolderId: 10,
        path: "/path/file.jpg",
        filename: "file.jpg",
        extension: "jpg",
        fileType: "image",
        size: 1024,
        status: "pending",
        sha256Hash: null,
        contentHash: null,
        perceptualHash: null,
        createdAt: 0,
        updatedAt: 0,
      };
      const result = MediaFileRecord.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) expect("id" in result.data).toBe(false);
    });

    test("accepts video file type", () => {
      const input = {
        scanFolderId: 3,
        path: "/videos/movie.mp4",
        filename: "movie.mp4",
        extension: "mp4",
        fileType: "video",
        size: 10000000,
        status: "hashed",
        sha256Hash: "videohash",
        contentHash: null,
        perceptualHash: null,
        createdAt: 1000,
        updatedAt: 2000,
      };
      const result = MediaFileRecord.parse(input);
      expect(result.fileType).toBe("video");
    });
  });

  describe("NewMediaFile", () => {
    test("parses input without id, createdAt, updatedAt", () => {
      const input = {
        scanFolderId: 10,
        path: "/new/folder/image.jpg",
        filename: "image.jpg",
        extension: "jpg",
        fileType: "image" as const,
        size: 2048,
        status: "pending" as const,
        sha256Hash: null,
        contentHash: null,
        perceptualHash: null,
      };
      const result = NewMediaFile.parse(input);
      expect(result.scanFolderId).toBe(10);
      expect(result.path).toBe("/new/folder/image.jpg");
      expect(result.filename).toBe("image.jpg");
      expect(result.extension).toBe("jpg");
      expect(result.fileType).toBe("image");
      expect(result.size).toBe(2048);
      expect("id" in result).toBe(false);
      expect("createdAt" in result).toBe(false);
      expect("updatedAt" in result).toBe(false);
    });

    test("applies defaults for optional fields", () => {
      const input = {
        scanFolderId: 5,
        path: "/minimal/path.png",
        filename: "path.png",
        extension: "png",
        fileType: "image" as const,
        size: 100,
      };
      const result = NewMediaFile.parse(input);
      expect(result.status).toBe("pending");
      expect(result.sha256Hash).toBeNull();
      expect(result.contentHash).toBeNull();
      expect(result.perceptualHash).toBeNull();
    });

    test("rejects empty path", () => {
      const input = {
        scanFolderId: 5,
        path: "",
        filename: "file.jpg",
        extension: "jpg",
        fileType: "image" as const,
        size: 100,
      };
      expect(NewMediaFile.safeParse(input).success).toBe(false);
    });

    test("rejects empty filename", () => {
      const input = {
        scanFolderId: 5,
        path: "/path/file.jpg",
        filename: "",
        extension: "jpg",
        fileType: "image" as const,
        size: 100,
      };
      expect(NewMediaFile.safeParse(input).success).toBe(false);
    });

    test("rejects empty extension", () => {
      const input = {
        scanFolderId: 5,
        path: "/path/file.jpg",
        filename: "file.jpg",
        extension: "",
        fileType: "image" as const,
        size: 100,
      };
      expect(NewMediaFile.safeParse(input).success).toBe(false);
    });

    test("rejects invalid scanFolderId", () => {
      const input = {
        scanFolderId: 0,
        path: "/path/file.jpg",
        filename: "file.jpg",
        extension: "jpg",
        fileType: "image" as const,
        size: 100,
      };
      expect(NewMediaFile.safeParse(input).success).toBe(false);
    });

    test("rejects negative size", () => {
      const input = {
        scanFolderId: 5,
        path: "/path/file.jpg",
        filename: "file.jpg",
        extension: "jpg",
        fileType: "image" as const,
        size: -100,
      };
      expect(NewMediaFile.safeParse(input).success).toBe(false);
    });

    test("accepts video file type", () => {
      const input = {
        scanFolderId: 5,
        path: "/path/video.mp4",
        filename: "video.mp4",
        extension: "mp4",
        fileType: "video" as const,
        size: 5000000,
      };
      const result = NewMediaFile.parse(input);
      expect(result.fileType).toBe("video");
    });
  });

  describe("UpdateMediaFile", () => {
    test("requires id", () => {
      expect(UpdateMediaFile.safeParse({ path: "/other" }).success).toBe(false);
      const result = UpdateMediaFile.safeParse({ id: 1 });
      expect(result.success).toBe(true);
    });

    test("accepts partial update with id", () => {
      const result = UpdateMediaFile.parse({ id: 1, path: "/updated/path.jpg" });
      expect(result.id).toBe(1);
      expect(result.path).toBe("/updated/path.jpg");
    });

    test("accepts only id", () => {
      const result = UpdateMediaFile.parse({ id: 5 });
      expect(result.id).toBe(5);
    });

    test("accepts multiple optional fields", () => {
      const result = UpdateMediaFile.parse({
        id: 2,
        scanFolderId: 20,
        path: "/new/path.png",
        filename: "newfile.png",
        extension: "png",
        fileType: "image",
        size: 4096,
        status: "hashed",
        sha256Hash: "newhash",
        contentHash: "newcontent",
        perceptualHash: "newphash",
      });
      expect(result.id).toBe(2);
      expect(result.scanFolderId).toBe(20);
      expect(result.path).toBe("/new/path.png");
      expect(result.filename).toBe("newfile.png");
      expect(result.extension).toBe("png");
      expect(result.fileType).toBe("image");
      expect(result.size).toBe(4096);
      expect(result.status).toBe("hashed");
      expect(result.sha256Hash).toBe("newhash");
      expect(result.contentHash).toBe("newcontent");
      expect(result.perceptualHash).toBe("newphash");
    });

    test("rejects invalid id", () => {
      expect(UpdateMediaFile.safeParse({ id: 0 }).success).toBe(false);
      expect(UpdateMediaFile.safeParse({ id: -1 }).success).toBe(false);
    });

    test("rejects invalid scanFolderId when provided", () => {
      expect(UpdateMediaFile.safeParse({ id: 1, scanFolderId: 0 }).success).toBe(false);
      expect(UpdateMediaFile.safeParse({ id: 1, scanFolderId: -1 }).success).toBe(false);
    });

    test("rejects empty path when provided", () => {
      expect(UpdateMediaFile.safeParse({ id: 1, path: "" }).success).toBe(false);
    });

    test("rejects empty filename when provided", () => {
      expect(UpdateMediaFile.safeParse({ id: 1, filename: "" }).success).toBe(false);
    });

    test("rejects empty extension when provided", () => {
      expect(UpdateMediaFile.safeParse({ id: 1, extension: "" }).success).toBe(false);
    });

    test("rejects invalid fileType when provided", () => {
      expect(UpdateMediaFile.safeParse({ id: 1, fileType: "audio" }).success).toBe(false);
    });

    test("rejects negative size when provided", () => {
      expect(UpdateMediaFile.safeParse({ id: 1, size: -1 }).success).toBe(false);
    });

    test("rejects invalid status when provided", () => {
      expect(UpdateMediaFile.safeParse({ id: 1, status: "processing" }).success).toBe(false);
    });

    test("allows updating hash values to null", () => {
      const result = UpdateMediaFile.parse({
        id: 1,
        sha256Hash: null,
        contentHash: null,
        perceptualHash: null,
      });
      expect(result.sha256Hash).toBeNull();
      expect(result.contentHash).toBeNull();
      expect(result.perceptualHash).toBeNull();
    });

    test("allows updating status to error", () => {
      const result = UpdateMediaFile.parse({ id: 1, status: "error" });
      expect(result.status).toBe("error");
    });
  });
});
