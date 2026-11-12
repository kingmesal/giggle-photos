import { describe, expect, test } from "bun:test";
import { FolderStatus, NewScanFolder, ScanFolder, ScanFolderRecord, UpdateScanFolder } from "./scan-folder";

const validDate = new Date("2024-01-15T12:00:00.000Z");
const validDate2 = new Date("2024-01-16T12:00:00.000Z");

function validScanFolderInput(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    path: "/some/folder",
    priority: 3,
    status: "added" as const,
    scanSubdirectories: true,
    imageCount: 0,
    videoCount: 0,
    totalSize: 0,
    createdAt: validDate,
    updatedAt: validDate2,
    ...overrides,
  };
}

describe("scan-folder", () => {
  describe("FolderStatus", () => {
    test("accepts all valid status literals", () => {
      expect(FolderStatus.parse("added")).toBe("added");
      expect(FolderStatus.parse("scanning")).toBe("scanning");
      expect(FolderStatus.parse("ready")).toBe("ready");
      expect(FolderStatus.parse("error")).toBe("error");
    });

    test("defaults to added when used as default in object", () => {
      const obj = ScanFolder.parse(validScanFolderInput({ status: undefined }));
      expect(obj.status).toBe("added");
    });

    test("rejects invalid status", () => {
      expect(FolderStatus.safeParse("pending").success).toBe(false);
      expect(FolderStatus.safeParse("").success).toBe(false);
      expect(FolderStatus.safeParse(1).success).toBe(false);
    });
  });

  describe("ScanFolder", () => {
    test("parses valid full input", () => {
      const input = validScanFolderInput();
      const result = ScanFolder.parse(input);
      expect(result.id).toBe(1);
      expect(result.path).toBe("/some/folder");
      expect(result.priority).toBe(3);
      expect(result.status).toBe("added");
      expect(result.scanSubdirectories).toBe(true);
      expect(result.imageCount).toBe(0);
      expect(result.videoCount).toBe(0);
      expect(result.totalSize).toBe(0);
      expect(result.createdAt).toEqual(validDate);
      expect(result.updatedAt).toEqual(validDate2);
    });

    test("applies defaults for optional fields", () => {
      const input = {
        id: 1,
        path: "/path",
        createdAt: validDate,
        updatedAt: validDate2,
      };
      const result = ScanFolder.parse(input);
      expect(result.priority).toBe(3);
      expect(result.status).toBe("added");
      expect(result.scanSubdirectories).toBe(true);
      expect(result.imageCount).toBe(0);
      expect(result.videoCount).toBe(0);
      expect(result.totalSize).toBe(0);
    });

    test("accepts priority 1 to 5", () => {
      for (let p = 1; p <= 5; p++) {
        const result = ScanFolder.parse(validScanFolderInput({ priority: p }));
        expect(result.priority).toBe(p);
      }
    });

    test("rejects id zero or negative", () => {
      expect(ScanFolder.safeParse(validScanFolderInput({ id: 0 })).success).toBe(false);
      expect(ScanFolder.safeParse(validScanFolderInput({ id: -1 })).success).toBe(false);
    });

    test("rejects non-integer id", () => {
      expect(ScanFolder.safeParse(validScanFolderInput({ id: 1.5 })).success).toBe(false);
    });

    test("rejects empty path", () => {
      expect(ScanFolder.safeParse(validScanFolderInput({ path: "" })).success).toBe(false);
    });

    test("rejects priority below 1 or above 5", () => {
      expect(ScanFolder.safeParse(validScanFolderInput({ priority: 0 })).success).toBe(false);
      expect(ScanFolder.safeParse(validScanFolderInput({ priority: 6 })).success).toBe(false);
    });

    test("rejects negative imageCount, videoCount, or totalSize", () => {
      expect(ScanFolder.safeParse(validScanFolderInput({ imageCount: -1 })).success).toBe(false);
      expect(ScanFolder.safeParse(validScanFolderInput({ videoCount: -1 })).success).toBe(false);
      expect(ScanFolder.safeParse(validScanFolderInput({ totalSize: -1 })).success).toBe(false);
    });

    test("accepts date-like inputs for createdAt/updatedAt", () => {
      const input = validScanFolderInput({
        createdAt: validDate.getTime(),
        updatedAt: validDate2.getTime(),
      });
      const result = ScanFolder.parse(input);
      expect(result.createdAt).toBeInstanceOf(Date);
      expect(result.updatedAt).toBeInstanceOf(Date);
    });
  });

  describe("ScanFolderRecord", () => {
    test("parses input with SQL types for scanSubdirectories and dates", () => {
      const input = {
        path: "/some/folder",
        priority: 3,
        status: "ready",
        scanSubdirectories: 1,
        imageCount: 10,
        videoCount: 2,
        totalSize: 1000,
        createdAt: validDate.getTime(),
        updatedAt: validDate2.getTime(),
      };
      const result = ScanFolderRecord.parse(input);
      expect(result.path).toBe("/some/folder");
      expect(result.scanSubdirectories).toBe(1);
      expect(result.createdAt).toBe(validDate.getTime());
      expect(result.updatedAt).toBe(validDate2.getTime());
    });

    test("preprocesses scanSubdirectories boolean to 0/1", () => {
      const input = {
        path: "/path",
        priority: 1,
        status: "added",
        scanSubdirectories: true,
        imageCount: 0,
        videoCount: 0,
        totalSize: 0,
        createdAt: 0,
        updatedAt: 0,
      };
      const result = ScanFolderRecord.parse(input);
      expect(result.scanSubdirectories).toBe(1);
    });

    test("parsed result omits id (schema has no id field)", () => {
      const input = {
        id: 1,
        path: "/path",
        priority: 1,
        status: "added",
        scanSubdirectories: 0,
        imageCount: 0,
        videoCount: 0,
        totalSize: 0,
        createdAt: 0,
        updatedAt: 0,
      };
      const result = ScanFolderRecord.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) expect("id" in result.data).toBe(false);
    });
  });

  describe("NewScanFolder", () => {
    test("parses input without id, createdAt, updatedAt", () => {
      const input = {
        path: "/new/folder",
        priority: 2,
        status: "added",
        scanSubdirectories: true,
        imageCount: 0,
        videoCount: 0,
        totalSize: 0,
      };
      const result = NewScanFolder.parse(input);
      expect(result.path).toBe("/new/folder");
      expect(result.priority).toBe(2);
      expect("id" in result).toBe(false);
      expect("createdAt" in result).toBe(false);
      expect("updatedAt" in result).toBe(false);
    });

    test("applies defaults for optional fields", () => {
      const input = { path: "/minimal" };
      const result = NewScanFolder.parse(input);
      expect(result.priority).toBe(3);
      expect(result.status).toBe("added");
      expect(result.scanSubdirectories).toBe(true);
      expect(result.imageCount).toBe(0);
      expect(result.videoCount).toBe(0);
      expect(result.totalSize).toBe(0);
    });

    test("rejects empty path", () => {
      expect(NewScanFolder.safeParse({ path: "" }).success).toBe(false);
    });
  });

  describe("UpdateScanFolder", () => {
    test("requires id", () => {
      expect(UpdateScanFolder.safeParse({ path: "/other" }).success).toBe(false);
      const result = UpdateScanFolder.safeParse({ id: 1 });
      expect(result.success).toBe(true);
    });

    test("accepts partial update with id", () => {
      const result = UpdateScanFolder.parse({ id: 1, path: "/updated/path" });
      expect(result.id).toBe(1);
      expect(result.path).toBe("/updated/path");
    });

    test("accepts only id", () => {
      const result = UpdateScanFolder.parse({ id: 5 });
      expect(result.id).toBe(5);
    });

    test("accepts multiple optional fields", () => {
      const result = UpdateScanFolder.parse({
        id: 2,
        path: "/p",
        priority: 1,
        status: "scanning",
        scanSubdirectories: false,
        imageCount: 5,
      });
      expect(result.id).toBe(2);
      expect(result.path).toBe("/p");
      expect(result.priority).toBe(1);
      expect(result.status).toBe("scanning");
      expect(result.scanSubdirectories).toBe(false);
      expect(result.imageCount).toBe(5);
    });

    test("rejects invalid id", () => {
      expect(UpdateScanFolder.safeParse({ id: 0 }).success).toBe(false);
      expect(UpdateScanFolder.safeParse({ id: -1 }).success).toBe(false);
    });

    test("rejects invalid priority when provided", () => {
      expect(UpdateScanFolder.safeParse({ id: 1, priority: 0 }).success).toBe(false);
      expect(UpdateScanFolder.safeParse({ id: 1, priority: 6 }).success).toBe(false);
    });
  });
});
