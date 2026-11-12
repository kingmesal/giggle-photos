import { beforeEach, describe, expect, test } from "bun:test";
import type { Generated } from "kysely";
import type { PhashMatchRecord } from "../zod/phash-match";
import { PhashMatchProvider } from "./phash-match-provider";
import type { DatabaseInstance } from "./schema";

/**
 * In-memory fake implementing the minimal Kysely interface used by PhashMatchProvider.
 */

function createFakeDb(shared?: { rows: PhashMatchRecord[]; nextId: number; timeOffset: number }): DatabaseInstance {
  const state = shared ?? { rows: [] as PhashMatchRecord[], nextId: 1, timeOffset: 0 };

  const toRow = (v: Record<string, unknown>): PhashMatchRecord => {
    const id = state.nextId++;
    state.timeOffset += 1000;
    return {
      id: id as unknown as Generated<number>,
      mediaFileId1: Number(v.mediaFileId1),
      mediaFileId2: Number(v.mediaFileId2),
      distance: Number(v.distance),
      createdAt: state.timeOffset,
    };
  };

  const db: DatabaseInstance = {
    insertInto: () => ({
      values: (v: Record<string, unknown> | Record<string, unknown>[]) => {
        if (Array.isArray(v)) {
          // Batch insert
          const doInsert = () => {
            const rows: PhashMatchRecord[] = [];
            for (const item of v) {
              const row = toRow(item);
              state.rows.push(row);
              rows.push(row);
            }
            return rows;
          };
          return {
            execute: async () => {
              doInsert();
            },
            returningAll: () => ({
              executeTakeFirst: async () => {
                const rows = doInsert();
                return rows[0];
              },
            }),
          };
        }
        // Single insert
        const doInsert = () => {
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
        where: (colOrCb: string | ((eb: ExpressionBuilder) => unknown), _op?: string, val?: unknown) => {
          if (typeof colOrCb === "function") {
            // Expression builder callback form
            return {
              orderBy: (_col: string, _dir: string) => ({
                execute: async () => {
                  const eb = createExpressionBuilder();
                  colOrCb(eb);
                  const matchingRows = state.rows.filter((row) => eb._evaluate(row));
                  return [...matchingRows].sort((a, b) => a.distance - b.distance);
                },
              }),
              execute: async () => {
                const eb = createExpressionBuilder();
                colOrCb(eb);
                return state.rows.filter((row) => eb._evaluate(row));
              },
            };
          }
          // Simple column form - handle chained where
          const col = colOrCb;
          return {
            where: (col2: string, _op2: string, val2: unknown) => ({
              executeTakeFirst: async () =>
                state.rows.find(
                  (r) => (r as Record<string, unknown>)[col] === val && (r as Record<string, unknown>)[col2] === val2,
                ) ?? undefined,
              orderBy: (_orderCol: string, _dir: string) => ({
                execute: async () => {
                  return state.rows.filter(
                    (r) => (r as Record<string, unknown>)[col] === val && (r as Record<string, unknown>)[col2] === val2,
                  );
                },
              }),
            }),
            executeTakeFirst: async () =>
              state.rows.find((r) => (r as Record<string, unknown>)[col] === val) ?? undefined,
            executeTakeFirstOrThrow: async () => {
              const row = state.rows.find((r) => (r as Record<string, unknown>)[col] === val);
              if (!row) throw new Error("no result");
              return row;
            },
            orderBy: (_orderCol: string, _dir: string) => ({
              execute: async () => {
                const filtered = state.rows.filter((r) => {
                  if (_op === "<=") {
                    return (
                      (r as Record<string, unknown>)[col] !== undefined &&
                      Number((r as Record<string, unknown>)[col]) <= Number(val)
                    );
                  }
                  return (r as Record<string, unknown>)[col] === val;
                });
                return [...filtered].sort((a, b) => a.distance - b.distance);
              },
            }),
          };
        },
        orderBy: (_col: string, _dir: string) => ({
          execute: async () => [...state.rows].sort((a, b) => a.distance - b.distance),
        }),
        execute: async () => [...state.rows],
      }),
      select: (colOrCb: string | string[] | ((eb: ExpressionBuilder) => unknown)) => {
        if (typeof colOrCb === "function") {
          // This is the count case
          return {
            executeTakeFirst: async () => ({ count: state.rows.length }),
          };
        }
        if (Array.isArray(colOrCb) && colOrCb.includes("mediaFileId1") && colOrCb.includes("mediaFileId2")) {
          // getAllPairKeys
          return {
            execute: async () => {
              return state.rows.map((r) => ({
                mediaFileId1: r.mediaFileId1,
                mediaFileId2: r.mediaFileId2,
              }));
            },
          };
        }
        // Simple column select - used by hasMatch (chained where)
        return {
          where: (whereCol: string | ((eb: ExpressionBuilder) => unknown), _whereOp?: string, whereVal?: unknown) => {
            if (typeof whereCol === "function") {
              return {
                executeTakeFirst: async () => {
                  const eb = createExpressionBuilder();
                  whereCol(eb);
                  const row = state.rows.find((r) => eb._evaluate(r));
                  return row ? { id: row.id } : undefined;
                },
              };
            }
            // Build filter chain for chained .where().where()
            const filters: Array<{ col: string; op: string; val: unknown }> = [
              { col: whereCol, op: _whereOp ?? "=", val: whereVal },
            ];
            const chainResult: Record<string, unknown> = {
              where: (col2: string, op2: string, val2: unknown) => {
                filters.push({ col: col2, op: op2, val: val2 });
                return chainResult;
              },
              executeTakeFirst: async () => {
                const row = state.rows.find((r) =>
                  filters.every((f) => (r as Record<string, unknown>)[f.col] === f.val),
                );
                return row ? { id: row.id } : undefined;
              },
            };
            return chainResult;
          },
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
              ...(v as Partial<PhashMatchRecord>),
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
      where: (colOrCb: string | ((eb: ExpressionBuilder) => unknown), _op?: string, id?: unknown) => {
        if (typeof colOrCb === "function") {
          return {
            execute: async () => {
              const eb = createExpressionBuilder();
              colOrCb(eb);
              const indicesToRemove: number[] = [];
              state.rows.forEach((row, idx) => {
                if (eb._evaluate(row)) {
                  indicesToRemove.push(idx);
                }
              });
              for (let i = indicesToRemove.length - 1; i >= 0; i--) {
                state.rows.splice(indicesToRemove[i], 1);
              }
              return indicesToRemove.map(() => ({}));
            },
          };
        }
        return {
          execute: async () => {
            const idx = state.rows.findIndex((r) => r.id === id);
            if (idx >= 0) state.rows.splice(idx, 1);
          },
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

interface ExpressionBuilder {
  or: (conditions: unknown[]) => unknown;
  and: (conditions: unknown[]) => unknown;
  (col: string, op: string, val: unknown): unknown;
  _evaluate: (row: PhashMatchRecord) => boolean;
  _conditions: Array<{ type: "or" | "and"; conditions: unknown[] }>;
}

function createExpressionBuilder(): ExpressionBuilder {
  const eb: ExpressionBuilder = ((col: string, op: string, val: unknown) => {
    return { col, op, val };
  }) as ExpressionBuilder;

  eb._conditions = [];

  eb.or = (conditions: unknown[]) => {
    eb._conditions.push({ type: "or", conditions });
    return { or: conditions };
  };

  eb.and = (conditions: unknown[]) => {
    return { and: conditions };
  };

  eb._evaluate = (row: PhashMatchRecord): boolean => {
    for (const cond of eb._conditions) {
      if (cond.type === "or") {
        const orMatches = cond.conditions.some((c) => {
          const condition = c as { and?: unknown[] } | { col: string; op: string; val: unknown };
          if ("and" in condition && condition.and) {
            return condition.and.every((andCond) => {
              const { col, val } = andCond as { col: string; val: unknown };
              return (row as Record<string, unknown>)[col] === val;
            });
          }
          const { col, val } = condition as { col: string; val: unknown };
          return (row as Record<string, unknown>)[col] === val;
        });
        if (!orMatches) return false;
      }
    }
    return eb._conditions.length > 0;
  };

  return eb;
}

describe("PhashMatchProvider", () => {
  let provider: PhashMatchProvider;
  let db: DatabaseInstance;

  beforeEach(() => {
    db = createFakeDb();
    provider = new PhashMatchProvider(db);
  });

  describe("insertPhashMatch", () => {
    test("inserts a new pHash match and returns parsed PhashMatch", async () => {
      const result = await provider.insertPhashMatch({
        mediaFileId1: 1,
        mediaFileId2: 2,
        distance: 3,
      });

      expect(result.id).toBeGreaterThan(0);
      expect(result.mediaFileId1).toBe(1);
      expect(result.mediaFileId2).toBe(2);
      expect(result.distance).toBe(3);
      expect(result.createdAt).toBeInstanceOf(Date);
    });

    test("normalizes ordering so mediaFileId1 < mediaFileId2", async () => {
      const result = await provider.insertPhashMatch({
        mediaFileId1: 20,
        mediaFileId2: 10,
        distance: 5,
      });

      expect(result.mediaFileId1).toBe(10);
      expect(result.mediaFileId2).toBe(20);
    });

    test("accepts distance 0", async () => {
      const result = await provider.insertPhashMatch({
        mediaFileId1: 1,
        mediaFileId2: 2,
        distance: 0,
      });

      expect(result.distance).toBe(0);
    });

    test("accepts distance 64", async () => {
      const result = await provider.insertPhashMatch({
        mediaFileId1: 1,
        mediaFileId2: 2,
        distance: 64,
      });

      expect(result.distance).toBe(64);
    });

    test("rejects invalid mediaFileId1 (non-positive)", async () => {
      await expect(
        provider.insertPhashMatch({
          mediaFileId1: 0,
          mediaFileId2: 2,
          distance: 3,
        }),
      ).rejects.toThrow();
    });

    test("rejects invalid mediaFileId2 (negative)", async () => {
      await expect(
        provider.insertPhashMatch({
          mediaFileId1: 1,
          mediaFileId2: -1,
          distance: 3,
        }),
      ).rejects.toThrow();
    });

    test("rejects invalid distance (out of range)", async () => {
      await expect(
        provider.insertPhashMatch({
          mediaFileId1: 1,
          mediaFileId2: 2,
          distance: 65,
        }),
      ).rejects.toThrow();

      await expect(
        provider.insertPhashMatch({
          mediaFileId1: 1,
          mediaFileId2: 2,
          distance: -1,
        }),
      ).rejects.toThrow();
    });
  });

  describe("insertPhashMatches (batch)", () => {
    test("inserts multiple matches at once", async () => {
      const count = await provider.insertPhashMatches([
        { mediaFileId1: 1, mediaFileId2: 2, distance: 3 },
        { mediaFileId1: 1, mediaFileId2: 3, distance: 5 },
        { mediaFileId1: 2, mediaFileId2: 3, distance: 4 },
      ]);

      expect(count).toBe(3);
      const total = await provider.getTotalCount();
      expect(total).toBe(3);
    });

    test("returns 0 for empty array", async () => {
      const count = await provider.insertPhashMatches([]);
      expect(count).toBe(0);
    });

    test("normalizes ordering in batch", async () => {
      await provider.insertPhashMatches([{ mediaFileId1: 20, mediaFileId2: 10, distance: 5 }]);

      const matches = await provider.getMatchesForFile(10);
      expect(matches).toHaveLength(1);
      expect(matches[0].mediaFileId1).toBe(10);
      expect(matches[0].mediaFileId2).toBe(20);
    });
  });

  describe("getMatchesForFile", () => {
    test("returns empty array when no matches for file", async () => {
      const results = await provider.getMatchesForFile(999);
      expect(results).toEqual([]);
    });

    test("returns matches where file is mediaFileId1", async () => {
      await provider.insertPhashMatch({ mediaFileId1: 1, mediaFileId2: 2, distance: 3 });
      await provider.insertPhashMatch({ mediaFileId1: 1, mediaFileId2: 3, distance: 5 });
      await provider.insertPhashMatch({ mediaFileId1: 4, mediaFileId2: 5, distance: 2 });

      const results = await provider.getMatchesForFile(1);
      expect(results).toHaveLength(2);
      expect(results.every((r) => r.mediaFileId1 === 1 || r.mediaFileId2 === 1)).toBe(true);
    });

    test("returns matches where file is mediaFileId2", async () => {
      await provider.insertPhashMatch({ mediaFileId1: 1, mediaFileId2: 10, distance: 3 });
      await provider.insertPhashMatch({ mediaFileId1: 2, mediaFileId2: 10, distance: 5 });
      await provider.insertPhashMatch({ mediaFileId1: 3, mediaFileId2: 4, distance: 2 });

      const results = await provider.getMatchesForFile(10);
      expect(results).toHaveLength(2);
      expect(results.every((r) => r.mediaFileId1 === 10 || r.mediaFileId2 === 10)).toBe(true);
    });
  });

  describe("getMatchesByThreshold", () => {
    test("returns only matches within threshold", async () => {
      await provider.insertPhashMatch({ mediaFileId1: 1, mediaFileId2: 2, distance: 2 });
      await provider.insertPhashMatch({ mediaFileId1: 3, mediaFileId2: 4, distance: 5 });
      await provider.insertPhashMatch({ mediaFileId1: 5, mediaFileId2: 6, distance: 10 });

      const results = await provider.getMatchesByThreshold(5);
      expect(results).toHaveLength(2);
      expect(results.every((r) => r.distance <= 5)).toBe(true);
    });

    test("returns empty when no matches within threshold", async () => {
      await provider.insertPhashMatch({ mediaFileId1: 1, mediaFileId2: 2, distance: 10 });

      const results = await provider.getMatchesByThreshold(5);
      expect(results).toHaveLength(0);
    });
  });

  describe("hasMatch", () => {
    test("returns false when no match exists", async () => {
      const result = await provider.hasMatch(1, 2);
      expect(result).toBe(false);
    });

    test("returns true when match exists", async () => {
      await provider.insertPhashMatch({ mediaFileId1: 1, mediaFileId2: 2, distance: 3 });
      const result = await provider.hasMatch(1, 2);
      expect(result).toBe(true);
    });

    test("returns true when queried in reverse order", async () => {
      await provider.insertPhashMatch({ mediaFileId1: 1, mediaFileId2: 2, distance: 3 });
      const result = await provider.hasMatch(2, 1);
      expect(result).toBe(true);
    });

    test("returns false for different pair", async () => {
      await provider.insertPhashMatch({ mediaFileId1: 1, mediaFileId2: 2, distance: 3 });
      const result = await provider.hasMatch(1, 3);
      expect(result).toBe(false);
    });
  });

  describe("getMatchForPair", () => {
    test("returns null when no match exists", async () => {
      const result = await provider.getMatchForPair(1, 2);
      expect(result).toBeNull();
    });

    test("returns match when exists", async () => {
      await provider.insertPhashMatch({ mediaFileId1: 1, mediaFileId2: 2, distance: 3 });
      const result = await provider.getMatchForPair(1, 2);
      expect(result).not.toBeNull();
      expect(result?.mediaFileId1).toBe(1);
      expect(result?.mediaFileId2).toBe(2);
      expect(result?.distance).toBe(3);
    });

    test("returns match when queried in reverse order", async () => {
      await provider.insertPhashMatch({ mediaFileId1: 1, mediaFileId2: 2, distance: 3 });
      const result = await provider.getMatchForPair(2, 1);
      expect(result).not.toBeNull();
      expect(result?.mediaFileId1).toBe(1);
      expect(result?.mediaFileId2).toBe(2);
    });
  });

  describe("getAllPairKeys", () => {
    test("returns empty set when no matches", async () => {
      const keys = await provider.getAllPairKeys();
      expect(keys.size).toBe(0);
    });

    test("returns set of pair keys", async () => {
      await provider.insertPhashMatch({ mediaFileId1: 1, mediaFileId2: 2, distance: 3 });
      await provider.insertPhashMatch({ mediaFileId1: 3, mediaFileId2: 4, distance: 5 });

      const keys = await provider.getAllPairKeys();
      expect(keys.size).toBe(2);
      expect(keys.has("1:2")).toBe(true);
      expect(keys.has("3:4")).toBe(true);
    });
  });

  describe("deleteAll", () => {
    test("removes all matches", async () => {
      await provider.insertPhashMatch({ mediaFileId1: 1, mediaFileId2: 2, distance: 3 });
      await provider.insertPhashMatch({ mediaFileId1: 3, mediaFileId2: 4, distance: 5 });

      await provider.deleteAll();

      const count = await provider.getTotalCount();
      expect(count).toBe(0);
    });
  });

  describe("deleteByMediaFileId", () => {
    test("returns 0 when no matches for file", async () => {
      const count = await provider.deleteByMediaFileId(999);
      expect(count).toBe(0);
    });

    test("deletes matches where file is mediaFileId1", async () => {
      await provider.insertPhashMatch({ mediaFileId1: 1, mediaFileId2: 2, distance: 3 });
      await provider.insertPhashMatch({ mediaFileId1: 1, mediaFileId2: 3, distance: 5 });
      await provider.insertPhashMatch({ mediaFileId1: 4, mediaFileId2: 5, distance: 2 });

      const count = await provider.deleteByMediaFileId(1);
      expect(count).toBe(2);

      const remaining = await provider.getTotalCount();
      expect(remaining).toBe(1);
    });

    test("deletes matches where file is mediaFileId2", async () => {
      await provider.insertPhashMatch({ mediaFileId1: 1, mediaFileId2: 10, distance: 3 });
      await provider.insertPhashMatch({ mediaFileId1: 2, mediaFileId2: 10, distance: 5 });
      await provider.insertPhashMatch({ mediaFileId1: 3, mediaFileId2: 4, distance: 2 });

      const count = await provider.deleteByMediaFileId(10);
      expect(count).toBe(2);

      const remaining = await provider.getTotalCount();
      expect(remaining).toBe(1);
    });

    test("deletes matches where file appears in either position", async () => {
      await provider.insertPhashMatch({ mediaFileId1: 5, mediaFileId2: 10, distance: 3 });
      await provider.insertPhashMatch({ mediaFileId1: 10, mediaFileId2: 20, distance: 5 });
      await provider.insertPhashMatch({ mediaFileId1: 30, mediaFileId2: 40, distance: 2 });

      const count = await provider.deleteByMediaFileId(10);
      expect(count).toBe(2);

      const remaining = await provider.getTotalCount();
      expect(remaining).toBe(1);
    });
  });

  describe("getTotalCount", () => {
    test("returns 0 when no matches", async () => {
      const count = await provider.getTotalCount();
      expect(count).toBe(0);
    });

    test("returns correct count", async () => {
      await provider.insertPhashMatch({ mediaFileId1: 1, mediaFileId2: 2, distance: 3 });
      await provider.insertPhashMatch({ mediaFileId1: 3, mediaFileId2: 4, distance: 5 });
      await provider.insertPhashMatch({ mediaFileId1: 5, mediaFileId2: 6, distance: 2 });

      const count = await provider.getTotalCount();
      expect(count).toBe(3);
    });
  });

  describe("transaction", () => {
    test("runs callback with PhashMatchProvider over transaction", async () => {
      await provider.insertPhashMatch({ mediaFileId1: 1, mediaFileId2: 2, distance: 3 });
      const matches = await provider.transaction(async (trx) => trx.getMatchesForFile(1));
      expect(matches).toHaveLength(1);
      expect(matches[0].mediaFileId1).toBe(1);
    });

    test("rolls back on callback error", async () => {
      const inserted = await provider.insertPhashMatch({
        mediaFileId1: 1,
        mediaFileId2: 2,
        distance: 3,
      });

      await expect(
        provider.transaction(async (trx) => {
          await trx.updatePhashMatch({ id: inserted.id, distance: 10 });
          throw new Error("abort");
        }),
      ).rejects.toThrow("abort");

      const match = await provider.getMatchForPair(1, 2);
      expect(match).not.toBeNull();
      expect(match?.distance).toBe(3); // Should not have changed
    });

    test("commits changes when callback succeeds", async () => {
      const inserted = await provider.insertPhashMatch({
        mediaFileId1: 1,
        mediaFileId2: 2,
        distance: 3,
      });

      await provider.transaction(async (trx) => {
        await trx.updatePhashMatch({ id: inserted.id, distance: 10 });
      });

      const match = await provider.getMatchForPair(1, 2);
      expect(match?.distance).toBe(10);
    });
  });

  describe("verifyRecordExists", () => {
    test("throws when record does not exist", async () => {
      await expect(provider.updatePhashMatch({ id: 99999, distance: 5 })).rejects.toThrow("No result");
    });

    test("does not throw when record exists", async () => {
      const inserted = await provider.insertPhashMatch({
        mediaFileId1: 1,
        mediaFileId2: 2,
        distance: 3,
      });

      await expect(provider.updatePhashMatch({ id: inserted.id, distance: 10 })).resolves.toBeUndefined();
    });
  });
});
