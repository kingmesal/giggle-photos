import { beforeEach, describe, expect, test } from "bun:test";
import type { Generated } from "kysely";
import type { VideoMetadataRecord } from "../zod/video-metadata";
import type { DatabaseInstance } from "./schema";
import { VideoMetadataProvider } from "./video-metadata-provider";

/**
 * In-memory fake implementing the minimal Kysely interface used by VideoMetadataProvider.
 * Used because Bun's built-in SQLite driver with Kysely does not return INSERT/SELECT results reliably.
 */

function createFakeDb(shared?: { rows: VideoMetadataRecord[]; nextId: number }): DatabaseInstance {
  const state = shared ?? { rows: [] as VideoMetadataRecord[], nextId: 1 };

  const toRow = (v: Record<string, unknown>): VideoMetadataRecord => {
    const id = state.nextId++;
    return {
      id: id as unknown as Generated<number>,
      mediaFileId: Number(v.mediaFileId),
      width: Number(v.width),
      height: Number(v.height),
      duration: Number(v.duration),
      frameRate: v.frameRate !== undefined ? (v.frameRate === null ? null : Number(v.frameRate)) : null,
      codec: v.codec !== undefined ? (v.codec === null ? null : String(v.codec)) : null,
      audioCodec: v.audioCodec !== undefined ? (v.audioCodec === null ? null : String(v.audioCodec)) : null,
      bitrate: v.bitrate !== undefined ? (v.bitrate === null ? null : Number(v.bitrate)) : null,
      dateTaken:
        v.dateTaken !== undefined
          ? v.dateTaken === null
            ? null
            : v.dateTaken instanceof Date
              ? v.dateTaken.getTime()
              : Number(v.dateTaken)
          : null,
      createdAt: v.createdAt instanceof Date ? v.createdAt.getTime() : Number(v.createdAt ?? Date.now()),
      updatedAt: v.updatedAt instanceof Date ? v.updatedAt.getTime() : Number(v.updatedAt ?? Date.now()),
    };
  };

  const db: DatabaseInstance = {
    insertInto: () => ({
      values: (v: Record<string, unknown>) => {
        const doInsert = () => {
          const mediaFileId = Number(v.mediaFileId);
          if (state.rows.some((r) => r.mediaFileId === mediaFileId)) {
            throw new Error("UNIQUE constraint failed: video_metadata.media_file_id");
          }
          const row = toRow(v);
          state.rows.push(row);
          return row;
        };
        return {
          execute: async () => {
            doInsert();
          },
          returningAll: () => ({
            executeTakeFirst: async () => doInsert(),
          }),
        };
      },
    }),
    selectFrom: () => ({
      selectAll: () => ({
        where: (col: string, _op: string, val: unknown) => ({
          executeTakeFirst: async () =>
            state.rows.find((r) => (r as Record<string, unknown>)[col] === val) ?? undefined,
          executeTakeFirstOrThrow: async () => {
            const row = state.rows.find((r) => (r as Record<string, unknown>)[col] === val);
            if (!row) throw new Error("no result");
            return row;
          },
        }),
        orderBy: (_col: string, _dir: string) => ({
          execute: async () => [...state.rows].sort((a, b) => (a.id as number) - (b.id as number)),
        }),
        execute: async () => [...state.rows].sort((a, b) => (a.id as number) - (b.id as number)),
      }),
      where: (col: string, _op: string, val: unknown) => ({
        select: (selectCol: string | ((eb: unknown) => unknown)) => {
          // Handle both string column and expression builder function
          if (typeof selectCol === "function") {
            // Count query
            return {
              executeTakeFirst: async () => {
                const count = state.rows.filter((r) => (r as Record<string, unknown>)[col] === val).length;
                return { count };
              },
            };
          }
          return {
            executeTakeFirst: async () => {
              const row = state.rows.find((r) => (r as Record<string, unknown>)[col] === val);
              return row ? { [selectCol]: (row as Record<string, unknown>)[selectCol] } : undefined;
            },
          };
        },
      }),
      select: (selectArg: string | ((eb: unknown) => unknown)) => {
        // Handle count query without where clause
        if (typeof selectArg === "function") {
          return {
            executeTakeFirst: async () => {
              return { count: state.rows.length };
            },
          };
        }
        return {
          executeTakeFirst: async () => {
            return state.rows.length > 0
              ? { [selectArg]: state.rows[0][selectArg as keyof VideoMetadataRecord] }
              : undefined;
          },
        };
      },
    }),
    updateTable: () => ({
      set: (v: Record<string, unknown>) => ({
        where: (_col: string, _op: string, id: unknown) => {
          const applyUpdate = () => {
            const idx = state.rows.findIndex((r) => r.id === id);
            if (idx < 0) return;
            const now = Date.now();
            state.rows[idx] = {
              ...state.rows[idx],
              ...(v as Partial<VideoMetadataRecord>),
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

describe("VideoMetadataProvider", () => {
  let provider: VideoMetadataProvider;
  let db: DatabaseInstance;

  beforeEach(() => {
    db = createFakeDb();
    provider = new VideoMetadataProvider(db);
  });

  describe("insertVideoMetadata", () => {
    test("inserts new video metadata and returns parsed VideoMetadata", async () => {
      const result = await provider.insertVideoMetadata({
        mediaFileId: 1,
        width: 1920,
        height: 1080,
        duration: 120.5,
      });

      expect(result.id).toBeGreaterThan(0);
      expect(result.mediaFileId).toBe(1);
      expect(result.width).toBe(1920);
      expect(result.height).toBe(1080);
      expect(result.duration).toBe(120.5);
      expect(result.frameRate).toBeNull();
      expect(result.codec).toBeNull();
      expect(result.audioCodec).toBeNull();
      expect(result.bitrate).toBeNull();
      expect(result.dateTaken).toBeNull();
      expect(result.createdAt).toBeInstanceOf(Date);
      expect(result.updatedAt).toBeInstanceOf(Date);
    });

    test("inserts video metadata with all optional fields", async () => {
      const dateTaken = new Date("2024-01-15T10:30:00Z");
      const result = await provider.insertVideoMetadata({
        mediaFileId: 2,
        width: 3840,
        height: 2160,
        duration: 300,
        frameRate: 60,
        codec: "h264",
        audioCodec: "aac",
        bitrate: 15000000,
        dateTaken,
      });

      expect(result.mediaFileId).toBe(2);
      expect(result.width).toBe(3840);
      expect(result.height).toBe(2160);
      expect(result.duration).toBe(300);
      expect(result.frameRate).toBe(60);
      expect(result.codec).toBe("h264");
      expect(result.audioCodec).toBe("aac");
      expect(result.bitrate).toBe(15000000);
      expect(result.dateTaken).toBeInstanceOf(Date);
      expect(result.dateTaken?.getTime()).toBe(dateTaken.getTime());
    });

    test("rejects invalid mediaFileId", async () => {
      await expect(
        provider.insertVideoMetadata({
          mediaFileId: -1,
          width: 1920,
          height: 1080,
          duration: 120,
        }),
      ).rejects.toThrow();
    });

    test("rejects invalid width (zero)", async () => {
      await expect(
        provider.insertVideoMetadata({
          mediaFileId: 1,
          width: 0,
          height: 1080,
          duration: 120,
        }),
      ).rejects.toThrow();
    });

    test("rejects invalid height (negative)", async () => {
      await expect(
        provider.insertVideoMetadata({
          mediaFileId: 1,
          width: 1920,
          height: -1,
          duration: 120,
        }),
      ).rejects.toThrow();
    });

    test("rejects negative duration", async () => {
      await expect(
        provider.insertVideoMetadata({
          mediaFileId: 1,
          width: 1920,
          height: 1080,
          duration: -5,
        }),
      ).rejects.toThrow();
    });

    test("accepts zero duration", async () => {
      const result = await provider.insertVideoMetadata({
        mediaFileId: 1,
        width: 1920,
        height: 1080,
        duration: 0,
      });
      expect(result.duration).toBe(0);
    });

    test("rejects duplicate mediaFileId (unique constraint)", async () => {
      await provider.insertVideoMetadata({
        mediaFileId: 1,
        width: 1920,
        height: 1080,
        duration: 120,
      });
      await expect(
        provider.insertVideoMetadata({
          mediaFileId: 1,
          width: 1280,
          height: 720,
          duration: 60,
        }),
      ).rejects.toThrow();
    });
  });

  describe("getAllVideoMetadata", () => {
    test("returns empty array when no metadata exists", async () => {
      const results = await provider.getAllVideoMetadata();
      expect(results).toEqual([]);
    });

    test("returns all video metadata ordered by id asc", async () => {
      await provider.insertVideoMetadata({ mediaFileId: 3, width: 640, height: 480, duration: 30 });
      await provider.insertVideoMetadata({ mediaFileId: 1, width: 1920, height: 1080, duration: 120 });
      await provider.insertVideoMetadata({ mediaFileId: 2, width: 1280, height: 720, duration: 60 });

      const results = await provider.getAllVideoMetadata();
      expect(results).toHaveLength(3);
      expect(results[0].mediaFileId).toBe(3);
      expect(results[1].mediaFileId).toBe(1);
      expect(results[2].mediaFileId).toBe(2);
      expect(results[0].id).toBeLessThan(results[1].id);
      expect(results[1].id).toBeLessThan(results[2].id);
    });

    test("parses each row as VideoMetadata", async () => {
      await provider.insertVideoMetadata({
        mediaFileId: 1,
        width: 1920,
        height: 1080,
        duration: 120,
        codec: "hevc",
      });

      const results = await provider.getAllVideoMetadata();
      expect(results[0].id).toBeGreaterThan(0);
      expect(results[0].width).toBe(1920);
      expect(results[0].codec).toBe("hevc");
      expect(results[0].createdAt).toBeInstanceOf(Date);
    });
  });

  describe("getVideoMetadataById", () => {
    test("returns null when id does not exist", async () => {
      const result = await provider.getVideoMetadataById(999);
      expect(result).toBeNull();
    });

    test("returns video metadata when id exists", async () => {
      const inserted = await provider.insertVideoMetadata({
        mediaFileId: 1,
        width: 1920,
        height: 1080,
        duration: 120,
      });
      const result = await provider.getVideoMetadataById(inserted.id);

      expect(result).not.toBeNull();
      expect(result?.id).toBe(inserted.id);
      expect(result?.mediaFileId).toBe(1);
      expect(result?.width).toBe(1920);
    });
  });

  describe("getVideoMetadataByMediaFileId", () => {
    test("returns null when mediaFileId does not exist", async () => {
      const result = await provider.getVideoMetadataByMediaFileId(999);
      expect(result).toBeNull();
    });

    test("returns video metadata when mediaFileId exists", async () => {
      await provider.insertVideoMetadata({
        mediaFileId: 42,
        width: 1280,
        height: 720,
        duration: 60,
      });

      const result = await provider.getVideoMetadataByMediaFileId(42);
      expect(result).not.toBeNull();
      expect(result?.mediaFileId).toBe(42);
      expect(result?.width).toBe(1280);
      expect(result?.height).toBe(720);
    });
  });

  describe("hasMetadataForMediaFile", () => {
    test("returns false when no metadata exists for mediaFileId", async () => {
      const result = await provider.hasMetadataForMediaFile(999);
      expect(result).toBe(false);
    });

    test("returns true when metadata exists for mediaFileId", async () => {
      await provider.insertVideoMetadata({
        mediaFileId: 5,
        width: 1920,
        height: 1080,
        duration: 120,
      });

      const result = await provider.hasMetadataForMediaFile(5);
      expect(result).toBe(true);
    });

    test("returns false after metadata is deleted", async () => {
      const inserted = await provider.insertVideoMetadata({
        mediaFileId: 10,
        width: 1920,
        height: 1080,
        duration: 120,
      });

      expect(await provider.hasMetadataForMediaFile(10)).toBe(true);
      await provider.deleteVideoMetadata(inserted.id);
      expect(await provider.hasMetadataForMediaFile(10)).toBe(false);
    });
  });

  describe("getTotalCount", () => {
    test("returns 0 when no metadata exists", async () => {
      const count = await provider.getTotalCount();
      expect(count).toBe(0);
    });

    test("returns correct count of video metadata records", async () => {
      await provider.insertVideoMetadata({ mediaFileId: 1, width: 1920, height: 1080, duration: 120 });
      await provider.insertVideoMetadata({ mediaFileId: 2, width: 1280, height: 720, duration: 60 });
      await provider.insertVideoMetadata({ mediaFileId: 3, width: 640, height: 480, duration: 30 });

      const count = await provider.getTotalCount();
      expect(count).toBe(3);
    });

    test("updates count after deletion", async () => {
      const inserted = await provider.insertVideoMetadata({
        mediaFileId: 1,
        width: 1920,
        height: 1080,
        duration: 120,
      });
      await provider.insertVideoMetadata({ mediaFileId: 2, width: 1280, height: 720, duration: 60 });

      expect(await provider.getTotalCount()).toBe(2);
      await provider.deleteVideoMetadata(inserted.id);
      expect(await provider.getTotalCount()).toBe(1);
    });
  });

  describe("updateVideoMetadata", () => {
    test("updates fields for existing metadata", async () => {
      const inserted = await provider.insertVideoMetadata({
        mediaFileId: 1,
        width: 1920,
        height: 1080,
        duration: 120,
      });

      await provider.updateVideoMetadata({
        id: inserted.id,
        width: 3840,
        height: 2160,
        codec: "hevc",
      });

      const updated = await provider.getVideoMetadataById(inserted.id);
      expect(updated).not.toBeNull();
      expect(updated?.width).toBe(3840);
      expect(updated?.height).toBe(2160);
      expect(updated?.codec).toBe("hevc");
      expect(updated?.duration).toBe(120); // unchanged
    });

    test("partial update only changes provided fields", async () => {
      const inserted = await provider.insertVideoMetadata({
        mediaFileId: 1,
        width: 1920,
        height: 1080,
        duration: 120,
        codec: "h264",
        audioCodec: "aac",
      });

      await provider.updateVideoMetadata({
        id: inserted.id,
        width: 3840,
        height: 2160,
      });

      const updated = await provider.getVideoMetadataById(inserted.id);
      expect(updated).not.toBeNull();
      expect(updated?.width).toBe(3840);
      expect(updated?.height).toBe(2160);
      expect(updated?.duration).toBe(120); // unchanged
      expect(updated?.mediaFileId).toBe(1); // unchanged
    });

    test("throws when id does not exist", async () => {
      await expect(
        provider.updateVideoMetadata({
          id: 99999,
          width: 1280,
        }),
      ).rejects.toThrow();
    });

    test("updates updatedAt timestamp", async () => {
      const inserted = await provider.insertVideoMetadata({
        mediaFileId: 1,
        width: 1920,
        height: 1080,
        duration: 120,
      });
      const originalUpdatedAt = inserted.updatedAt;

      // Small delay to ensure different timestamp
      await new Promise((resolve) => setTimeout(resolve, 10));

      await provider.updateVideoMetadata({
        id: inserted.id,
        frameRate: 30,
      });

      const updated = await provider.getVideoMetadataById(inserted.id);
      expect(updated).not.toBeNull();
      expect(updated?.updatedAt.getTime()).toBeGreaterThanOrEqual(originalUpdatedAt.getTime());
    });
  });

  describe("deleteVideoMetadata", () => {
    test("removes video metadata by id", async () => {
      const inserted = await provider.insertVideoMetadata({
        mediaFileId: 1,
        width: 1920,
        height: 1080,
        duration: 120,
      });
      await provider.deleteVideoMetadata(inserted.id);

      const found = await provider.getVideoMetadataById(inserted.id);
      expect(found).toBeNull();
    });

    test("no-op when id does not exist", async () => {
      await expect(provider.deleteVideoMetadata(99999)).resolves.toBeUndefined();
    });

    test("only deletes the specified metadata", async () => {
      const first = await provider.insertVideoMetadata({
        mediaFileId: 1,
        width: 1920,
        height: 1080,
        duration: 120,
      });
      const second = await provider.insertVideoMetadata({
        mediaFileId: 2,
        width: 1280,
        height: 720,
        duration: 60,
      });

      await provider.deleteVideoMetadata(first.id);

      expect(await provider.getVideoMetadataById(first.id)).toBeNull();
      expect(await provider.getVideoMetadataById(second.id)).not.toBeNull();
    });
  });

  describe("deleteByMediaFileId", () => {
    test("removes video metadata by mediaFileId", async () => {
      await provider.insertVideoMetadata({
        mediaFileId: 42,
        width: 1920,
        height: 1080,
        duration: 120,
      });

      await provider.deleteByMediaFileId(42);

      const found = await provider.getVideoMetadataByMediaFileId(42);
      expect(found).toBeNull();
    });

    test("no-op when mediaFileId does not exist", async () => {
      await expect(provider.deleteByMediaFileId(99999)).resolves.toBeUndefined();
    });

    test("only deletes metadata for the specified mediaFileId", async () => {
      await provider.insertVideoMetadata({
        mediaFileId: 1,
        width: 1920,
        height: 1080,
        duration: 120,
      });
      await provider.insertVideoMetadata({
        mediaFileId: 2,
        width: 1280,
        height: 720,
        duration: 60,
      });

      await provider.deleteByMediaFileId(1);

      expect(await provider.getVideoMetadataByMediaFileId(1)).toBeNull();
      expect(await provider.getVideoMetadataByMediaFileId(2)).not.toBeNull();
    });
  });

  describe("transaction", () => {
    test("runs callback with VideoMetadataProvider over transaction", async () => {
      await provider.insertVideoMetadata({
        mediaFileId: 1,
        width: 1920,
        height: 1080,
        duration: 120,
      });

      const metadata = await provider.transaction(async (trx) => trx.getAllVideoMetadata());
      expect(metadata).toHaveLength(1);
      expect(metadata[0].mediaFileId).toBe(1);
    });

    test("commits changes made in transaction", async () => {
      await provider.transaction(async (trx) => {
        await trx.insertVideoMetadata({
          mediaFileId: 1,
          width: 1920,
          height: 1080,
          duration: 120,
        });
      });

      const metadata = await provider.getAllVideoMetadata();
      expect(metadata).toHaveLength(1);
      expect(metadata[0].mediaFileId).toBe(1);
    });

    test("rolls back on callback error", async () => {
      const inserted = await provider.insertVideoMetadata({
        mediaFileId: 1,
        width: 1920,
        height: 1080,
        duration: 120,
      });

      await expect(
        provider.transaction(async (trx) => {
          await trx.updateVideoMetadata({ id: inserted.id, width: 3840 });
          throw new Error("abort");
        }),
      ).rejects.toThrow("abort");

      const metadata = await provider.getVideoMetadataById(inserted.id);
      expect(metadata).not.toBeNull();
      expect(metadata?.width).toBe(1920); // rolled back
    });

    test("allows multiple operations in single transaction", async () => {
      await provider.transaction(async (trx) => {
        await trx.insertVideoMetadata({
          mediaFileId: 1,
          width: 1920,
          height: 1080,
          duration: 120,
        });
        await trx.insertVideoMetadata({
          mediaFileId: 2,
          width: 1280,
          height: 720,
          duration: 60,
        });
      });

      const metadata = await provider.getAllVideoMetadata();
      expect(metadata).toHaveLength(2);
    });

    test("rolls back all operations on error in transaction", async () => {
      await expect(
        provider.transaction(async (trx) => {
          await trx.insertVideoMetadata({
            mediaFileId: 1,
            width: 1920,
            height: 1080,
            duration: 120,
          });
          await trx.insertVideoMetadata({
            mediaFileId: 2,
            width: 1280,
            height: 720,
            duration: 60,
          });
          throw new Error("abort all");
        }),
      ).rejects.toThrow("abort all");

      const metadata = await provider.getAllVideoMetadata();
      expect(metadata).toHaveLength(0); // all rolled back
    });
  });

  describe("verifyRecordExists", () => {
    test("does not throw when record exists", async () => {
      const inserted = await provider.insertVideoMetadata({
        mediaFileId: 1,
        width: 1920,
        height: 1080,
        duration: 120,
      });

      await expect(provider.verifyRecordExists(inserted.id)).resolves.toBeUndefined();
    });

    test("throws when record does not exist", async () => {
      await expect(provider.verifyRecordExists(99999)).rejects.toThrow("No result");
    });
  });
});
