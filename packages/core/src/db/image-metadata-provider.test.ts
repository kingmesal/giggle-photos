import { beforeEach, describe, expect, test } from "bun:test";
import type { Generated } from "kysely";
import type { ImageMetadataRecord } from "../zod/image-metadata";
import { ImageMetadataProvider } from "./image-metadata-provider";
import type { DatabaseInstance } from "./schema";

/**
 * In-memory fake implementing the minimal Kysely interface used by ImageMetadataProvider.
 * Used because Bun's built-in SQLite driver with Kysely does not return INSERT/SELECT results reliably.
 */

function createFakeDb(shared?: { rows: ImageMetadataRecord[]; nextId: number }): DatabaseInstance {
  const state = shared ?? { rows: [] as ImageMetadataRecord[], nextId: 1 };

  const toRow = (v: Record<string, unknown>): ImageMetadataRecord => {
    const id = state.nextId++;
    return {
      id: id as unknown as Generated<number>,
      mediaFileId: Number(v.mediaFileId ?? 1),
      width: Number(v.width ?? 100),
      height: Number(v.height ?? 100),
      format: String(v.format ?? "jpeg"),
      colorSpace: v.colorSpace === null || v.colorSpace === undefined ? null : String(v.colorSpace),
      hasAlpha: (v.hasAlpha === true || v.hasAlpha === 1 ? 1 : 0) as 0 | 1,
      orientation: v.orientation === null || v.orientation === undefined ? null : Number(v.orientation),
      dateTaken:
        v.dateTaken === null || v.dateTaken === undefined
          ? null
          : v.dateTaken instanceof Date
            ? v.dateTaken.getTime()
            : Number(v.dateTaken),
      cameraMake: v.cameraMake === null || v.cameraMake === undefined ? null : String(v.cameraMake),
      cameraModel: v.cameraModel === null || v.cameraModel === undefined ? null : String(v.cameraModel),
      gpsLatitude: v.gpsLatitude === null || v.gpsLatitude === undefined ? null : Number(v.gpsLatitude),
      gpsLongitude: v.gpsLongitude === null || v.gpsLongitude === undefined ? null : Number(v.gpsLongitude),
      createdAt: v.createdAt instanceof Date ? v.createdAt.getTime() : Number(v.createdAt ?? Date.now()),
      updatedAt: v.updatedAt instanceof Date ? v.updatedAt.getTime() : Number(v.updatedAt ?? Date.now()),
    };
  };

  // Helper to apply where conditions
  const applyWhereConditions = (
    rows: ImageMetadataRecord[],
    conditions: Array<{ col: string; op: string; val: unknown }>,
  ): ImageMetadataRecord[] => {
    return rows.filter((row) => {
      return conditions.every(({ col, op, val }) => {
        const rowVal = (row as Record<string, unknown>)[col];
        if (op === "=") return rowVal === val;
        if (op === "in" && Array.isArray(val)) return val.includes(rowVal);
        if (op === "is not" && val === null) return rowVal !== null;
        return true;
      });
    });
  };

  const createQueryBuilder = (initialConditions: Array<{ col: string; op: string; val: unknown }> = []) => {
    const conditions = [...initialConditions];

    const builder = {
      selectAll: () => builder,
      select: (arg: unknown) => {
        // Handle both array and function forms
        if (typeof arg === "function") {
          // Expression builder for count
          return {
            groupBy: (_groupCol: string) => ({
              execute: async () => {
                const matchingRows = applyWhereConditions(state.rows, conditions);
                const groups: Record<string, number> = {};
                for (const row of matchingRows) {
                  const key = row.format;
                  groups[key] = (groups[key] || 0) + 1;
                }
                return Object.entries(groups).map(([format, count]) => ({ format, count }));
              },
            }),
            executeTakeFirst: async () => {
              const matchingRows = applyWhereConditions(state.rows, conditions);
              return { count: matchingRows.length };
            },
          };
        }
        // Array form for select columns
        return {
          select: (innerArg: unknown) => {
            if (typeof innerArg === "function") {
              return {
                groupBy: (_groupCol: string) => ({
                  execute: async () => {
                    const matchingRows = applyWhereConditions(state.rows, conditions);
                    const groups: Record<string, number> = {};
                    for (const row of matchingRows) {
                      const key = row.format;
                      groups[key] = (groups[key] || 0) + 1;
                    }
                    return Object.entries(groups).map(([format, count]) => ({ format, count }));
                  },
                }),
              };
            }
            return builder;
          },
          executeTakeFirst: async () => {
            const matchingRows = applyWhereConditions(state.rows, conditions);
            return matchingRows.length > 0 ? { id: matchingRows[0].id } : undefined;
          },
        };
      },
      where: (col: string, op: string, val: unknown) => {
        conditions.push({ col, op, val });
        return builder;
      },
      orderBy: (_col: string, _dir: string) => builder,
      execute: async () => {
        const matchingRows = applyWhereConditions(state.rows, conditions);
        return [...matchingRows].sort((a, b) => (a.id as number) - (b.id as number));
      },
      executeTakeFirst: async () => {
        const matchingRows = applyWhereConditions(state.rows, conditions);
        return matchingRows.length > 0 ? matchingRows[0] : undefined;
      },
    };

    return builder;
  };

  const db: DatabaseInstance = {
    insertInto: () => ({
      values: (v: Record<string, unknown> | Record<string, unknown>[]) => {
        const doInsert = () => {
          if (Array.isArray(v)) {
            const inserted: ImageMetadataRecord[] = [];
            for (const item of v) {
              const row = toRow(item);
              state.rows.push(row);
              inserted.push(row);
            }
            return inserted;
          }
          const row = toRow(v);
          state.rows.push(row);
          return row;
        };
        return {
          execute: async () => {
            const result = doInsert();
            if (Array.isArray(result)) {
              return result.map(() => ({})); // Return array of results for batch
            }
            return [{}];
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
    selectFrom: () => createQueryBuilder(),
    updateTable: () => ({
      set: (v: Record<string, unknown>) => ({
        where: (_col: string, _op: string, id: unknown) => {
          const applyUpdate = () => {
            const idx = state.rows.findIndex((r) => r.id === id);
            if (idx < 0) return;
            const now = Date.now();
            state.rows[idx] = {
              ...state.rows[idx],
              ...(v as Partial<ImageMetadataRecord>),
              updatedAt: now,
            };
          };
          return {
            execute: async () => applyUpdate(),
            returningAll: () => ({
              executeTakeFirst: async () => {
                applyUpdate();
                const idx = state.rows.findIndex((r) => r.id === id);
                return idx >= 0 ? state.rows[idx] : undefined;
              },
            }),
          };
        },
      }),
    }),
    deleteFrom: () => ({
      where: (col: string, _op: string, val: unknown) => ({
        execute: async () => {
          const idx = state.rows.findIndex((r) => (r as Record<string, unknown>)[col] === val);
          if (idx >= 0) state.rows.splice(idx, 1);
        },
      }),
    }),
    transaction: () => ({
      execute: async <T>(cb: (trx: DatabaseInstance) => Promise<T>): Promise<T> => {
        const snapshot = state.rows.map((r) => ({ ...r }));
        try {
          return await cb(createFakeDb(state));
        } catch (e) {
          state.rows.length = 0;
          state.rows.push(...snapshot);
          throw e;
        }
      },
    }),
  } as unknown as DatabaseInstance;

  return db;
}

describe("ImageMetadataProvider", () => {
  let provider: ImageMetadataProvider;
  let db: DatabaseInstance;

  beforeEach(() => {
    db = createFakeDb();
    provider = new ImageMetadataProvider(db);
  });

  describe("insertImageMetadata", () => {
    test("inserts a new image metadata and returns parsed ImageMetadata", async () => {
      const result = await provider.insertImageMetadata({
        mediaFileId: 1,
        width: 1920,
        height: 1080,
        format: "jpeg",
        hasAlpha: false,
      });

      expect(result.id).toBeGreaterThan(0);
      expect(result.mediaFileId).toBe(1);
      expect(result.width).toBe(1920);
      expect(result.height).toBe(1080);
      expect(result.format).toBe("jpeg");
      expect(result.hasAlpha).toBe(false);
      expect(result.colorSpace).toBeNull();
      expect(result.orientation).toBeNull();
      expect(result.dateTaken).toBeNull();
      expect(result.cameraMake).toBeNull();
      expect(result.cameraModel).toBeNull();
      expect(result.gpsLatitude).toBeNull();
      expect(result.gpsLongitude).toBeNull();
      expect(result.createdAt).toBeInstanceOf(Date);
      expect(result.updatedAt).toBeInstanceOf(Date);
    });

    test("inserts with all optional fields", async () => {
      const dateTaken = new Date("2024-01-15T10:30:00Z");
      const result = await provider.insertImageMetadata({
        mediaFileId: 2,
        width: 4000,
        height: 3000,
        format: "png",
        hasAlpha: true,
        colorSpace: "sRGB",
        orientation: 6,
        dateTaken,
        cameraMake: "Canon",
        cameraModel: "EOS R5",
        gpsLatitude: 40.7128,
        gpsLongitude: -74.006,
      });

      expect(result.mediaFileId).toBe(2);
      expect(result.width).toBe(4000);
      expect(result.height).toBe(3000);
      expect(result.format).toBe("png");
      expect(result.hasAlpha).toBe(true);
      expect(result.colorSpace).toBe("sRGB");
      expect(result.orientation).toBe(6);
      expect(result.dateTaken).toBeInstanceOf(Date);
      expect(result.cameraMake).toBe("Canon");
      expect(result.cameraModel).toBe("EOS R5");
      expect(result.gpsLatitude).toBe(40.7128);
      expect(result.gpsLongitude).toBe(-74.006);
    });

    test("rejects invalid mediaFileId", async () => {
      await expect(
        provider.insertImageMetadata({
          mediaFileId: -1,
          width: 100,
          height: 100,
          format: "jpeg",
          hasAlpha: false,
        }),
      ).rejects.toThrow();
    });

    test("rejects invalid dimensions", async () => {
      await expect(
        provider.insertImageMetadata({
          mediaFileId: 1,
          width: 0,
          height: 100,
          format: "jpeg",
          hasAlpha: false,
        }),
      ).rejects.toThrow();
    });

    test("rejects empty format", async () => {
      await expect(
        provider.insertImageMetadata({
          mediaFileId: 1,
          width: 100,
          height: 100,
          format: "",
          hasAlpha: false,
        }),
      ).rejects.toThrow();
    });
  });

  describe("insertImageMetadataBatch", () => {
    test("inserts multiple records and returns count", async () => {
      const records = [
        { mediaFileId: 1, width: 100, height: 100, format: "jpeg", hasAlpha: false },
        { mediaFileId: 2, width: 200, height: 200, format: "png", hasAlpha: true },
        { mediaFileId: 3, width: 300, height: 300, format: "webp", hasAlpha: false },
      ];

      const count = await provider.insertImageMetadataBatch(records);
      expect(count).toBe(3);

      const all = await provider.getAllImageMetadata();
      expect(all).toHaveLength(3);
    });

    test("returns 0 for empty array", async () => {
      const count = await provider.insertImageMetadataBatch([]);
      expect(count).toBe(0);
    });

    test("validates each record", async () => {
      const records = [
        { mediaFileId: 1, width: 100, height: 100, format: "jpeg", hasAlpha: false },
        { mediaFileId: -1, width: 200, height: 200, format: "png", hasAlpha: true }, // Invalid
      ];

      await expect(provider.insertImageMetadataBatch(records)).rejects.toThrow();
    });
  });

  describe("getAllImageMetadata", () => {
    test("returns empty array when no metadata", async () => {
      const results = await provider.getAllImageMetadata();
      expect(results).toEqual([]);
    });

    test("returns all metadata ordered by id asc", async () => {
      await provider.insertImageMetadata({ mediaFileId: 1, width: 100, height: 100, format: "jpeg", hasAlpha: false });
      await provider.insertImageMetadata({ mediaFileId: 2, width: 200, height: 200, format: "png", hasAlpha: true });
      await provider.insertImageMetadata({ mediaFileId: 3, width: 300, height: 300, format: "webp", hasAlpha: false });

      const results = await provider.getAllImageMetadata();
      expect(results).toHaveLength(3);
      expect(results[0].mediaFileId).toBe(1);
      expect(results[1].mediaFileId).toBe(2);
      expect(results[2].mediaFileId).toBe(3);
    });

    test("parses each row as ImageMetadata", async () => {
      await provider.insertImageMetadata({ mediaFileId: 1, width: 100, height: 100, format: "jpeg", hasAlpha: false });
      const results = await provider.getAllImageMetadata();
      expect(results[0].id).toBeGreaterThan(0);
      expect(results[0].createdAt).toBeInstanceOf(Date);
      expect(results[0].updatedAt).toBeInstanceOf(Date);
    });
  });

  describe("getImageMetadataById", () => {
    test("returns null when id does not exist", async () => {
      const result = await provider.getImageMetadataById(999);
      expect(result).toBeNull();
    });

    test("returns metadata when id exists", async () => {
      const inserted = await provider.insertImageMetadata({
        mediaFileId: 1,
        width: 100,
        height: 100,
        format: "jpeg",
        hasAlpha: false,
      });
      const result = await provider.getImageMetadataById(inserted.id);
      expect(result).not.toBeNull();
      expect(result?.id).toBe(inserted.id);
      expect(result?.mediaFileId).toBe(1);
    });
  });

  describe("getByMediaFileId", () => {
    test("returns null when mediaFileId does not exist", async () => {
      const result = await provider.getByMediaFileId(999);
      expect(result).toBeNull();
    });

    test("returns metadata when mediaFileId exists", async () => {
      await provider.insertImageMetadata({
        mediaFileId: 42,
        width: 100,
        height: 100,
        format: "jpeg",
        hasAlpha: false,
      });
      const result = await provider.getByMediaFileId(42);
      expect(result).not.toBeNull();
      expect(result?.mediaFileId).toBe(42);
    });
  });

  describe("getByMediaFileIds", () => {
    test("returns empty array for empty input", async () => {
      const results = await provider.getByMediaFileIds([]);
      expect(results).toEqual([]);
    });

    test("returns metadata for multiple media file ids", async () => {
      await provider.insertImageMetadata({ mediaFileId: 1, width: 100, height: 100, format: "jpeg", hasAlpha: false });
      await provider.insertImageMetadata({ mediaFileId: 2, width: 200, height: 200, format: "png", hasAlpha: true });
      await provider.insertImageMetadata({ mediaFileId: 3, width: 300, height: 300, format: "webp", hasAlpha: false });

      const results = await provider.getByMediaFileIds([1, 3]);
      expect(results).toHaveLength(2);
      const mediaFileIds = results.map((r) => r.mediaFileId);
      expect(mediaFileIds).toContain(1);
      expect(mediaFileIds).toContain(3);
    });

    test("returns empty array when no matching ids", async () => {
      await provider.insertImageMetadata({ mediaFileId: 1, width: 100, height: 100, format: "jpeg", hasAlpha: false });
      const results = await provider.getByMediaFileIds([99, 100]);
      expect(results).toEqual([]);
    });
  });

  describe("getByFormat", () => {
    test("returns metadata matching format", async () => {
      await provider.insertImageMetadata({ mediaFileId: 1, width: 100, height: 100, format: "jpeg", hasAlpha: false });
      await provider.insertImageMetadata({ mediaFileId: 2, width: 200, height: 200, format: "png", hasAlpha: true });
      await provider.insertImageMetadata({ mediaFileId: 3, width: 300, height: 300, format: "jpeg", hasAlpha: false });

      const results = await provider.getByFormat("jpeg");
      expect(results).toHaveLength(2);
      expect(results.every((r) => r.format === "jpeg")).toBe(true);
    });

    test("returns empty array when no matching format", async () => {
      await provider.insertImageMetadata({ mediaFileId: 1, width: 100, height: 100, format: "jpeg", hasAlpha: false });
      const results = await provider.getByFormat("webp");
      expect(results).toEqual([]);
    });

    test("orders results by id asc", async () => {
      await provider.insertImageMetadata({ mediaFileId: 1, width: 100, height: 100, format: "png", hasAlpha: false });
      await provider.insertImageMetadata({ mediaFileId: 2, width: 200, height: 200, format: "png", hasAlpha: true });

      const results = await provider.getByFormat("png");
      expect(results[0].mediaFileId).toBe(1);
      expect(results[1].mediaFileId).toBe(2);
    });
  });

  describe("getByDimensions", () => {
    test("returns metadata matching dimensions", async () => {
      await provider.insertImageMetadata({
        mediaFileId: 1,
        width: 1920,
        height: 1080,
        format: "jpeg",
        hasAlpha: false,
      });
      await provider.insertImageMetadata({ mediaFileId: 2, width: 1920, height: 1080, format: "png", hasAlpha: true });
      await provider.insertImageMetadata({
        mediaFileId: 3,
        width: 3840,
        height: 2160,
        format: "jpeg",
        hasAlpha: false,
      });

      const results = await provider.getByDimensions(1920, 1080);
      expect(results).toHaveLength(2);
      expect(results.every((r) => r.width === 1920 && r.height === 1080)).toBe(true);
    });

    test("returns empty array when no matching dimensions", async () => {
      await provider.insertImageMetadata({ mediaFileId: 1, width: 100, height: 100, format: "jpeg", hasAlpha: false });
      const results = await provider.getByDimensions(200, 200);
      expect(results).toEqual([]);
    });
  });

  describe("getByCamera", () => {
    test("returns metadata matching camera make only", async () => {
      await provider.insertImageMetadata({
        mediaFileId: 1,
        width: 100,
        height: 100,
        format: "jpeg",
        hasAlpha: false,
        cameraMake: "Canon",
        cameraModel: "EOS R5",
      });
      await provider.insertImageMetadata({
        mediaFileId: 2,
        width: 100,
        height: 100,
        format: "jpeg",
        hasAlpha: false,
        cameraMake: "Canon",
        cameraModel: "EOS R6",
      });
      await provider.insertImageMetadata({
        mediaFileId: 3,
        width: 100,
        height: 100,
        format: "jpeg",
        hasAlpha: false,
        cameraMake: "Nikon",
        cameraModel: "Z8",
      });

      const results = await provider.getByCamera("Canon");
      expect(results).toHaveLength(2);
      expect(results.every((r) => r.cameraMake === "Canon")).toBe(true);
    });

    test("returns metadata matching camera make and model", async () => {
      await provider.insertImageMetadata({
        mediaFileId: 1,
        width: 100,
        height: 100,
        format: "jpeg",
        hasAlpha: false,
        cameraMake: "Canon",
        cameraModel: "EOS R5",
      });
      await provider.insertImageMetadata({
        mediaFileId: 2,
        width: 100,
        height: 100,
        format: "jpeg",
        hasAlpha: false,
        cameraMake: "Canon",
        cameraModel: "EOS R6",
      });

      const results = await provider.getByCamera("Canon", "EOS R5");
      expect(results).toHaveLength(1);
      expect(results[0].cameraModel).toBe("EOS R5");
    });

    test("returns empty array when no matching camera", async () => {
      await provider.insertImageMetadata({
        mediaFileId: 1,
        width: 100,
        height: 100,
        format: "jpeg",
        hasAlpha: false,
        cameraMake: "Canon",
      });
      const results = await provider.getByCamera("Sony");
      expect(results).toEqual([]);
    });
  });

  describe("getWithGpsCoordinates", () => {
    test("returns metadata with GPS coordinates", async () => {
      await provider.insertImageMetadata({
        mediaFileId: 1,
        width: 100,
        height: 100,
        format: "jpeg",
        hasAlpha: false,
        gpsLatitude: 40.7128,
        gpsLongitude: -74.006,
      });
      await provider.insertImageMetadata({
        mediaFileId: 2,
        width: 100,
        height: 100,
        format: "jpeg",
        hasAlpha: false,
        // No GPS
      });
      await provider.insertImageMetadata({
        mediaFileId: 3,
        width: 100,
        height: 100,
        format: "jpeg",
        hasAlpha: false,
        gpsLatitude: 34.0522,
        gpsLongitude: -118.2437,
      });

      const results = await provider.getWithGpsCoordinates();
      expect(results).toHaveLength(2);
      expect(results.every((r) => r.gpsLatitude !== null && r.gpsLongitude !== null)).toBe(true);
    });

    test("returns empty array when no metadata has GPS", async () => {
      await provider.insertImageMetadata({ mediaFileId: 1, width: 100, height: 100, format: "jpeg", hasAlpha: false });
      const results = await provider.getWithGpsCoordinates();
      expect(results).toEqual([]);
    });
  });

  describe("getWithAlpha", () => {
    test("returns metadata with alpha channel", async () => {
      await provider.insertImageMetadata({ mediaFileId: 1, width: 100, height: 100, format: "png", hasAlpha: true });
      await provider.insertImageMetadata({ mediaFileId: 2, width: 100, height: 100, format: "jpeg", hasAlpha: false });
      await provider.insertImageMetadata({ mediaFileId: 3, width: 100, height: 100, format: "webp", hasAlpha: true });

      const results = await provider.getWithAlpha();
      expect(results).toHaveLength(2);
      expect(results.every((r) => r.hasAlpha === true)).toBe(true);
    });

    test("returns empty array when no metadata has alpha", async () => {
      await provider.insertImageMetadata({ mediaFileId: 1, width: 100, height: 100, format: "jpeg", hasAlpha: false });
      const results = await provider.getWithAlpha();
      expect(results).toEqual([]);
    });
  });

  describe("getTotalCount", () => {
    test("returns 0 when no metadata", async () => {
      const count = await provider.getTotalCount();
      expect(count).toBe(0);
    });

    test("returns correct count", async () => {
      await provider.insertImageMetadata({ mediaFileId: 1, width: 100, height: 100, format: "jpeg", hasAlpha: false });
      await provider.insertImageMetadata({ mediaFileId: 2, width: 200, height: 200, format: "png", hasAlpha: true });
      await provider.insertImageMetadata({ mediaFileId: 3, width: 300, height: 300, format: "webp", hasAlpha: false });

      const count = await provider.getTotalCount();
      expect(count).toBe(3);
    });
  });

  describe("getCountByFormat", () => {
    test("returns empty object when no metadata", async () => {
      const counts = await provider.getCountByFormat();
      expect(counts).toEqual({});
    });

    test("returns counts grouped by format", async () => {
      await provider.insertImageMetadata({ mediaFileId: 1, width: 100, height: 100, format: "jpeg", hasAlpha: false });
      await provider.insertImageMetadata({ mediaFileId: 2, width: 200, height: 200, format: "png", hasAlpha: true });
      await provider.insertImageMetadata({ mediaFileId: 3, width: 300, height: 300, format: "jpeg", hasAlpha: false });
      await provider.insertImageMetadata({ mediaFileId: 4, width: 400, height: 400, format: "webp", hasAlpha: false });
      await provider.insertImageMetadata({ mediaFileId: 5, width: 500, height: 500, format: "jpeg", hasAlpha: true });

      const counts = await provider.getCountByFormat();
      expect(counts.jpeg).toBe(3);
      expect(counts.png).toBe(1);
      expect(counts.webp).toBe(1);
    });
  });

  describe("updateImageMetadata", () => {
    test("updates fields (no return)", async () => {
      const inserted = await provider.insertImageMetadata({
        mediaFileId: 1,
        width: 100,
        height: 100,
        format: "jpeg",
        hasAlpha: false,
      });

      await provider.updateImageMetadata({
        id: inserted.id,
        width: 200,
        height: 200,
        format: "png",
      });

      const updated = await provider.getImageMetadataById(inserted.id);
      expect(updated).not.toBeNull();
      expect(updated?.width).toBe(200);
      expect(updated?.height).toBe(200);
      expect(updated?.format).toBe("png");
    });

    test("partial update only changes provided fields", async () => {
      const inserted = await provider.insertImageMetadata({
        mediaFileId: 1,
        width: 100,
        height: 100,
        format: "jpeg",
        hasAlpha: false,
        cameraMake: "Canon",
      });

      await provider.updateImageMetadata({ id: inserted.id, cameraMake: "Nikon" });

      const updated = await provider.getImageMetadataById(inserted.id);
      expect(updated).not.toBeNull();
      expect(updated?.width).toBe(100);
      expect(updated?.height).toBe(100);
      expect(updated?.format).toBe("jpeg");
      expect(updated?.cameraMake).toBe("Nikon");
    });

    test("throws when id does not exist", async () => {
      await expect(provider.updateImageMetadata({ id: 99999, width: 200 })).rejects.toThrow();
    });
  });

  describe("deleteImageMetadata", () => {
    test("removes metadata by id", async () => {
      const inserted = await provider.insertImageMetadata({
        mediaFileId: 1,
        width: 100,
        height: 100,
        format: "jpeg",
        hasAlpha: false,
      });
      await provider.deleteImageMetadata(inserted.id);

      const found = await provider.getImageMetadataById(inserted.id);
      expect(found).toBeNull();
    });

    test("no-op when id does not exist", async () => {
      await expect(provider.deleteImageMetadata(99999)).resolves.toBeUndefined();
    });
  });

  describe("deleteByMediaFileId", () => {
    test("removes metadata by media file id", async () => {
      await provider.insertImageMetadata({
        mediaFileId: 42,
        width: 100,
        height: 100,
        format: "jpeg",
        hasAlpha: false,
      });
      await provider.deleteByMediaFileId(42);

      const found = await provider.getByMediaFileId(42);
      expect(found).toBeNull();
    });

    test("no-op when media file id does not exist", async () => {
      await expect(provider.deleteByMediaFileId(99999)).resolves.toBeUndefined();
    });
  });

  describe("existsForMediaFile", () => {
    test("returns true when metadata exists for media file", async () => {
      await provider.insertImageMetadata({
        mediaFileId: 42,
        width: 100,
        height: 100,
        format: "jpeg",
        hasAlpha: false,
      });
      const exists = await provider.existsForMediaFile(42);
      expect(exists).toBe(true);
    });

    test("returns false when no metadata exists for media file", async () => {
      const exists = await provider.existsForMediaFile(999);
      expect(exists).toBe(false);
    });
  });

  describe("transaction", () => {
    test("runs callback with ImageMetadataProvider over transaction", async () => {
      await provider.insertImageMetadata({
        mediaFileId: 1,
        width: 100,
        height: 100,
        format: "jpeg",
        hasAlpha: false,
      });
      const metadata = await provider.transaction(async (trx) => trx.getAllImageMetadata());
      expect(metadata).toHaveLength(1);
      expect(metadata[0].mediaFileId).toBe(1);
    });

    test("rolls back on callback error", async () => {
      const inserted = await provider.insertImageMetadata({
        mediaFileId: 1,
        width: 100,
        height: 100,
        format: "jpeg",
        hasAlpha: false,
      });
      await expect(
        provider.transaction(async (trx) => {
          await trx.updateImageMetadata({ id: inserted.id, width: 999 });
          throw new Error("abort");
        }),
      ).rejects.toThrow("abort");

      const metadata = await provider.getImageMetadataById(inserted.id);
      expect(metadata).not.toBeNull();
      expect(metadata?.width).toBe(100);
    });
  });

  describe("verifyRecordExists", () => {
    test("does not throw when record exists", async () => {
      const inserted = await provider.insertImageMetadata({
        mediaFileId: 1,
        width: 100,
        height: 100,
        format: "jpeg",
        hasAlpha: false,
      });
      await expect(provider.verifyRecordExists(inserted.id)).resolves.toBeUndefined();
    });

    test("throws when record does not exist", async () => {
      await expect(provider.verifyRecordExists(99999)).rejects.toThrow("No result");
    });
  });
});
