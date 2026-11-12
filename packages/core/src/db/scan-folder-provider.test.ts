import { beforeEach, describe, expect, test } from "bun:test";
import type { Generated } from "kysely";
import type { FolderStatus, ScanFolderRecord } from "../zod/scan-folder";
import { ScanFolderProvider } from "./scan-folder-provider";
import type { DatabaseInstance } from "./schema";

/**
 * In-memory fake implementing the minimal Kysely interface used by ScanFolderProvider.
 * Used because Bun's built-in SQLite driver with Kysely does not return INSERT/SELECT results reliably.
 */

function createFakeDb(shared?: { rows: ScanFolderRecord[]; nextId: number }): DatabaseInstance {
  const state = shared ?? { rows: [] as ScanFolderRecord[], nextId: 1 };

  const toRow = (v: Record<string, unknown>): ScanFolderRecord => {
    const id = state.nextId++;
    return {
      id: id as unknown as Generated<number>,
      path: String(v.path ?? ""),
      priority: Number(v.priority ?? 3),
      status: String(v.status ?? "added") as FolderStatus,
      scanSubdirectories: (v.scanSubdirectories === 0 ? 0 : 1) as 0 | 1,
      imageCount: Number(v.imageCount ?? 0),
      videoCount: Number(v.videoCount ?? 0),
      totalSize: Number(v.totalSize ?? 0),
      createdAt: v.createdAt instanceof Date ? v.createdAt.getTime() : Number(v.createdAt ?? Date.now()),
      updatedAt: v.updatedAt instanceof Date ? v.updatedAt.getTime() : Number(v.updatedAt ?? Date.now()),
    };
  };

  const db: DatabaseInstance = {
    insertInto: () => ({
      values: (v: Record<string, unknown>) => {
        const doInsert = () => {
          const path = String(v.path ?? "");
          if (state.rows.some((r) => r.path === path)) throw new Error("UNIQUE constraint failed: scan_folders.path");
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
        orderBy: (_col1: string, _dir1: string) => ({
          orderBy: (_col2: string, _dir2: string) => ({
            execute: async () => [...state.rows].sort((a, b) => a.priority - b.priority || a.createdAt - b.createdAt),
          }),
        }),
        execute: async () => [...state.rows].sort((a, b) => a.priority - b.priority || a.createdAt - b.createdAt),
      }),
      where: (col: string, _op: string, val: unknown) => ({
        select: (_col: string) => ({
          executeTakeFirst: async () => {
            const row = state.rows.find((r) => (r as Record<string, unknown>)[col] === val);
            return row ? { id: row.id } : undefined;
          },
        }),
      }),
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
              ...(v as Partial<ScanFolderRecord>),
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
      where: (_col: string, _op: string, id: unknown) => ({
        execute: async () => {
          const idx = state.rows.findIndex((r) => r.id === id);
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

describe("ScanFolderProvider", () => {
  let provider: ScanFolderProvider;
  let db: DatabaseInstance;

  beforeEach(() => {
    db = createFakeDb();
    provider = new ScanFolderProvider(db);
  });

  describe("insertScanFolder", () => {
    test("inserts a new scan folder and returns parsed ScanFolder", async () => {
      const result = await provider.insertScanFolder({ path: "/photos", priority: 1 });

      expect(result.id).toBeGreaterThan(0);
      expect(result.path).toBe("/photos");
      expect(result.priority).toBe(1);
      expect(result.status).toBe("added");
      expect(result.scanSubdirectories).toBe(true);
      expect(result.imageCount).toBe(0);
      expect(result.videoCount).toBe(0);
      expect(result.totalSize).toBe(0);
      expect(result.createdAt).toBeInstanceOf(Date);
      expect(result.updatedAt).toBeInstanceOf(Date);
    });

    test("applies NewScanFolder defaults when fields omitted", async () => {
      const result = await provider.insertScanFolder({ path: "/videos" });

      expect(result.path).toBe("/videos");
      expect(result.priority).toBe(3);
      expect(result.status).toBe("added");
      expect(result.scanSubdirectories).toBe(true);
    });

    test("rejects empty path", async () => {
      await expect(provider.insertScanFolder({ path: "" })).rejects.toThrow();
    });

    test("rejects duplicate path (unique constraint)", async () => {
      await provider.insertScanFolder({ path: "/unique/path" });
      await expect(provider.insertScanFolder({ path: "/unique/path" })).rejects.toThrow();
    });
  });

  describe("getAllScanFolders", () => {
    test("returns empty array when no folders", async () => {
      const results = await provider.getAllScanFolders();
      expect(results).toEqual([]);
    });

    test("returns all scan folders ordered by priority asc then createdAt asc", async () => {
      await provider.insertScanFolder({ path: "/low", priority: 5 });
      await provider.insertScanFolder({ path: "/high", priority: 1 });
      await provider.insertScanFolder({ path: "/mid", priority: 3 });

      const results = await provider.getAllScanFolders();
      expect(results).toHaveLength(3);
      expect(results[0].path).toBe("/high");
      expect(results[1].path).toBe("/mid");
      expect(results[2].path).toBe("/low");
    });

    test("parses each row as ScanFolder", async () => {
      await provider.insertScanFolder({ path: "/one" });
      const results = await provider.getAllScanFolders();
      expect(results[0].id).toBeGreaterThan(0);
      expect(results[0].path).toBe("/one");
      expect(results[0].createdAt).toBeInstanceOf(Date);
    });
  });

  describe("getScanFolderById", () => {
    test("returns null when id does not exist", async () => {
      const result = await provider.getScanFolderById(999);
      expect(result).toBeNull();
    });

    test("returns scan folder when id exists", async () => {
      const inserted = await provider.insertScanFolder({ path: "/by-id" });
      const result = await provider.getScanFolderById(inserted.id);
      expect(result).not.toBeNull();
      expect(result?.id).toBe(inserted.id);
      expect(result?.path).toBe("/by-id");
    });
  });

  describe("getScanFolderByPath", () => {
    test("returns null when path does not exist", async () => {
      const result = await provider.getScanFolderByPath("/nonexistent");
      expect(result).toBeNull();
    });

    test("returns scan folder when path exists", async () => {
      await provider.insertScanFolder({ path: "/exact/path" });
      const result = await provider.getScanFolderByPath("/exact/path");
      expect(result).not.toBeNull();
      expect(result?.path).toBe("/exact/path");
    });
  });

  describe("updateScanFolder", () => {
    test("updates fields (no return)", async () => {
      const inserted = await provider.insertScanFolder({ path: "/original", priority: 3 });
      await provider.updateScanFolder({
        id: inserted.id,
        path: "/updated",
        priority: 1,
        status: "scanning",
      });

      const updated = await provider.getScanFolderById(inserted.id);
      expect(updated).not.toBeNull();
      expect(updated?.path).toBe("/updated");
      expect(updated?.priority).toBe(1);
      expect(updated?.status).toBe("scanning");
    });

    test("partial update only changes provided fields", async () => {
      const inserted = await provider.insertScanFolder({ path: "/partial", priority: 2, status: "added" });
      await provider.updateScanFolder({ id: inserted.id, status: "ready" });

      const updated = await provider.getScanFolderById(inserted.id);
      expect(updated).not.toBeNull();
      expect(updated?.path).toBe("/partial");
      expect(updated?.status).toBe("ready");
      expect(updated?.priority).toBeGreaterThanOrEqual(1);
      expect(updated?.priority).toBeLessThanOrEqual(5);
    });

    test("throws when id does not exist", async () => {
      await expect(provider.updateScanFolder({ id: 99999, path: "/nonexistent" })).rejects.toThrow();
    });
  });

  describe("deleteScanFolder", () => {
    test("removes scan folder by id", async () => {
      const inserted = await provider.insertScanFolder({ path: "/to-delete" });
      await provider.deleteScanFolder(inserted.id);

      const found = await provider.getScanFolderById(inserted.id);
      expect(found).toBeNull();
    });

    test("no-op when id does not exist", async () => {
      await expect(provider.deleteScanFolder(99999)).resolves.toBeUndefined();
    });
  });

  describe("transaction", () => {
    test("runs callback with ScanFolderProvider over transaction", async () => {
      await provider.insertScanFolder({ path: "/in-tx" });
      const folders = await provider.transaction(async (trx) => trx.getAllScanFolders());
      expect(folders).toHaveLength(1);
      expect(folders[0].path).toBe("/in-tx");
    });

    test("rolls back on callback error", async () => {
      const inserted = await provider.insertScanFolder({ path: "/rollback-me", status: "added" });
      await expect(
        provider.transaction(async (trx) => {
          await trx.updateScanFolder({ id: inserted.id, status: "scanning" });
          throw new Error("abort");
        }),
      ).rejects.toThrow("abort");

      const folder = await provider.getScanFolderById(inserted.id);
      expect(folder).not.toBeNull();
      expect(folder?.status).toBe("added");
    });
  });
});
