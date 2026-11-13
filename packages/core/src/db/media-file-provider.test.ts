import { beforeEach, describe, expect, test } from "bun:test";
import type { Generated } from "kysely";
import type { FileStatus, FileType, MediaFileRecord } from "../zod/media-file";
import { MediaFileProvider } from "./media-file-provider";
import type { DatabaseInstance } from "./schema";

/**
 * In-memory fake implementing the minimal Kysely interface used by MediaFileProvider.
 * Used because Bun's built-in SQLite driver with Kysely does not return INSERT/SELECT results reliably.
 */

function createFakeDb(shared?: { rows: MediaFileRecord[]; nextId: number }): DatabaseInstance {
  const state = shared ?? { rows: [] as MediaFileRecord[], nextId: 1 };

  const toRow = (v: Record<string, unknown>): MediaFileRecord => {
    const id = state.nextId++;
    return {
      id: id as unknown as Generated<number>,
      scanFolderId: Number(v.scanFolderId ?? 1),
      path: String(v.path ?? ""),
      filename: String(v.filename ?? ""),
      extension: String(v.extension ?? ""),
      fileType: String(v.fileType ?? "image") as FileType,
      size: Number(v.size ?? 0),
      status: String(v.status ?? "pending") as FileStatus,
      sha256Hash: v.sha256Hash === null || v.sha256Hash === undefined ? null : String(v.sha256Hash),
      contentHash: v.contentHash === null || v.contentHash === undefined ? null : String(v.contentHash),
      perceptualHash: v.perceptualHash === null || v.perceptualHash === undefined ? null : String(v.perceptualHash),
      createdAt: v.createdAt instanceof Date ? v.createdAt.getTime() : Number(v.createdAt ?? Date.now()),
      updatedAt: v.updatedAt instanceof Date ? v.updatedAt.getTime() : Number(v.updatedAt ?? Date.now()),
    };
  };

  // Helper to apply filters
  const applyWhereChain = (
    rows: MediaFileRecord[],
    filters: Array<{ col: string; op: string; val: unknown }>,
  ): MediaFileRecord[] => {
    return rows.filter((r) => {
      return filters.every(({ col, op, val }) => {
        const rowVal = (r as Record<string, unknown>)[col];
        if (op === "=") return rowVal === val;
        if (op === "!=") return rowVal !== val;
        if (op === "is" && val === null) return rowVal === null;
        if (op === "in" && Array.isArray(val)) return val.includes(rowVal);
        return true;
      });
    });
  };

  const createWhereBuilder = (filters: Array<{ col: string; op: string; val: unknown }>) => {
    return {
      where: (col: string, op: string, val: unknown) => {
        return createWhereBuilder([...filters, { col, op, val }]);
      },
      orderBy: (col: string, dir: string) => ({
        execute: async () => {
          const filtered = applyWhereChain(state.rows, filters);
          return filtered.sort((a, b) => {
            const aVal = (a as Record<string, unknown>)[col];
            const bVal = (b as Record<string, unknown>)[col];
            if (typeof aVal === "string" && typeof bVal === "string") {
              return dir === "asc" ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
            }
            return dir === "asc" ? Number(aVal) - Number(bVal) : Number(bVal) - Number(aVal);
          });
        },
        limit: (n: number) => ({
          execute: async () => {
            const filtered = applyWhereChain(state.rows, filters);
            const sorted = filtered.sort((a, b) => {
              const aVal = (a as Record<string, unknown>)[col];
              const bVal = (b as Record<string, unknown>)[col];
              if (typeof aVal === "string" && typeof bVal === "string") {
                return dir === "asc" ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
              }
              return dir === "asc" ? Number(aVal) - Number(bVal) : Number(bVal) - Number(aVal);
            });
            return sorted.slice(0, n);
          },
        }),
      }),
      execute: async () => applyWhereChain(state.rows, filters),
      executeTakeFirst: async () => applyWhereChain(state.rows, filters)[0] ?? undefined,
      select: (col: string) => ({
        executeTakeFirst: async () => {
          const row = applyWhereChain(state.rows, filters)[0];
          return row ? { [col]: (row as Record<string, unknown>)[col] } : undefined;
        },
      }),
      groupBy: (col: string) => ({
        execute: async () => {
          const filtered = applyWhereChain(state.rows, filters);
          const groups: Record<string, number> = {};
          for (const row of filtered) {
            const key = String((row as Record<string, unknown>)[col]);
            groups[key] = (groups[key] ?? 0) + 1;
          }
          return Object.entries(groups).map(([status, count]) => ({ status, count }));
        },
      }),
    };
  };

  const db: DatabaseInstance = {
    insertInto: () => ({
      values: (v: Record<string, unknown> | Record<string, unknown>[]) => {
        const doInsert = () => {
          if (Array.isArray(v)) {
            const inserted: MediaFileRecord[] = [];
            for (const item of v) {
              const path = String(item.path ?? "");
              if (state.rows.some((r) => r.path === path))
                throw new Error("UNIQUE constraint failed: media_files.path");
              const row = toRow(item);
              state.rows.push(row);
              inserted.push(row);
            }
            return inserted;
          }
          const path = String(v.path ?? "");
          if (state.rows.some((r) => r.path === path)) throw new Error("UNIQUE constraint failed: media_files.path");
          const row = toRow(v);
          state.rows.push(row);
          return row;
        };
        return {
          execute: async () => {
            const result = doInsert();
            // Return array-like result for batch inserts
            return Array.isArray(result) ? result.map(() => ({})) : [{}];
          },
          returningAll: () => ({
            executeTakeFirst: async () => {
              const result = doInsert();
              return Array.isArray(result) ? result[0] : result;
            },
          }),
        };
      },
    }),
    selectFrom: () => ({
      selectAll: () => ({
        where: (col: string, op: string, val: unknown) => createWhereBuilder([{ col, op, val }]),
        orderBy: (col: string, dir: string) => ({
          execute: async () => {
            return [...state.rows].sort((a, b) => {
              const aVal = (a as Record<string, unknown>)[col];
              const bVal = (b as Record<string, unknown>)[col];
              if (typeof aVal === "string" && typeof bVal === "string") {
                return dir === "asc" ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
              }
              return dir === "asc" ? Number(aVal) - Number(bVal) : Number(bVal) - Number(aVal);
            });
          },
        }),
        execute: async () => [...state.rows],
      }),
      where: (col: string, op: string, val: unknown) => ({
        select: (selectCol: string) => ({
          executeTakeFirst: async () => {
            const filtered = applyWhereChain(state.rows, [{ col, op, val }]);
            const row = filtered[0];
            return row ? { [selectCol]: (row as Record<string, unknown>)[selectCol] } : undefined;
          },
        }),
      }),
      select: (colsOrFn: string[] | ((eb: unknown) => unknown)) => {
        // Handle function-based select (for count aggregation)
        if (typeof colsOrFn === "function") {
          // Execute the function to get the count expression
          colsOrFn({
            fn: {
              count: () => ({
                as: () => ({}),
              }),
            },
          });
          return {
            executeTakeFirst: async () => ({ count: state.rows.length }),
            groupBy: () => ({
              execute: async () => {
                const groups: Record<string, number> = {};
                for (const row of state.rows) {
                  const key = String((row as Record<string, unknown>).status);
                  groups[key] = (groups[key] ?? 0) + 1;
                }
                return Object.entries(groups).map(([status, count]) => ({ status, count }));
              },
            }),
          };
        }
        // Handle array-based select (for columns)
        const cols = colsOrFn as string[];
        return {
          select: (eb: (builder: unknown) => { as: (name: string) => unknown }) => {
            // Handle count aggregation
            eb({
              fn: {
                count: () => ({
                  as: () => ({}),
                }),
              },
            });
            return {
              groupBy: () => ({
                execute: async () => {
                  const groups: Record<string, number> = {};
                  for (const row of state.rows) {
                    const key = String((row as Record<string, unknown>)[cols[0]]);
                    groups[key] = (groups[key] ?? 0) + 1;
                  }
                  return Object.entries(groups).map(([status, count]) => ({ status, count }));
                },
              }),
              executeTakeFirst: async () => ({ count: state.rows.length }),
            };
          },
        };
      },
    }),
    updateTable: () => ({
      set: (v: Record<string, unknown>) => ({
        where: (col: string, op: string, val: unknown) => {
          const applyUpdate = () => {
            const filtered = applyWhereChain(state.rows, [{ col, op, val }]);
            const now = Date.now();
            for (const row of filtered) {
              const idx = state.rows.indexOf(row);
              if (idx >= 0) {
                state.rows[idx] = {
                  ...state.rows[idx],
                  ...(v as Partial<MediaFileRecord>),
                  updatedAt: now,
                };
              }
            }
          };
          return {
            execute: async () => applyUpdate(),
            returningAll: () => ({
              executeTakeFirst: async () => {
                applyUpdate();
                const filtered = applyWhereChain(state.rows, [{ col, op, val }]);
                return filtered[0];
              },
            }),
          };
        },
      }),
    }),
    deleteFrom: () => ({
      where: (col: string, op: string, val: unknown) => ({
        execute: async () => {
          const toDelete = applyWhereChain(state.rows, [{ col, op, val }]);
          for (const row of toDelete) {
            const idx = state.rows.indexOf(row);
            if (idx >= 0) state.rows.splice(idx, 1);
          }
          // Return array with length = number deleted
          return toDelete.map(() => ({}));
        },
      }),
    }),
    transaction: () => ({
      execute: async <T>(cb: (trx: DatabaseInstance) => Promise<T>): Promise<T> => {
        const snapshot = state.rows.map((r) => ({ ...r }));
        const snapshotNextId = state.nextId;
        try {
          return await cb(createFakeDb(state));
        } catch (e) {
          state.rows.length = 0;
          state.rows.push(...snapshot);
          state.nextId = snapshotNextId;
          throw e;
        }
      },
    }),
  } as unknown as DatabaseInstance;

  return db;
}

// Helper to create valid NewMediaFile data
function createMediaFileData(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    scanFolderId: 1,
    path: "/photos/test.jpg",
    filename: "test.jpg",
    extension: "jpg",
    fileType: "image" as FileType,
    size: 1024,
    status: "pending" as FileStatus,
    sha256Hash: null,
    contentHash: null,
    perceptualHash: null,
    ...overrides,
  };
}

describe("MediaFileProvider", () => {
  let provider: MediaFileProvider;
  let db: DatabaseInstance;

  beforeEach(() => {
    db = createFakeDb();
    provider = new MediaFileProvider(db);
  });

  describe("insertMediaFile", () => {
    test("inserts a new media file and returns parsed MediaFile", async () => {
      const result = await provider.insertMediaFile(createMediaFileData());

      expect(result.id).toBeGreaterThan(0);
      expect(result.path).toBe("/photos/test.jpg");
      expect(result.filename).toBe("test.jpg");
      expect(result.extension).toBe("jpg");
      expect(result.fileType).toBe("image");
      expect(result.size).toBe(1024);
      expect(result.status).toBe("pending");
      expect(result.sha256Hash).toBeNull();
      expect(result.contentHash).toBeNull();
      expect(result.perceptualHash).toBeNull();
      expect(result.createdAt).toBeInstanceOf(Date);
      expect(result.updatedAt).toBeInstanceOf(Date);
    });

    test("applies NewMediaFile defaults when optional fields omitted", async () => {
      const result = await provider.insertMediaFile({
        scanFolderId: 1,
        path: "/photos/default.jpg",
        filename: "default.jpg",
        extension: "jpg",
        fileType: "image",
        size: 512,
      });

      expect(result.status).toBe("pending");
      expect(result.sha256Hash).toBeNull();
      expect(result.contentHash).toBeNull();
      expect(result.perceptualHash).toBeNull();
    });

    test("rejects empty path", async () => {
      await expect(provider.insertMediaFile(createMediaFileData({ path: "" }))).rejects.toThrow();
    });

    test("rejects empty filename", async () => {
      await expect(provider.insertMediaFile(createMediaFileData({ filename: "" }))).rejects.toThrow();
    });

    test("rejects empty extension", async () => {
      await expect(provider.insertMediaFile(createMediaFileData({ extension: "" }))).rejects.toThrow();
    });

    test("rejects negative size", async () => {
      await expect(provider.insertMediaFile(createMediaFileData({ size: -1 }))).rejects.toThrow();
    });

    test("rejects invalid file type", async () => {
      await expect(provider.insertMediaFile(createMediaFileData({ fileType: "audio" }))).rejects.toThrow();
    });

    test("rejects invalid status", async () => {
      await expect(provider.insertMediaFile(createMediaFileData({ status: "invalid" }))).rejects.toThrow();
    });

    test("rejects duplicate path (unique constraint)", async () => {
      await provider.insertMediaFile(createMediaFileData({ path: "/unique/path.jpg" }));
      await expect(provider.insertMediaFile(createMediaFileData({ path: "/unique/path.jpg" }))).rejects.toThrow();
    });

    test("inserts video file type", async () => {
      const result = await provider.insertMediaFile(
        createMediaFileData({
          path: "/videos/test.mp4",
          filename: "test.mp4",
          extension: "mp4",
          fileType: "video",
        }),
      );

      expect(result.fileType).toBe("video");
    });
  });

  describe("insertMediaFiles", () => {
    test("returns 0 when given empty array", async () => {
      const count = await provider.insertMediaFiles([]);
      expect(count).toBe(0);
    });

    test("inserts multiple files and returns count", async () => {
      const files = [
        createMediaFileData({ path: "/photos/a.jpg", filename: "a.jpg" }),
        createMediaFileData({ path: "/photos/b.jpg", filename: "b.jpg" }),
        createMediaFileData({ path: "/photos/c.jpg", filename: "c.jpg" }),
      ];

      const count = await provider.insertMediaFiles(files);

      expect(count).toBe(3);

      const all = await provider.getAllMediaFiles();
      expect(all).toHaveLength(3);
    });

    test("validates each file with Zod", async () => {
      const files = [
        createMediaFileData({ path: "/photos/valid.jpg", filename: "valid.jpg" }),
        createMediaFileData({ path: "", filename: "invalid.jpg" }), // Invalid empty path
      ];

      await expect(provider.insertMediaFiles(files)).rejects.toThrow();
    });
  });

  describe("getAllMediaFiles", () => {
    test("returns empty array when no files", async () => {
      const results = await provider.getAllMediaFiles();
      expect(results).toEqual([]);
    });

    test("returns all media files ordered by path asc", async () => {
      await provider.insertMediaFile(createMediaFileData({ path: "/z/file.jpg", filename: "file.jpg" }));
      await provider.insertMediaFile(createMediaFileData({ path: "/a/file.jpg", filename: "file.jpg" }));
      await provider.insertMediaFile(createMediaFileData({ path: "/m/file.jpg", filename: "file.jpg" }));

      const results = await provider.getAllMediaFiles();

      expect(results).toHaveLength(3);
      expect(results[0].path).toBe("/a/file.jpg");
      expect(results[1].path).toBe("/m/file.jpg");
      expect(results[2].path).toBe("/z/file.jpg");
    });

    test("parses each row as MediaFile with Date objects", async () => {
      await provider.insertMediaFile(createMediaFileData());

      const results = await provider.getAllMediaFiles();

      expect(results[0].id).toBeGreaterThan(0);
      expect(results[0].createdAt).toBeInstanceOf(Date);
      expect(results[0].updatedAt).toBeInstanceOf(Date);
    });
  });

  describe("getMediaFileById", () => {
    test("returns null when id does not exist", async () => {
      const result = await provider.getMediaFileById(999);
      expect(result).toBeNull();
    });

    test("returns media file when id exists", async () => {
      const inserted = await provider.insertMediaFile(createMediaFileData({ path: "/by-id.jpg" }));

      const result = await provider.getMediaFileById(inserted.id);

      expect(result).not.toBeNull();
      expect(result?.id).toBe(inserted.id);
      expect(result?.path).toBe("/by-id.jpg");
    });
  });

  describe("getMediaFileByPath", () => {
    test("returns null when path does not exist", async () => {
      const result = await provider.getMediaFileByPath("/nonexistent.jpg");
      expect(result).toBeNull();
    });

    test("returns media file when path exists", async () => {
      await provider.insertMediaFile(createMediaFileData({ path: "/exact/path.jpg" }));

      const result = await provider.getMediaFileByPath("/exact/path.jpg");

      expect(result).not.toBeNull();
      expect(result?.path).toBe("/exact/path.jpg");
    });
  });

  describe("getMediaFilesByFolderId", () => {
    test("returns empty array when no files for folder", async () => {
      const results = await provider.getMediaFilesByFolderId(999);
      expect(results).toEqual([]);
    });

    test("returns only files for specified folder ordered by path", async () => {
      await provider.insertMediaFile(
        createMediaFileData({ scanFolderId: 1, path: "/folder1/z.jpg", filename: "z.jpg" }),
      );
      await provider.insertMediaFile(
        createMediaFileData({ scanFolderId: 2, path: "/folder2/a.jpg", filename: "a.jpg" }),
      );
      await provider.insertMediaFile(
        createMediaFileData({ scanFolderId: 1, path: "/folder1/a.jpg", filename: "a.jpg" }),
      );

      const results = await provider.getMediaFilesByFolderId(1);

      expect(results).toHaveLength(2);
      expect(results[0].path).toBe("/folder1/a.jpg");
      expect(results[1].path).toBe("/folder1/z.jpg");
    });
  });

  describe("getMediaFilesByStatus", () => {
    test("returns empty array when no files with status", async () => {
      const results = await provider.getMediaFilesByStatus("hashed");
      expect(results).toEqual([]);
    });

    test("returns files matching status ordered by id", async () => {
      await provider.insertMediaFile(createMediaFileData({ path: "/a.jpg", status: "pending" }));
      await provider.insertMediaFile(createMediaFileData({ path: "/b.jpg", status: "hashed" }));
      await provider.insertMediaFile(createMediaFileData({ path: "/c.jpg", status: "pending" }));

      const results = await provider.getMediaFilesByStatus("pending");

      expect(results).toHaveLength(2);
      expect(results[0].path).toBe("/a.jpg");
      expect(results[1].path).toBe("/c.jpg");
    });

    test("respects limit parameter", async () => {
      await provider.insertMediaFile(createMediaFileData({ path: "/a.jpg", status: "pending" }));
      await provider.insertMediaFile(createMediaFileData({ path: "/b.jpg", status: "pending" }));
      await provider.insertMediaFile(createMediaFileData({ path: "/c.jpg", status: "pending" }));

      const results = await provider.getMediaFilesByStatus("pending", 2);

      expect(results).toHaveLength(2);
    });
  });

  describe("getMediaFilesByTypeAndStatus", () => {
    test("returns empty array when no files match", async () => {
      const results = await provider.getMediaFilesByTypeAndStatus("video", "hashed");
      expect(results).toEqual([]);
    });

    test("filters by both file type and status", async () => {
      await provider.insertMediaFile(createMediaFileData({ path: "/a.jpg", fileType: "image", status: "pending" }));
      await provider.insertMediaFile(
        createMediaFileData({
          path: "/b.mp4",
          filename: "b.mp4",
          extension: "mp4",
          fileType: "video",
          status: "pending",
        }),
      );
      await provider.insertMediaFile(createMediaFileData({ path: "/c.jpg", fileType: "image", status: "hashed" }));
      await provider.insertMediaFile(createMediaFileData({ path: "/d.jpg", fileType: "image", status: "pending" }));

      const results = await provider.getMediaFilesByTypeAndStatus("image", "pending");

      expect(results).toHaveLength(2);
      expect(results.every((f) => f.fileType === "image" && f.status === "pending")).toBe(true);
    });

    test("respects limit parameter", async () => {
      await provider.insertMediaFile(createMediaFileData({ path: "/a.jpg", fileType: "image", status: "pending" }));
      await provider.insertMediaFile(createMediaFileData({ path: "/b.jpg", fileType: "image", status: "pending" }));
      await provider.insertMediaFile(createMediaFileData({ path: "/c.jpg", fileType: "image", status: "pending" }));

      const results = await provider.getMediaFilesByTypeAndStatus("image", "pending", 1);

      expect(results).toHaveLength(1);
    });
  });

  describe("getFilesNeedingHashing", () => {
    test("returns pending/metadata images and videos whose metadata is done", async () => {
      await provider.insertMediaFile(createMediaFileData({ path: "/a.jpg", status: "pending" }));
      await provider.insertMediaFile(createMediaFileData({ path: "/b.jpg", status: "metadata" }));
      await provider.insertMediaFile(createMediaFileData({ path: "/c.mp4", fileType: "video", status: "metadata" }));
      await provider.insertMediaFile(createMediaFileData({ path: "/d.jpg", status: "hashed" }));

      const results = await provider.getFilesNeedingHashing();

      expect(results.map((f) => f.path)).toEqual(["/a.jpg", "/b.jpg", "/c.mp4"]);
    });

    test("excludes pending videos and hashed, processed or errored files", async () => {
      await provider.insertMediaFile(createMediaFileData({ path: "/a.mp4", fileType: "video", status: "pending" }));
      await provider.insertMediaFile(createMediaFileData({ path: "/b.jpg", status: "hashed" }));
      await provider.insertMediaFile(createMediaFileData({ path: "/c.jpg", status: "processed" }));
      await provider.insertMediaFile(createMediaFileData({ path: "/d.jpg", status: "error" }));

      const results = await provider.getFilesNeedingHashing();

      expect(results).toEqual([]);
    });

    test("respects limit", async () => {
      await provider.insertMediaFile(createMediaFileData({ path: "/a.jpg", status: "metadata" }));
      await provider.insertMediaFile(createMediaFileData({ path: "/b.jpg", status: "metadata" }));
      await provider.insertMediaFile(createMediaFileData({ path: "/c.jpg", status: "metadata" }));

      const results = await provider.getFilesNeedingHashing(2);

      expect(results).toHaveLength(2);
    });

    test("orders by id ascending", async () => {
      await provider.insertMediaFile(createMediaFileData({ path: "/c.jpg", status: "metadata" }));
      await provider.insertMediaFile(createMediaFileData({ path: "/a.jpg", status: "metadata" }));
      await provider.insertMediaFile(createMediaFileData({ path: "/b.jpg", status: "metadata" }));

      const results = await provider.getFilesNeedingHashing();

      expect(results).toHaveLength(3);
      // Ordered by id (insertion order), not by path
      expect(results[0].path).toBe("/c.jpg");
      expect(results[1].path).toBe("/a.jpg");
      expect(results[2].path).toBe("/b.jpg");
    });
  });

  describe("findBySha256Hash", () => {
    test("returns empty array when no files match hash", async () => {
      const results = await provider.findBySha256Hash("nonexistent");
      expect(results).toEqual([]);
    });

    test("returns all files with matching sha256Hash ordered by id", async () => {
      const hash = "abc123def456";
      await provider.insertMediaFile(createMediaFileData({ path: "/a.jpg", sha256Hash: hash }));
      await provider.insertMediaFile(createMediaFileData({ path: "/b.jpg", sha256Hash: "different" }));
      await provider.insertMediaFile(createMediaFileData({ path: "/c.jpg", sha256Hash: hash }));

      const results = await provider.findBySha256Hash(hash);

      expect(results).toHaveLength(2);
      expect(results[0].path).toBe("/a.jpg");
      expect(results[1].path).toBe("/c.jpg");
    });
  });

  describe("findByContentHash", () => {
    test("returns empty array when no files match hash", async () => {
      const results = await provider.findByContentHash("nonexistent");
      expect(results).toEqual([]);
    });

    test("returns all files with matching contentHash ordered by id", async () => {
      const hash = "content123";
      await provider.insertMediaFile(createMediaFileData({ path: "/a.jpg", contentHash: hash }));
      await provider.insertMediaFile(createMediaFileData({ path: "/b.jpg", contentHash: "different" }));
      await provider.insertMediaFile(createMediaFileData({ path: "/c.jpg", contentHash: hash }));

      const results = await provider.findByContentHash(hash);

      expect(results).toHaveLength(2);
      expect(results[0].path).toBe("/a.jpg");
      expect(results[1].path).toBe("/c.jpg");
    });
  });

  describe("getCountByStatus", () => {
    test("returns zeroes for all statuses when no files", async () => {
      const counts = await provider.getCountByStatus();

      expect(counts).toEqual({
        pending: 0,
        metadata: 0,
        hashed: 0,
        processed: 0,
        error: 0,
      });
    });

    test("returns counts grouped by status", async () => {
      await provider.insertMediaFile(createMediaFileData({ path: "/a.jpg", status: "pending" }));
      await provider.insertMediaFile(createMediaFileData({ path: "/b.jpg", status: "pending" }));
      await provider.insertMediaFile(createMediaFileData({ path: "/c.jpg", status: "metadata" }));
      await provider.insertMediaFile(createMediaFileData({ path: "/d.jpg", status: "hashed" }));
      await provider.insertMediaFile(createMediaFileData({ path: "/e.jpg", status: "hashed" }));
      await provider.insertMediaFile(createMediaFileData({ path: "/f.jpg", status: "hashed" }));
      await provider.insertMediaFile(createMediaFileData({ path: "/g.jpg", status: "error" }));
      await provider.insertMediaFile(createMediaFileData({ path: "/h.jpg", status: "processed" }));

      const counts = await provider.getCountByStatus();

      expect(counts).toEqual({
        pending: 2,
        metadata: 1,
        hashed: 3,
        processed: 1,
        error: 1,
      });
    });
  });

  describe("getTotalCount", () => {
    test("returns 0 when no files", async () => {
      const count = await provider.getTotalCount();
      expect(count).toBe(0);
    });

    test("returns total count of all media files", async () => {
      await provider.insertMediaFile(createMediaFileData({ path: "/a.jpg" }));
      await provider.insertMediaFile(createMediaFileData({ path: "/b.jpg" }));
      await provider.insertMediaFile(createMediaFileData({ path: "/c.jpg" }));

      const count = await provider.getTotalCount();

      expect(count).toBe(3);
    });
  });

  describe("updateMediaFile", () => {
    test("updates specified fields only", async () => {
      const inserted = await provider.insertMediaFile(
        createMediaFileData({ path: "/update.jpg", status: "pending", sha256Hash: null }),
      );

      await provider.updateMediaFile({
        id: inserted.id,
        status: "hashed",
        sha256Hash: "newhash123",
      });

      const updated = await provider.getMediaFileById(inserted.id);
      expect(updated).not.toBeNull();
      expect(updated?.status).toBe("hashed");
      expect(updated?.sha256Hash).toBe("newhash123");
      expect(updated?.path).toBe("/update.jpg"); // Unchanged
    });

    test("updates updatedAt timestamp", async () => {
      const inserted = await provider.insertMediaFile(createMediaFileData({ path: "/timestamp.jpg" }));
      const originalUpdatedAt = inserted.updatedAt;

      // Wait a bit to ensure timestamp difference
      await new Promise((resolve) => setTimeout(resolve, 10));

      await provider.updateMediaFile({ id: inserted.id, status: "metadata" });

      const updated = await provider.getMediaFileById(inserted.id);
      expect(updated?.updatedAt.getTime()).toBeGreaterThan(originalUpdatedAt.getTime());
    });

    test("throws when id does not exist", async () => {
      await expect(provider.updateMediaFile({ id: 99999, status: "hashed" })).rejects.toThrow();
    });

    test("validates update data with Zod", async () => {
      const inserted = await provider.insertMediaFile(createMediaFileData({ path: "/validate.jpg" }));

      await expect(provider.updateMediaFile({ id: inserted.id, status: "invalid" as FileStatus })).rejects.toThrow();
    });
  });

  describe("updateStatusBatch", () => {
    test("does nothing when ids array is empty", async () => {
      await expect(provider.updateStatusBatch([], "hashed")).resolves.toBeUndefined();
    });

    test("updates status for multiple files", async () => {
      const file1 = await provider.insertMediaFile(createMediaFileData({ path: "/a.jpg", status: "pending" }));
      const file2 = await provider.insertMediaFile(createMediaFileData({ path: "/b.jpg", status: "pending" }));
      const file3 = await provider.insertMediaFile(createMediaFileData({ path: "/c.jpg", status: "pending" }));

      await provider.updateStatusBatch([file1.id, file3.id], "metadata");

      const updated1 = await provider.getMediaFileById(file1.id);
      const updated2 = await provider.getMediaFileById(file2.id);
      const updated3 = await provider.getMediaFileById(file3.id);

      expect(updated1?.status).toBe("metadata");
      expect(updated2?.status).toBe("pending"); // Not in batch
      expect(updated3?.status).toBe("metadata");
    });
  });

  describe("deleteMediaFile", () => {
    test("removes media file by id", async () => {
      const inserted = await provider.insertMediaFile(createMediaFileData({ path: "/to-delete.jpg" }));

      await provider.deleteMediaFile(inserted.id);

      const found = await provider.getMediaFileById(inserted.id);
      expect(found).toBeNull();
    });

    test("no-op when id does not exist", async () => {
      await expect(provider.deleteMediaFile(99999)).resolves.toBeUndefined();
    });
  });

  describe("deleteByFolderId", () => {
    test("returns 0 when no files in folder", async () => {
      const count = await provider.deleteByFolderId(999);
      expect(count).toBe(0);
    });

    test("deletes all files for specified folder and returns count", async () => {
      await provider.insertMediaFile(createMediaFileData({ scanFolderId: 1, path: "/folder1/a.jpg" }));
      await provider.insertMediaFile(createMediaFileData({ scanFolderId: 1, path: "/folder1/b.jpg" }));
      await provider.insertMediaFile(createMediaFileData({ scanFolderId: 2, path: "/folder2/a.jpg" }));

      const count = await provider.deleteByFolderId(1);

      expect(count).toBe(2);

      const all = await provider.getAllMediaFiles();
      expect(all).toHaveLength(1);
      expect(all[0].scanFolderId).toBe(2);
    });
  });

  describe("pathExists", () => {
    test("returns false when path does not exist", async () => {
      const exists = await provider.pathExists("/nonexistent.jpg");
      expect(exists).toBe(false);
    });

    test("returns true when path exists", async () => {
      await provider.insertMediaFile(createMediaFileData({ path: "/exists.jpg" }));

      const exists = await provider.pathExists("/exists.jpg");
      expect(exists).toBe(true);
    });
  });

  describe("transaction", () => {
    test("runs callback with MediaFileProvider over transaction", async () => {
      await provider.insertMediaFile(createMediaFileData({ path: "/in-tx.jpg" }));

      const files = await provider.transaction(async (trx) => trx.getAllMediaFiles());

      expect(files).toHaveLength(1);
      expect(files[0].path).toBe("/in-tx.jpg");
    });

    test("rolls back on callback error", async () => {
      const inserted = await provider.insertMediaFile(
        createMediaFileData({ path: "/rollback.jpg", status: "pending" }),
      );

      await expect(
        provider.transaction(async (trx) => {
          await trx.updateMediaFile({ id: inserted.id, status: "metadata" });
          throw new Error("abort");
        }),
      ).rejects.toThrow("abort");

      const file = await provider.getMediaFileById(inserted.id);
      expect(file).not.toBeNull();
      expect(file?.status).toBe("pending");
    });

    test("commits changes on successful callback", async () => {
      const inserted = await provider.insertMediaFile(createMediaFileData({ path: "/commit.jpg", status: "pending" }));

      await provider.transaction(async (trx) => {
        await trx.updateMediaFile({ id: inserted.id, status: "hashed" });
      });

      const file = await provider.getMediaFileById(inserted.id);
      expect(file?.status).toBe("hashed");
    });

    test("allows inserting within transaction", async () => {
      const newFile = await provider.transaction(async (trx) => {
        return await trx.insertMediaFile(createMediaFileData({ path: "/tx-insert.jpg" }));
      });

      expect(newFile.id).toBeGreaterThan(0);

      const found = await provider.getMediaFileByPath("/tx-insert.jpg");
      expect(found).not.toBeNull();
    });
  });

  describe("verifyRecordExists", () => {
    test("throws when record does not exist", async () => {
      await expect(provider.verifyRecordExists(99999)).rejects.toThrow("No result");
    });

    test("does not throw when record exists", async () => {
      const inserted = await provider.insertMediaFile(createMediaFileData({ path: "/verify.jpg" }));
      await expect(provider.verifyRecordExists(inserted.id)).resolves.toBeUndefined();
    });
  });
});
