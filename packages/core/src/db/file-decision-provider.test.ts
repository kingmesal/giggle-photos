import { beforeEach, describe, expect, test } from "bun:test";
import type { Generated } from "kysely";
import type { FileDecisionAction, FileDecisionMethod, FileDecisionRecord } from "../zod/file-decision";
import { FileDecisionProvider } from "./file-decision-provider";
import type { DatabaseInstance } from "./schema";

/**
 * In-memory fake implementing the minimal Kysely interface used by FileDecisionProvider.
 */

function createFakeDb(shared?: { rows: FileDecisionRecord[]; nextId: number; timeOffset: number }): DatabaseInstance {
  const state = shared ?? { rows: [] as FileDecisionRecord[], nextId: 1, timeOffset: 0 };

  const toRow = (v: Record<string, unknown>): FileDecisionRecord => {
    const id = state.nextId++;
    state.timeOffset += 1000;
    return {
      id: id as unknown as Generated<number>,
      mediaFileId: Number(v.mediaFileId),
      action: String(v.action) as FileDecisionAction,
      method: String(v.method) as FileDecisionMethod,
      reviewGroupKey: String(v.reviewGroupKey),
      createdAt: state.timeOffset,
    };
  };

  const db: DatabaseInstance = {
    insertInto: () => ({
      values: (v: Record<string, unknown> | Record<string, unknown>[]) => {
        const doInsert = () => {
          if (Array.isArray(v)) {
            for (const item of v) {
              const row = toRow(item);
              state.rows.push(row);
            }
            return v.map(() => ({}));
          }
          const row = toRow(v);
          state.rows.push(row);
          return row;
        };
        return {
          execute: async () => doInsert(),
          returningAll: () => ({
            executeTakeFirst: async () => {
              if (Array.isArray(v)) {
                const row = toRow(v[0]);
                state.rows.push(row);
                return row;
              }
              const row = toRow(v);
              state.rows.push(row);
              return row;
            },
          }),
        };
      },
    }),
    selectFrom: () => ({
      selectAll: () => ({
        where: (col: string, _op?: string, val?: unknown) => {
          const getFiltered = () => state.rows.filter((r) => (r as Record<string, unknown>)[col] === val);
          return {
            executeTakeFirst: async () => getFiltered()[0] ?? undefined,
            where: (col2: string, _op2: string, val2: unknown) => ({
              executeTakeFirst: async () =>
                state.rows.find(
                  (r) => (r as Record<string, unknown>)[col] === val && (r as Record<string, unknown>)[col2] === val2,
                ) ?? undefined,
              execute: async () =>
                state.rows.filter(
                  (r) => (r as Record<string, unknown>)[col] === val && (r as Record<string, unknown>)[col2] === val2,
                ),
            }),
            orderBy: (_orderCol: string, _dir: string) => ({
              execute: async () => {
                const filtered = getFiltered();
                return [...filtered].sort((a, b) => b.createdAt - a.createdAt);
              },
            }),
          };
        },
        orderBy: (_col: string, _dir: string) => ({
          execute: async () => [...state.rows].sort((a, b) => b.createdAt - a.createdAt),
        }),
        execute: async () => [...state.rows],
      }),
      select: (colOrCb: string | string[] | ((eb: unknown) => unknown)) => {
        if (typeof colOrCb === "function") {
          // Count case: .select((eb) => eb.fn.count("id").as("count"))
          return {
            executeTakeFirst: async () => ({ count: state.rows.length }),
            where: (whereCol: string, _op: string, whereVal: unknown) => ({
              executeTakeFirst: async () => ({
                count: state.rows.filter((r) => (r as Record<string, unknown>)[whereCol] === whereVal).length,
              }),
            }),
            groupBy: (groupCol: string) => ({
              execute: async () => {
                const groups = new Map<string, number>();
                for (const row of state.rows) {
                  const key = String((row as Record<string, unknown>)[groupCol]);
                  groups.set(key, (groups.get(key) ?? 0) + 1);
                }
                return Array.from(groups.entries()).map(([action, count]) => ({
                  [groupCol]: action,
                  count,
                }));
              },
            }),
          };
        }
        if (Array.isArray(colOrCb)) {
          // Array column select: .select(["action"]) — supports chained .select() for count
          return {
            select: (cb: (eb: unknown) => unknown) => {
              if (typeof cb === "function") {
                // Chained count: .select(["action"]).select((eb) => eb.fn.count(...))
                return {
                  groupBy: (groupCol: string) => ({
                    execute: async () => {
                      const groups = new Map<string, number>();
                      for (const row of state.rows) {
                        const key = String((row as Record<string, unknown>)[groupCol]);
                        groups.set(key, (groups.get(key) ?? 0) + 1);
                      }
                      return Array.from(groups.entries()).map(([action, count]) => ({
                        [groupCol]: action,
                        count,
                      }));
                    },
                  }),
                };
              }
              return {};
            },
          };
        }
        // Simple string column select
        return {
          where: (whereCol: string, _op: string, whereVal: unknown) => ({
            where: (whereCol2: string, _op2: string, whereVal2: unknown) => ({
              executeTakeFirst: async () => {
                const row = state.rows.find(
                  (r) =>
                    (r as Record<string, unknown>)[whereCol] === whereVal &&
                    (r as Record<string, unknown>)[whereCol2] === whereVal2,
                );
                return row ? { id: row.id } : undefined;
              },
            }),
            execute: async () =>
              state.rows
                .filter((r) => (r as Record<string, unknown>)[whereCol] === whereVal)
                .map((r) => ({ [colOrCb]: (r as Record<string, unknown>)[colOrCb] })),
          }),
        };
      },
      where: (col: string, _op: string, val: unknown) => ({
        select: (_selCol: string) => ({
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
            state.rows[idx] = {
              ...state.rows[idx],
              ...(v as Partial<FileDecisionRecord>),
            };
          };
          return {
            execute: async () => applyUpdate(),
          };
        },
      }),
    }),
    deleteFrom: () => ({
      where: (col: string, _op?: string, val?: unknown) => {
        if (val === undefined) {
          // Second where clause chaining
          return {
            execute: async () => {
              // No-op for unsupported patterns
            },
          };
        }
        return {
          execute: async () => {
            // Delete ALL matching rows (not just the first)
            for (let i = state.rows.length - 1; i >= 0; i--) {
              if ((state.rows[i] as Record<string, unknown>)[col] === val) {
                state.rows.splice(i, 1);
              }
            }
          },
          where: (col2: string, _op2: string, val2: unknown) => ({
            execute: async () => {
              const indices: number[] = [];
              state.rows.forEach((r, idx) => {
                if ((r as Record<string, unknown>)[col] === val && (r as Record<string, unknown>)[col2] === val2) {
                  indices.push(idx);
                }
              });
              for (let i = indices.length - 1; i >= 0; i--) {
                state.rows.splice(indices[i], 1);
              }
            },
          }),
        };
      },
      execute: async () => {
        state.rows.length = 0;
      },
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

describe("FileDecisionProvider", () => {
  let provider: FileDecisionProvider;

  beforeEach(() => {
    const db = createFakeDb();
    provider = new FileDecisionProvider(db);
  });

  describe("insertFileDecision", () => {
    test("inserts a new file decision and returns parsed FileDecision", async () => {
      const result = await provider.insertFileDecision({
        mediaFileId: 1,
        action: "keep",
        method: "sha256",
        reviewGroupKey: "abc123",
      });

      expect(result.id).toBeGreaterThan(0);
      expect(result.mediaFileId).toBe(1);
      expect(result.action).toBe("keep");
      expect(result.method).toBe("sha256");
      expect(result.reviewGroupKey).toBe("abc123");
      expect(result.createdAt).toBeInstanceOf(Date);
    });

    test("inserts with delete action", async () => {
      const result = await provider.insertFileDecision({
        mediaFileId: 2,
        action: "delete",
        method: "content_hash",
        reviewGroupKey: "xyz789",
      });

      expect(result.action).toBe("delete");
      expect(result.method).toBe("content_hash");
    });

    test("rejects invalid mediaFileId (non-positive)", async () => {
      await expect(
        provider.insertFileDecision({
          mediaFileId: 0,
          action: "keep",
          method: "sha256",
          reviewGroupKey: "test",
        }),
      ).rejects.toThrow();
    });

    test("rejects invalid action", async () => {
      await expect(
        provider.insertFileDecision({
          mediaFileId: 1,
          action: "invalid" as FileDecisionAction,
          method: "sha256",
          reviewGroupKey: "test",
        }),
      ).rejects.toThrow();
    });

    test("rejects invalid method", async () => {
      await expect(
        provider.insertFileDecision({
          mediaFileId: 1,
          action: "keep",
          method: "invalid" as FileDecisionMethod,
          reviewGroupKey: "test",
        }),
      ).rejects.toThrow();
    });

    test("rejects empty reviewGroupKey", async () => {
      await expect(
        provider.insertFileDecision({
          mediaFileId: 1,
          action: "keep",
          method: "sha256",
          reviewGroupKey: "",
        }),
      ).rejects.toThrow();
    });
  });

  describe("insertFileDecisions (batch)", () => {
    test("returns 0 for empty array", async () => {
      const count = await provider.insertFileDecisions([]);
      expect(count).toBe(0);
    });

    test("inserts multiple decisions", async () => {
      const count = await provider.insertFileDecisions([
        { mediaFileId: 1, action: "keep", method: "sha256", reviewGroupKey: "hash1" },
        { mediaFileId: 2, action: "delete", method: "sha256", reviewGroupKey: "hash1" },
      ]);
      expect(count).toBeGreaterThan(0);
    });
  });

  describe("getDecisionsByMediaFileId", () => {
    test("returns empty array when no decisions for file", async () => {
      const results = await provider.getDecisionsByMediaFileId(999);
      expect(results).toEqual([]);
    });

    test("returns all decisions for a file", async () => {
      await provider.insertFileDecision({ mediaFileId: 1, action: "keep", method: "sha256", reviewGroupKey: "g1" });
      await provider.insertFileDecision({ mediaFileId: 1, action: "delete", method: "phash", reviewGroupKey: "g2" });
      await provider.insertFileDecision({ mediaFileId: 2, action: "keep", method: "sha256", reviewGroupKey: "g3" });

      const results = await provider.getDecisionsByMediaFileId(1);
      expect(results).toHaveLength(2);
      expect(results.every((r) => r.mediaFileId === 1)).toBe(true);
    });
  });

  describe("getDecisionByMediaFileIdAndGroupKey", () => {
    test("returns null when no decision exists", async () => {
      const result = await provider.getDecisionByMediaFileIdAndGroupKey(1, "nonexistent");
      expect(result).toBeNull();
    });

    test("returns the decision when it exists", async () => {
      await provider.insertFileDecision({ mediaFileId: 1, action: "keep", method: "sha256", reviewGroupKey: "hash1" });
      const result = await provider.getDecisionByMediaFileIdAndGroupKey(1, "hash1");
      expect(result).not.toBeNull();
      expect(result?.action).toBe("keep");
    });
  });

  describe("getDecisionsByAction", () => {
    test("returns empty array when no decisions with action", async () => {
      const results = await provider.getDecisionsByAction("delete");
      expect(results).toEqual([]);
    });

    test("returns only decisions with specified action", async () => {
      await provider.insertFileDecision({ mediaFileId: 1, action: "keep", method: "sha256", reviewGroupKey: "g1" });
      await provider.insertFileDecision({ mediaFileId: 2, action: "delete", method: "sha256", reviewGroupKey: "g1" });
      await provider.insertFileDecision({ mediaFileId: 3, action: "delete", method: "phash", reviewGroupKey: "g2" });

      const results = await provider.getDecisionsByAction("delete");
      expect(results).toHaveLength(2);
      expect(results.every((r) => r.action === "delete")).toBe(true);
    });
  });

  describe("getDecisionsByReviewGroupKey", () => {
    test("returns empty array when no decisions for group", async () => {
      const results = await provider.getDecisionsByReviewGroupKey("nonexistent");
      expect(results).toEqual([]);
    });

    test("returns decisions for the group", async () => {
      await provider.insertFileDecision({ mediaFileId: 1, action: "keep", method: "sha256", reviewGroupKey: "hash1" });
      await provider.insertFileDecision({
        mediaFileId: 2,
        action: "delete",
        method: "sha256",
        reviewGroupKey: "hash1",
      });
      await provider.insertFileDecision({ mediaFileId: 3, action: "keep", method: "sha256", reviewGroupKey: "hash2" });

      const results = await provider.getDecisionsByReviewGroupKey("hash1");
      expect(results).toHaveLength(2);
      expect(results.every((r) => r.reviewGroupKey === "hash1")).toBe(true);
    });
  });

  describe("getDeletedFileIds", () => {
    test("returns empty set when no delete decisions", async () => {
      const ids = await provider.getDeletedFileIds();
      expect(ids.size).toBe(0);
    });

    test("returns set of file IDs with delete action", async () => {
      await provider.insertFileDecision({ mediaFileId: 1, action: "keep", method: "sha256", reviewGroupKey: "g1" });
      await provider.insertFileDecision({ mediaFileId: 2, action: "delete", method: "sha256", reviewGroupKey: "g1" });
      await provider.insertFileDecision({ mediaFileId: 3, action: "delete", method: "phash", reviewGroupKey: "g2" });

      const ids = await provider.getDeletedFileIds();
      expect(ids.size).toBe(2);
      expect(ids.has(2)).toBe(true);
      expect(ids.has(3)).toBe(true);
      expect(ids.has(1)).toBe(false);
    });
  });

  describe("hasDecisionForFile", () => {
    test("returns false when no decision exists", async () => {
      const result = await provider.hasDecisionForFile(1, "hash1");
      expect(result).toBe(false);
    });

    test("returns true when decision exists", async () => {
      await provider.insertFileDecision({ mediaFileId: 1, action: "keep", method: "sha256", reviewGroupKey: "hash1" });
      const result = await provider.hasDecisionForFile(1, "hash1");
      expect(result).toBe(true);
    });
  });

  describe("deleteByMediaFileIdAndGroupKey", () => {
    test("deletes specific decision", async () => {
      await provider.insertFileDecision({ mediaFileId: 1, action: "keep", method: "sha256", reviewGroupKey: "g1" });
      await provider.insertFileDecision({ mediaFileId: 1, action: "delete", method: "phash", reviewGroupKey: "g2" });

      await provider.deleteByMediaFileIdAndGroupKey(1, "g1");

      const remaining = await provider.getDecisionsByMediaFileId(1);
      expect(remaining).toHaveLength(1);
      expect(remaining[0].reviewGroupKey).toBe("g2");
    });
  });

  describe("deleteByMediaFileId", () => {
    test("returns 0 when no decisions for file", async () => {
      const count = await provider.deleteByMediaFileId(999);
      expect(count).toBe(0);
    });

    test("deletes all decisions for file", async () => {
      await provider.insertFileDecision({ mediaFileId: 1, action: "keep", method: "sha256", reviewGroupKey: "g1" });
      await provider.insertFileDecision({ mediaFileId: 1, action: "delete", method: "phash", reviewGroupKey: "g2" });
      await provider.insertFileDecision({ mediaFileId: 2, action: "keep", method: "sha256", reviewGroupKey: "g3" });

      await provider.deleteByMediaFileId(1);

      const remaining = await provider.getDecisionsByMediaFileId(1);
      expect(remaining).toHaveLength(0);

      const totalCount = await provider.getTotalCount();
      expect(totalCount).toBe(1);
    });
  });

  describe("deleteAll", () => {
    test("deletes all decisions", async () => {
      await provider.insertFileDecision({ mediaFileId: 1, action: "keep", method: "sha256", reviewGroupKey: "g1" });
      await provider.insertFileDecision({ mediaFileId: 2, action: "delete", method: "sha256", reviewGroupKey: "g1" });

      await provider.deleteAll();

      const count = await provider.getTotalCount();
      expect(count).toBe(0);
    });
  });

  describe("getCountByAction", () => {
    test("returns all zeros when no decisions", async () => {
      const counts = await provider.getCountByAction();
      expect(counts.keep).toBe(0);
      expect(counts.delete).toBe(0);
    });

    test("returns correct counts per action", async () => {
      await provider.insertFileDecision({ mediaFileId: 1, action: "keep", method: "sha256", reviewGroupKey: "g1" });
      await provider.insertFileDecision({ mediaFileId: 2, action: "delete", method: "sha256", reviewGroupKey: "g1" });
      await provider.insertFileDecision({ mediaFileId: 3, action: "delete", method: "sha256", reviewGroupKey: "g1" });

      const counts = await provider.getCountByAction();
      expect(counts.keep).toBe(1);
      expect(counts.delete).toBe(2);
    });
  });

  describe("getTotalCount", () => {
    test("returns 0 when no decisions", async () => {
      const count = await provider.getTotalCount();
      expect(count).toBe(0);
    });

    test("returns correct count", async () => {
      await provider.insertFileDecision({ mediaFileId: 1, action: "keep", method: "sha256", reviewGroupKey: "g1" });
      await provider.insertFileDecision({ mediaFileId: 2, action: "delete", method: "sha256", reviewGroupKey: "g1" });

      const count = await provider.getTotalCount();
      expect(count).toBe(2);
    });
  });

  describe("updateFileDecision", () => {
    test("updates action", async () => {
      const inserted = await provider.insertFileDecision({
        mediaFileId: 1,
        action: "keep",
        method: "sha256",
        reviewGroupKey: "g1",
      });

      await provider.updateFileDecision({ id: inserted.id, action: "delete" });

      const updated = await provider.getFileDecisionById(inserted.id);
      expect(updated?.action).toBe("delete");
    });

    test("throws when id does not exist", async () => {
      await expect(provider.updateFileDecision({ id: 99999, action: "delete" })).rejects.toThrow();
    });

    test("rejects invalid action on update", async () => {
      const inserted = await provider.insertFileDecision({
        mediaFileId: 1,
        action: "keep",
        method: "sha256",
        reviewGroupKey: "g1",
      });

      await expect(
        provider.updateFileDecision({ id: inserted.id, action: "invalid" as FileDecisionAction }),
      ).rejects.toThrow();
    });
  });

  describe("getDecisionsByMethod", () => {
    test("returns only decisions with specified method", async () => {
      await provider.insertFileDecision({ mediaFileId: 1, action: "keep", method: "sha256", reviewGroupKey: "g1" });
      await provider.insertFileDecision({ mediaFileId: 2, action: "delete", method: "phash", reviewGroupKey: "g2" });
      await provider.insertFileDecision({ mediaFileId: 3, action: "keep", method: "sha256", reviewGroupKey: "g3" });

      const results = await provider.getDecisionsByMethod("sha256");
      expect(results).toHaveLength(2);
      expect(results.every((r) => r.method === "sha256")).toBe(true);
    });
  });

  describe("transaction", () => {
    test("runs callback with FileDecisionProvider over transaction", async () => {
      await provider.insertFileDecision({ mediaFileId: 1, action: "keep", method: "sha256", reviewGroupKey: "g1" });
      const decisions = await provider.transaction(async (trx) => trx.getDecisionsByAction("keep"));
      expect(decisions).toHaveLength(1);
    });

    test("rolls back on callback error", async () => {
      const inserted = await provider.insertFileDecision({
        mediaFileId: 1,
        action: "keep",
        method: "sha256",
        reviewGroupKey: "g1",
      });

      await expect(
        provider.transaction(async (trx) => {
          await trx.updateFileDecision({ id: inserted.id, action: "delete" });
          throw new Error("abort");
        }),
      ).rejects.toThrow("abort");

      const decision = await provider.getFileDecisionById(inserted.id);
      expect(decision?.action).toBe("keep"); // Should not have changed
    });
  });
});
