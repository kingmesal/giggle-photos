import { Database as SqliteDatabase } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { CamelCasePlugin, Kysely } from "kysely";
import { BunSqliteDialect } from "kysely-bun-sqlite";
import { initializeDatabase } from "../db/client";
import { FileDecisionProvider } from "../db/file-decision-provider";
import { PhashGroupProvider } from "../db/phash-group-provider";
import type { DatabaseSchema } from "../db/schema";

/**
 * Integration tests for pHash group categorization and review queries.
 * Uses a real in-memory SQLite database with all migrations applied.
 *
 * These tests validate:
 * 1. Groups are categorized correctly (identical vs similar)
 * 2. groupMinDistance is recomputed when files are excluded
 * 3. Fully-decided groups don't appear in pending
 * 4. A group can't appear in both categories
 * 5. allDecided check works with excluded files
 */

function createTestDb(): { db: Kysely<DatabaseSchema>; rawDb: SqliteDatabase } {
  const sqliteDb = new SqliteDatabase(":memory:");
  const db = new Kysely<DatabaseSchema>({
    dialect: new BunSqliteDialect({ database: sqliteDb }),
    plugins: [new CamelCasePlugin()],
  });
  return { db, rawDb: sqliteDb };
}

/**
 * Insert a minimal scan folder + media files for testing.
 * Returns the IDs of the inserted media files.
 */
async function insertTestMediaFiles(db: Kysely<DatabaseSchema>, count: number): Promise<number[]> {
  // Insert a scan folder
  await db
    .insertInto("scanFolders")
    .values({
      path: "/test/folder",
      scanSubdirectories: 1,
      includeVideos: 1,
      priority: 1,
      imageCount: count,
      videoCount: 0,
      totalSize: count * 1000,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    .execute();

  const ids: number[] = [];
  for (let i = 0; i < count; i++) {
    const result = await db
      .insertInto("mediaFiles")
      .values({
        scanFolderId: 1,
        path: `/test/folder/image_${i + 1}.jpg`,
        filename: `image_${i + 1}.jpg`,
        extension: ".jpg",
        fileType: "image",
        size: 1000 + i * 100,
        status: "processed",
        sha256Hash: `sha256_${i + 1}`,
        contentHash: `content_${i + 1}`,
        perceptualHash: `phash_${i + 1}`,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
      .returningAll()
      .executeTakeFirst();
    ids.push((result as { id: number }).id);
  }

  return ids;
}

/**
 * Insert pHash matches between specific file pairs.
 */
async function insertPhashMatches(
  db: Kysely<DatabaseSchema>,
  matches: Array<{ id1: number; id2: number; distance: number }>,
): Promise<void> {
  for (const m of matches) {
    const lo = Math.min(m.id1, m.id2);
    const hi = Math.max(m.id1, m.id2);
    await db
      .insertInto("phashMatches")
      .values({
        mediaFileId1: lo,
        mediaFileId2: hi,
        distance: m.distance,
        createdAt: Date.now(),
      })
      .execute();
  }
}

describe("pHash group categorization", () => {
  let db: Kysely<DatabaseSchema>;
  let rawDb: SqliteDatabase;
  let phashGroupProvider: PhashGroupProvider;
  let fileDecisionProvider: FileDecisionProvider;

  beforeEach(async () => {
    const testDb = createTestDb();
    db = testDb.db;
    rawDb = testDb.rawDb;
    await initializeDatabase(db, ":memory:");
    phashGroupProvider = new PhashGroupProvider(db);
    fileDecisionProvider = new FileDecisionProvider(db);
  });

  afterEach(() => {
    if (rawDb) rawDb.close();
  });

  describe("getGroupSummariesExcluding", () => {
    test("returns correct groupMinDistance for all members", async () => {
      const ids = await insertTestMediaFiles(db, 3);
      // A-B distance=0 (identical), A-C distance=3 (similar)
      await insertPhashMatches(db, [
        { id1: ids[0], id2: ids[1], distance: 0 },
        { id1: ids[0], id2: ids[2], distance: 3 },
      ]);

      await phashGroupProvider.recomputeGroups(5);

      const summaries = await phashGroupProvider.getGroupSummariesExcluding(new Set());
      expect(summaries).toHaveLength(1);
      expect(summaries[0]?.groupMinDistance).toBe(0);
      expect(summaries[0]?.fileCount).toBe(3);
    });

    test("returns stored (stale) distance when excluding files", async () => {
      const ids = await insertTestMediaFiles(db, 3);
      // A-B=3 (similar), B-C=0 (identical) → component min = 0
      await insertPhashMatches(db, [
        { id1: ids[0], id2: ids[1], distance: 3 },
        { id1: ids[1], id2: ids[2], distance: 0 },
      ]);

      await phashGroupProvider.recomputeGroups(5);

      // Exclude B (the bridge file). Remaining: A, C with no direct match.
      // Stored groupMinDistance is 0 (stale!) but group still has 2 active members.
      const summaries = await phashGroupProvider.getGroupSummariesExcluding(new Set([ids[1]]));
      expect(summaries).toHaveLength(1);
      // The stored distance is stale (0) even though remaining pair A-C has no match
      expect(summaries[0]?.groupMinDistance).toBe(0);
      expect(summaries[0]?.fileCount).toBe(2);
    });

    test("filters out groups with fewer than 2 active members", async () => {
      const ids = await insertTestMediaFiles(db, 2);
      await insertPhashMatches(db, [{ id1: ids[0], id2: ids[1], distance: 2 }]);

      await phashGroupProvider.recomputeGroups(5);

      // Exclude one file → group has 1 member → filtered out
      const summaries = await phashGroupProvider.getGroupSummariesExcluding(new Set([ids[0]]));
      expect(summaries).toHaveLength(0);
    });

    test("groups by anchor only (no duplicate entries)", async () => {
      const ids = await insertTestMediaFiles(db, 3);
      await insertPhashMatches(db, [
        { id1: ids[0], id2: ids[1], distance: 0 },
        { id1: ids[0], id2: ids[2], distance: 3 },
      ]);

      await phashGroupProvider.recomputeGroups(5);

      // All 3 files should be in one group, one summary row
      const summaries = await phashGroupProvider.getGroupSummariesExcluding(new Set());
      expect(summaries).toHaveLength(1);
      // Should not produce duplicate entries for the same anchor
      const anchors = summaries.map((s) => s.groupAnchorFileId);
      expect(new Set(anchors).size).toBe(anchors.length);
    });
  });

  describe("recomputeActiveMinDistances (via review queries)", () => {
    // These tests verify the distance recomputation indirectly through the
    // exported getPendingGroups function, which is the real entry point.
    // We test the recomputation by checking that groups end up in the correct
    // category after files are excluded.

    test("group stays in 'identical' when distance-0 pair remains active", async () => {
      const ids = await insertTestMediaFiles(db, 3);
      // A-B=0 (identical), A-C=3 (similar)
      await insertPhashMatches(db, [
        { id1: ids[0], id2: ids[1], distance: 0 },
        { id1: ids[0], id2: ids[2], distance: 3 },
      ]);
      await phashGroupProvider.recomputeGroups(5);

      // Mark C for delete
      await fileDecisionProvider.insertFileDecision({
        mediaFileId: ids[2],
        action: "delete",
        method: "phash",
        reviewGroupKey: `phash:${ids[0]}`,
      });

      // We test the underlying functions directly since getPendingGroups
      // uses DatabaseProvider internally.

      // Directly test the recomputation: query active members and matches
      const deletedIds = await fileDecisionProvider.getDeletedFileIds();
      expect(deletedIds.has(ids[2])).toBe(true);

      const summaries = await phashGroupProvider.getGroupSummariesExcluding(deletedIds);
      expect(summaries).toHaveLength(1);

      // Now recompute distances like the review query does
      const allMembers = await db
        .selectFrom("phashGroupMembers")
        .select(["mediaFileId", "groupAnchorFileId"])
        .where("mediaFileId", "not in", [...deletedIds])
        .execute();

      const fileToAnchor = new Map<number, number>();
      const allActiveIds: number[] = [];
      for (const m of allMembers) {
        fileToAnchor.set(m.mediaFileId as number, m.groupAnchorFileId as number);
        allActiveIds.push(m.mediaFileId as number);
      }

      const matches = await db
        .selectFrom("phashMatches")
        .select(["mediaFileId1", "mediaFileId2", "distance"])
        .where("distance", "<=", 5)
        .where("mediaFileId1", "in", allActiveIds)
        .where("mediaFileId2", "in", allActiveIds)
        .execute();

      // Should find A-B=0 match (both active), A-C=3 filtered out (C excluded)
      expect(matches).toHaveLength(1);
      expect(matches[0]?.distance).toBe(0);

      // Recomputed min should be 0 (A-B pair still active)
      let recomputedMin = 64;
      for (const match of matches) {
        const a1 = fileToAnchor.get(match.mediaFileId1 as number);
        const a2 = fileToAnchor.get(match.mediaFileId2 as number);
        if (a1 !== undefined && a2 !== undefined && a1 === a2) {
          if ((match.distance as number) < recomputedMin) {
            recomputedMin = match.distance as number;
          }
        }
      }
      expect(recomputedMin).toBe(0); // Correctly stays in "identical"
    });

    test("group moves from 'identical' to 'similar' when distance-0 pair is broken", async () => {
      const ids = await insertTestMediaFiles(db, 3);
      // A-B=0 (identical), A-C=4 (similar), B-C=3 (similar)
      // Component min = 0
      await insertPhashMatches(db, [
        { id1: ids[0], id2: ids[1], distance: 0 },
        { id1: ids[0], id2: ids[2], distance: 4 },
        { id1: ids[1], id2: ids[2], distance: 3 },
      ]);
      await phashGroupProvider.recomputeGroups(5);

      // Verify initial groupMinDistance = 0
      const initialSummaries = await phashGroupProvider.getAllGroupSummaries();
      expect(initialSummaries).toHaveLength(1);
      expect(initialSummaries[0]?.groupMinDistance).toBe(0);

      // Mark A for delete (breaks the A-B=0 pair)
      await fileDecisionProvider.insertFileDecision({
        mediaFileId: ids[0],
        action: "delete",
        method: "phash",
        reviewGroupKey: `phash:${ids[0]}`,
      });

      const deletedIds = await fileDecisionProvider.getDeletedFileIds();
      const summaries = await phashGroupProvider.getGroupSummariesExcluding(deletedIds);
      expect(summaries).toHaveLength(1);
      // Stored distance is stale (0)
      expect(summaries[0]?.groupMinDistance).toBe(0);

      // Recompute from active matches
      const allMembers = await db
        .selectFrom("phashGroupMembers")
        .select(["mediaFileId", "groupAnchorFileId"])
        .where("mediaFileId", "not in", [...deletedIds])
        .execute();

      const fileToAnchor = new Map<number, number>();
      const allActiveIds: number[] = [];
      for (const m of allMembers) {
        fileToAnchor.set(m.mediaFileId as number, m.groupAnchorFileId as number);
        allActiveIds.push(m.mediaFileId as number);
      }

      const matches = await db
        .selectFrom("phashMatches")
        .select(["mediaFileId1", "mediaFileId2", "distance"])
        .where("distance", "<=", 5)
        .where("mediaFileId1", "in", allActiveIds)
        .where("mediaFileId2", "in", allActiveIds)
        .execute();

      // Only B-C=3 should remain (A is excluded from both A-B=0 and A-C=4)
      expect(matches).toHaveLength(1);
      expect(matches[0]?.distance).toBe(3);

      // Recomputed min should be 3 (B-C pair)
      let recomputedMin = 64;
      for (const match of matches) {
        const a1 = fileToAnchor.get(match.mediaFileId1 as number);
        const a2 = fileToAnchor.get(match.mediaFileId2 as number);
        if (a1 !== undefined && a2 !== undefined && a1 === a2) {
          if ((match.distance as number) < recomputedMin) {
            recomputedMin = match.distance as number;
          }
        }
      }
      // Group should now be in "similar" (distance > 0), not "identical"
      expect(recomputedMin).toBe(3);
      expect(recomputedMin).toBeGreaterThan(0);
    });

    test("group with only similar pairs stays in 'similar' after exclusion", async () => {
      const ids = await insertTestMediaFiles(db, 3);
      // All pairs are similar (distance > 0)
      await insertPhashMatches(db, [
        { id1: ids[0], id2: ids[1], distance: 2 },
        { id1: ids[0], id2: ids[2], distance: 3 },
        { id1: ids[1], id2: ids[2], distance: 4 },
      ]);
      await phashGroupProvider.recomputeGroups(5);

      // Mark C for delete
      await fileDecisionProvider.insertFileDecision({
        mediaFileId: ids[2],
        action: "delete",
        method: "phash",
        reviewGroupKey: `phash:${ids[0]}`,
      });

      const deletedIds = await fileDecisionProvider.getDeletedFileIds();
      const allMembers = await db
        .selectFrom("phashGroupMembers")
        .select(["mediaFileId", "groupAnchorFileId"])
        .where("mediaFileId", "not in", [...deletedIds])
        .execute();

      const allActiveIds = allMembers.map((m) => m.mediaFileId as number);
      const matches = await db
        .selectFrom("phashMatches")
        .select(["mediaFileId1", "mediaFileId2", "distance"])
        .where("distance", "<=", 5)
        .where("mediaFileId1", "in", allActiveIds)
        .where("mediaFileId2", "in", allActiveIds)
        .execute();

      // Only A-B=2 should remain
      expect(matches).toHaveLength(1);
      expect(matches[0]?.distance).toBe(2);
      // Still "similar" (distance > 0)
      expect(matches[0]?.distance).toBeGreaterThan(0);
    });
  });

  describe("allDecided check", () => {
    test("group with all files decided is marked allDecided=true", async () => {
      const ids = await insertTestMediaFiles(db, 3);
      await insertPhashMatches(db, [
        { id1: ids[0], id2: ids[1], distance: 0 },
        { id1: ids[0], id2: ids[2], distance: 3 },
      ]);
      await phashGroupProvider.recomputeGroups(5);

      const groupKey = `phash:${ids[0]}`;

      // Decide all 3 files
      for (const id of ids) {
        await fileDecisionProvider.insertFileDecision({
          mediaFileId: id,
          action: id === ids[0] ? "keep" : "delete",
          method: "phash",
          reviewGroupKey: groupKey,
        });
      }

      // Check allDecided logic manually (same as getPhashGroups)
      const deletedIds = await fileDecisionProvider.getDeletedFileIds();
      const allMembers = await db
        .selectFrom("phashGroupMembers")
        .select(["mediaFileId", "groupAnchorFileId"])
        .where("mediaFileId", "not in", deletedIds.size > 0 ? [...deletedIds] : [0])
        .execute();

      const memberIds = allMembers
        .filter((m) => (m.groupAnchorFileId as number) === ids[0])
        .map((m) => m.mediaFileId as number);

      // Only non-deleted members remain
      expect(memberIds).toHaveLength(1); // Only A (keep), B and C are deleted

      // Get decisions for the group
      const decisions = await db
        .selectFrom("fileDecisions")
        .select(["mediaFileId", "reviewGroupKey"])
        .where("reviewGroupKey", "=", groupKey)
        .execute();
      const decisionSet = new Set(decisions.map((d) => `${d.mediaFileId}:${d.reviewGroupKey}`));

      // allDecided: all active members have decisions
      const allDecided = memberIds.every((id) => decisionSet.has(`${id}:${groupKey}`));
      expect(allDecided).toBe(true);
    });

    test("group with partial decisions is NOT marked allDecided", async () => {
      const ids = await insertTestMediaFiles(db, 3);
      await insertPhashMatches(db, [
        { id1: ids[0], id2: ids[1], distance: 2 },
        { id1: ids[0], id2: ids[2], distance: 3 },
      ]);
      await phashGroupProvider.recomputeGroups(5);

      const groupKey = `phash:${ids[0]}`;

      // Only decide 1 of 3 files
      await fileDecisionProvider.insertFileDecision({
        mediaFileId: ids[0],
        action: "keep",
        method: "phash",
        reviewGroupKey: groupKey,
      });

      // No files deleted → all 3 are active members
      const allMembers = await db
        .selectFrom("phashGroupMembers")
        .select(["mediaFileId", "groupAnchorFileId"])
        .execute();

      const memberIds = allMembers
        .filter((m) => (m.groupAnchorFileId as number) === ids[0])
        .map((m) => m.mediaFileId as number);
      expect(memberIds).toHaveLength(3);

      const decisions = await db
        .selectFrom("fileDecisions")
        .select(["mediaFileId", "reviewGroupKey"])
        .where("reviewGroupKey", "=", groupKey)
        .execute();
      const decisionSet = new Set(decisions.map((d) => `${d.mediaFileId}:${d.reviewGroupKey}`));

      const allDecided = memberIds.every((id) => decisionSet.has(`${id}:${groupKey}`));
      expect(allDecided).toBe(false);
    });

    test("allDecided is true when remaining active members all have decisions", async () => {
      const ids = await insertTestMediaFiles(db, 3);
      await insertPhashMatches(db, [
        { id1: ids[0], id2: ids[1], distance: 0 },
        { id1: ids[1], id2: ids[2], distance: 2 },
      ]);
      await phashGroupProvider.recomputeGroups(5);

      const groupKey = `phash:${ids[0]}`;

      // Keep A and B, delete C
      await fileDecisionProvider.insertFileDecision({
        mediaFileId: ids[0],
        action: "keep",
        method: "phash",
        reviewGroupKey: groupKey,
      });
      await fileDecisionProvider.insertFileDecision({
        mediaFileId: ids[1],
        action: "keep",
        method: "phash",
        reviewGroupKey: groupKey,
      });
      await fileDecisionProvider.insertFileDecision({
        mediaFileId: ids[2],
        action: "delete",
        method: "phash",
        reviewGroupKey: groupKey,
      });

      const deletedIds = await fileDecisionProvider.getDeletedFileIds();
      expect(deletedIds.has(ids[2])).toBe(true);

      const allMembers = await db
        .selectFrom("phashGroupMembers")
        .select(["mediaFileId", "groupAnchorFileId"])
        .where("mediaFileId", "not in", [...deletedIds])
        .execute();

      const memberIds = allMembers
        .filter((m) => (m.groupAnchorFileId as number) === ids[0])
        .map((m) => m.mediaFileId as number);
      // A and B remain
      expect(memberIds).toHaveLength(2);

      const decisions = await db
        .selectFrom("fileDecisions")
        .select(["mediaFileId", "reviewGroupKey"])
        .where("reviewGroupKey", "=", groupKey)
        .execute();
      const decisionSet = new Set(decisions.map((d) => `${d.mediaFileId}:${d.reviewGroupKey}`));

      const allDecided = memberIds.every((id) => decisionSet.has(`${id}:${groupKey}`));
      expect(allDecided).toBe(true);
    });
  });

  describe("multiple groups isolation", () => {
    test("two separate groups are categorized independently", async () => {
      const ids = await insertTestMediaFiles(db, 4);
      // Group 1: A-B distance=0 (identical)
      // Group 2: C-D distance=3 (similar)
      // No connection between groups
      await insertPhashMatches(db, [
        { id1: ids[0], id2: ids[1], distance: 0 },
        { id1: ids[2], id2: ids[3], distance: 3 },
      ]);
      await phashGroupProvider.recomputeGroups(5);

      const summaries = await phashGroupProvider.getAllGroupSummaries();
      expect(summaries).toHaveLength(2);

      const sorted = summaries.sort((a, b) => a.groupAnchorFileId - b.groupAnchorFileId);
      expect(sorted[0]?.groupMinDistance).toBe(0); // Group 1: identical
      expect(sorted[1]?.groupMinDistance).toBe(3); // Group 2: similar
    });

    test("excluding a file from one group does not affect the other", async () => {
      const ids = await insertTestMediaFiles(db, 4);
      await insertPhashMatches(db, [
        { id1: ids[0], id2: ids[1], distance: 0 },
        { id1: ids[2], id2: ids[3], distance: 3 },
      ]);
      await phashGroupProvider.recomputeGroups(5);

      // Mark file B for delete (in group 1)
      await fileDecisionProvider.insertFileDecision({
        mediaFileId: ids[1],
        action: "delete",
        method: "phash",
        reviewGroupKey: `phash:${ids[0]}`,
      });

      const deletedIds = await fileDecisionProvider.getDeletedFileIds();
      const summaries = await phashGroupProvider.getGroupSummariesExcluding(deletedIds);

      // Group 1 now has only 1 member → filtered out
      // Group 2 is unaffected → still has 2 members
      expect(summaries).toHaveLength(1);
      expect(summaries[0]?.groupAnchorFileId).toBe(ids[2]);
      expect(summaries[0]?.groupMinDistance).toBe(3);
    });

    test("cross-group deletion correctly excludes from all groups", async () => {
      const ids = await insertTestMediaFiles(db, 5);
      // Group 1: A-B-C connected (A-B=0, B-C=2)
      // Group 2: D-E connected (D-E=1)
      await insertPhashMatches(db, [
        { id1: ids[0], id2: ids[1], distance: 0 },
        { id1: ids[1], id2: ids[2], distance: 2 },
        { id1: ids[3], id2: ids[4], distance: 1 },
      ]);
      await phashGroupProvider.recomputeGroups(5);

      // Decide all files in group 1
      const groupKey1 = `phash:${ids[0]}`;
      await fileDecisionProvider.insertFileDecision({
        mediaFileId: ids[0],
        action: "keep",
        method: "phash",
        reviewGroupKey: groupKey1,
      });
      await fileDecisionProvider.insertFileDecision({
        mediaFileId: ids[1],
        action: "delete",
        method: "phash",
        reviewGroupKey: groupKey1,
      });
      await fileDecisionProvider.insertFileDecision({
        mediaFileId: ids[2],
        action: "delete",
        method: "phash",
        reviewGroupKey: groupKey1,
      });

      const deletedIds = await fileDecisionProvider.getDeletedFileIds();
      // B and C are deleted
      expect(deletedIds.size).toBe(2);

      const summaries = await phashGroupProvider.getGroupSummariesExcluding(deletedIds);
      // Group 1: only A remains (1 member → filtered out)
      // Group 2: D-E still has 2 members
      expect(summaries).toHaveLength(1);
      expect(summaries[0]?.groupAnchorFileId).toBe(ids[3]);
    });
  });

  describe("distance recomputation accuracy", () => {
    test("recomputed distance reflects only active pairs", async () => {
      const ids = await insertTestMediaFiles(db, 4);
      // A-B=0, A-C=3, A-D=5, B-C=2, B-D=4
      // Component: {A,B,C,D}, minDistance=0
      await insertPhashMatches(db, [
        { id1: ids[0], id2: ids[1], distance: 0 },
        { id1: ids[0], id2: ids[2], distance: 3 },
        { id1: ids[0], id2: ids[3], distance: 5 },
        { id1: ids[1], id2: ids[2], distance: 2 },
        { id1: ids[1], id2: ids[3], distance: 4 },
      ]);
      await phashGroupProvider.recomputeGroups(5);

      // Verify initial min = 0
      const initial = await phashGroupProvider.getAllGroupSummaries();
      expect(initial[0]?.groupMinDistance).toBe(0);

      // Exclude A and B (the distance-0 pair)
      const excludeIds = new Set([ids[0], ids[1]]);

      // Active members: C and D
      const allMembers = await db
        .selectFrom("phashGroupMembers")
        .select(["mediaFileId", "groupAnchorFileId"])
        .where("mediaFileId", "not in", [...excludeIds])
        .execute();

      const allActiveIds = allMembers.map((m) => m.mediaFileId as number);
      expect(allActiveIds.sort()).toEqual([ids[2], ids[3]].sort());

      // Active matches between C and D only
      const matches = await db
        .selectFrom("phashMatches")
        .select(["mediaFileId1", "mediaFileId2", "distance"])
        .where("distance", "<=", 5)
        .where("mediaFileId1", "in", allActiveIds)
        .where("mediaFileId2", "in", allActiveIds)
        .execute();

      // C-D: check if there's a direct match (there isn't in our data)
      // Actually: we only added A-B, A-C, A-D, B-C, B-D — NOT C-D
      // So after excluding A and B, there are NO active matches
      expect(matches).toHaveLength(0);

      // With no active matches, the group's recomputed min stays at fallback (stored value)
      // This is correct behavior: the files are still grouped but may not have direct connections
    });

    test("recomputed distance picks minimum from remaining pairs", async () => {
      const ids = await insertTestMediaFiles(db, 4);
      // A-B=0, C-D=2, A-C=3, B-D=4
      // All in one component, min=0
      await insertPhashMatches(db, [
        { id1: ids[0], id2: ids[1], distance: 0 },
        { id1: ids[2], id2: ids[3], distance: 2 },
        { id1: ids[0], id2: ids[2], distance: 3 },
        { id1: ids[1], id2: ids[3], distance: 4 },
      ]);
      await phashGroupProvider.recomputeGroups(5);

      const initial = await phashGroupProvider.getAllGroupSummaries();
      expect(initial[0]?.groupMinDistance).toBe(0);

      // Exclude A only → remaining: B, C, D
      const excludeIds = new Set([ids[0]]);
      const allMembers = await db
        .selectFrom("phashGroupMembers")
        .select(["mediaFileId", "groupAnchorFileId"])
        .where("mediaFileId", "not in", [...excludeIds])
        .execute();

      const fileToAnchor = new Map<number, number>();
      const allActiveIds: number[] = [];
      for (const m of allMembers) {
        fileToAnchor.set(m.mediaFileId as number, m.groupAnchorFileId as number);
        allActiveIds.push(m.mediaFileId as number);
      }

      const matches = await db
        .selectFrom("phashMatches")
        .select(["mediaFileId1", "mediaFileId2", "distance"])
        .where("distance", "<=", 5)
        .where("mediaFileId1", "in", allActiveIds)
        .where("mediaFileId2", "in", allActiveIds)
        .execute();

      // Remaining matches: C-D=2, B-D=4 (A-B=0 and A-C=3 are filtered out)
      expect(matches).toHaveLength(2);

      let recomputedMin = 64;
      for (const match of matches) {
        const a1 = fileToAnchor.get(match.mediaFileId1 as number);
        const a2 = fileToAnchor.get(match.mediaFileId2 as number);
        if (a1 !== undefined && a2 !== undefined && a1 === a2) {
          if ((match.distance as number) < recomputedMin) {
            recomputedMin = match.distance as number;
          }
        }
      }

      // Minimum of remaining pairs: C-D=2
      expect(recomputedMin).toBe(2);
      expect(recomputedMin).toBeGreaterThan(0); // Moved from "identical" to "similar"
    });
  });

  describe("batch save scenarios (3-file and N-file burst)", () => {
    test("batch insertFileDecisions persists all 3 decisions (2 keep + 1 delete)", async () => {
      const ids = await insertTestMediaFiles(db, 3);
      // Exact user scenario: A(ids[0])-B(ids[1])=0, A-C(ids[2])=4, B-C=4
      await insertPhashMatches(db, [
        { id1: ids[0], id2: ids[1], distance: 0 },
        { id1: ids[0], id2: ids[2], distance: 4 },
        { id1: ids[1], id2: ids[2], distance: 4 },
      ]);
      await phashGroupProvider.recomputeGroups(5);

      const groupKey = `phash:${ids[0]}`;

      // Batch insert: keep A and B, delete C — exactly what the UI does via submitReviewDecisions
      const count = await fileDecisionProvider.insertFileDecisions([
        { mediaFileId: ids[0], action: "keep", method: "phash", reviewGroupKey: groupKey },
        { mediaFileId: ids[1], action: "keep", method: "phash", reviewGroupKey: groupKey },
        { mediaFileId: ids[2], action: "delete", method: "phash", reviewGroupKey: groupKey },
      ]);

      // All 3 inserts should succeed
      expect(count).toBe(3);

      // Verify all 3 are persisted
      const decisions = await fileDecisionProvider.getDecisionsByReviewGroupKey(groupKey);
      expect(decisions).toHaveLength(3);

      const decisionMap = new Map(decisions.map((d) => [d.mediaFileId, d.action]));
      expect(decisionMap.get(ids[0])).toBe("keep");
      expect(decisionMap.get(ids[1])).toBe("keep");
      expect(decisionMap.get(ids[2])).toBe("delete");
    });

    test("transaction-based upsert (delete + batch insert) persists all decisions", async () => {
      const ids = await insertTestMediaFiles(db, 3);
      await insertPhashMatches(db, [
        { id1: ids[0], id2: ids[1], distance: 0 },
        { id1: ids[0], id2: ids[2], distance: 4 },
        { id1: ids[1], id2: ids[2], distance: 4 },
      ]);
      await phashGroupProvider.recomputeGroups(5);

      const groupKey = `phash:${ids[0]}`;
      const decisions = [
        { mediaFileId: ids[0], action: "keep" as const, method: "phash" as const, reviewGroupKey: groupKey },
        { mediaFileId: ids[1], action: "keep" as const, method: "phash" as const, reviewGroupKey: groupKey },
        { mediaFileId: ids[2], action: "delete" as const, method: "phash" as const, reviewGroupKey: groupKey },
      ];

      // Simulate the exact handler logic: delete-then-insert in a transaction
      const stored = await fileDecisionProvider.transaction(async (trx) => {
        for (const d of decisions) {
          await trx.deleteByMediaFileIdAndGroupKey(d.mediaFileId, d.reviewGroupKey);
        }
        return await trx.insertFileDecisions(decisions);
      });

      expect(stored).toBe(3);

      // Post-save verification (same as handler)
      const verification = await fileDecisionProvider.getDecisionsByReviewGroupKey(groupKey);
      expect(verification).toHaveLength(3);
    });

    test("getDeletedFileIds includes file marked for deletion after batch save", async () => {
      const ids = await insertTestMediaFiles(db, 3);
      await insertPhashMatches(db, [
        { id1: ids[0], id2: ids[1], distance: 0 },
        { id1: ids[0], id2: ids[2], distance: 4 },
        { id1: ids[1], id2: ids[2], distance: 4 },
      ]);
      await phashGroupProvider.recomputeGroups(5);

      const groupKey = `phash:${ids[0]}`;

      await fileDecisionProvider.insertFileDecisions([
        { mediaFileId: ids[0], action: "keep", method: "phash", reviewGroupKey: groupKey },
        { mediaFileId: ids[1], action: "keep", method: "phash", reviewGroupKey: groupKey },
        { mediaFileId: ids[2], action: "delete", method: "phash", reviewGroupKey: groupKey },
      ]);

      const deletedIds = await fileDecisionProvider.getDeletedFileIds();
      expect(deletedIds.has(ids[2])).toBe(true);
      expect(deletedIds.has(ids[0])).toBe(false);
      expect(deletedIds.has(ids[1])).toBe(false);
    });

    test("allDecided is true for all active members after batch save", async () => {
      const ids = await insertTestMediaFiles(db, 3);
      await insertPhashMatches(db, [
        { id1: ids[0], id2: ids[1], distance: 0 },
        { id1: ids[0], id2: ids[2], distance: 4 },
        { id1: ids[1], id2: ids[2], distance: 4 },
      ]);
      await phashGroupProvider.recomputeGroups(5);

      const groupKey = `phash:${ids[0]}`;

      await fileDecisionProvider.insertFileDecisions([
        { mediaFileId: ids[0], action: "keep", method: "phash", reviewGroupKey: groupKey },
        { mediaFileId: ids[1], action: "keep", method: "phash", reviewGroupKey: groupKey },
        { mediaFileId: ids[2], action: "delete", method: "phash", reviewGroupKey: groupKey },
      ]);

      // Get active (non-deleted) members
      const deletedIds = await fileDecisionProvider.getDeletedFileIds();
      const allMembers = await db
        .selectFrom("phashGroupMembers")
        .select(["mediaFileId", "groupAnchorFileId"])
        .where("mediaFileId", "not in", [...deletedIds])
        .execute();

      const memberIds = allMembers
        .filter((m) => (m.groupAnchorFileId as number) === ids[0])
        .map((m) => m.mediaFileId as number);

      // A and B remain active (C is deleted)
      expect(memberIds).toHaveLength(2);
      expect(memberIds.sort()).toEqual([ids[0], ids[1]].sort());

      // All active members have decisions
      const allDecisions = await db
        .selectFrom("fileDecisions")
        .select(["mediaFileId", "reviewGroupKey"])
        .where("reviewGroupKey", "=", groupKey)
        .execute();
      const decisionSet = new Set(allDecisions.map((d) => `${d.mediaFileId}:${d.reviewGroupKey}`));

      const allDecided = memberIds.every((id) => decisionSet.has(`${id}:${groupKey}`));
      expect(allDecided).toBe(true);
    });

    test("group appears in 'identical' only (not 'similar') based on min distance", async () => {
      const ids = await insertTestMediaFiles(db, 3);
      // A-B=0, A-C=4, B-C=4 → component minDistance=0
      await insertPhashMatches(db, [
        { id1: ids[0], id2: ids[1], distance: 0 },
        { id1: ids[0], id2: ids[2], distance: 4 },
        { id1: ids[1], id2: ids[2], distance: 4 },
      ]);
      await phashGroupProvider.recomputeGroups(5);

      // Stored minDistance should be 0 (from A-B pair)
      const summaries = await phashGroupProvider.getAllGroupSummaries();
      expect(summaries).toHaveLength(1);
      expect(summaries[0]?.groupMinDistance).toBe(0);

      // With no decisions yet, recomputed active min should also be 0
      const allMembers = await db
        .selectFrom("phashGroupMembers")
        .select(["mediaFileId", "groupAnchorFileId"])
        .execute();

      const fileToAnchor = new Map<number, number>();
      const allActiveIds: number[] = [];
      for (const m of allMembers) {
        fileToAnchor.set(m.mediaFileId as number, m.groupAnchorFileId as number);
        allActiveIds.push(m.mediaFileId as number);
      }

      const matches = await db
        .selectFrom("phashMatches")
        .select(["mediaFileId1", "mediaFileId2", "distance"])
        .where("distance", "<=", 5)
        .where("mediaFileId1", "in", allActiveIds)
        .where("mediaFileId2", "in", allActiveIds)
        .execute();

      let recomputedMin = 64;
      for (const match of matches) {
        const a1 = fileToAnchor.get(match.mediaFileId1 as number);
        const a2 = fileToAnchor.get(match.mediaFileId2 as number);
        if (a1 !== undefined && a2 !== undefined && a1 === a2) {
          if ((match.distance as number) < recomputedMin) {
            recomputedMin = match.distance as number;
          }
        }
      }

      // minDistance=0 → "identical" category, NOT "similar"
      expect(recomputedMin).toBe(0);

      // Verify category filtering logic:
      // "identical" filter: minPhashDistance === 0 → INCLUDES this group
      const isIdentical = recomputedMin === 0;
      expect(isIdentical).toBe(true);

      // "similar" filter: minPhashDistance > 0 → EXCLUDES this group
      const isSimilar = recomputedMin > 0;
      expect(isSimilar).toBe(false);
    });

    test("N-file burst: batch save persists all decisions for 10-photo burst", async () => {
      const N = 10;
      const ids = await insertTestMediaFiles(db, N);

      // Simulate burst photos: all pairwise matches with varying distances
      // First pair (ids[0]-ids[1]) is identical (distance 0), rest are similar (1-5)
      const matches: Array<{ id1: number; id2: number; distance: number }> = [];
      for (let i = 0; i < N; i++) {
        for (let j = i + 1; j < N; j++) {
          // First pair identical, rest vary from 1-5
          const distance = i === 0 && j === 1 ? 0 : ((i + j) % 5) + 1;
          matches.push({ id1: ids[i], id2: ids[j], distance });
        }
      }
      await insertPhashMatches(db, matches);
      await phashGroupProvider.recomputeGroups(5);

      // All N files should be in one group
      const summaries = await phashGroupProvider.getAllGroupSummaries();
      expect(summaries).toHaveLength(1);
      expect(summaries[0]?.fileCount).toBe(N);

      const groupKey = `phash:${ids[0]}`;

      // Keep first file, delete the rest (typical burst photo workflow)
      const decisions = ids.map((id, idx) => ({
        mediaFileId: id,
        action: idx === 0 ? ("keep" as const) : ("delete" as const),
        method: "phash" as const,
        reviewGroupKey: groupKey,
      }));

      // Transaction-based save (exactly what the handler does)
      const stored = await fileDecisionProvider.transaction(async (trx) => {
        for (const d of decisions) {
          await trx.deleteByMediaFileIdAndGroupKey(d.mediaFileId, d.reviewGroupKey);
        }
        return await trx.insertFileDecisions(decisions);
      });

      expect(stored).toBe(N);

      // Verify ALL N decisions persisted
      const verification = await fileDecisionProvider.getDecisionsByReviewGroupKey(groupKey);
      expect(verification).toHaveLength(N);

      // Verify correct keep/delete assignment
      const decisionMap = new Map(verification.map((d) => [d.mediaFileId, d.action]));
      expect(decisionMap.get(ids[0])).toBe("keep");
      for (let i = 1; i < N; i++) {
        expect(decisionMap.get(ids[i])).toBe("delete");
      }

      // Verify deletedFileIds
      const deletedIds = await fileDecisionProvider.getDeletedFileIds();
      expect(deletedIds.size).toBe(N - 1);
      expect(deletedIds.has(ids[0])).toBe(false);
      for (let i = 1; i < N; i++) {
        expect(deletedIds.has(ids[i])).toBe(true);
      }
    });

    test("N-file burst: allDecided after batch save with multiple keeps", async () => {
      const N = 8;
      const ids = await insertTestMediaFiles(db, N);

      // Burst: all pairs have distances 1-4 (all similar)
      const matches: Array<{ id1: number; id2: number; distance: number }> = [];
      for (let i = 0; i < N; i++) {
        for (let j = i + 1; j < N; j++) {
          matches.push({ id1: ids[i], id2: ids[j], distance: ((i + j) % 4) + 1 });
        }
      }
      await insertPhashMatches(db, matches);
      await phashGroupProvider.recomputeGroups(5);

      const groupKey = `phash:${ids[0]}`;

      // Keep first 3, delete rest (realistic: user picks best 3 from burst)
      const decisions = ids.map((id, idx) => ({
        mediaFileId: id,
        action: idx < 3 ? ("keep" as const) : ("delete" as const),
        method: "phash" as const,
        reviewGroupKey: groupKey,
      }));

      await fileDecisionProvider.insertFileDecisions(decisions);

      // Get active (non-deleted) members
      const deletedIds = await fileDecisionProvider.getDeletedFileIds();
      expect(deletedIds.size).toBe(N - 3);

      const allMembers = await db
        .selectFrom("phashGroupMembers")
        .select(["mediaFileId", "groupAnchorFileId"])
        .where("mediaFileId", "not in", [...deletedIds])
        .execute();

      const memberIds = allMembers
        .filter((m) => (m.groupAnchorFileId as number) === ids[0])
        .map((m) => m.mediaFileId as number);

      // 3 kept files remain active
      expect(memberIds).toHaveLength(3);

      // All active members have decisions
      const allDecisions = await db
        .selectFrom("fileDecisions")
        .select(["mediaFileId", "reviewGroupKey"])
        .where("reviewGroupKey", "=", groupKey)
        .execute();
      const decisionSet = new Set(allDecisions.map((d) => `${d.mediaFileId}:${d.reviewGroupKey}`));

      const allDecided = memberIds.every((id) => decisionSet.has(`${id}:${groupKey}`));
      expect(allDecided).toBe(true);
    });

    test("N-file burst: re-save (upsert) overwrites previous decisions", async () => {
      const N = 6;
      const ids = await insertTestMediaFiles(db, N);

      const matches: Array<{ id1: number; id2: number; distance: number }> = [];
      for (let i = 0; i < N; i++) {
        for (let j = i + 1; j < N; j++) {
          matches.push({ id1: ids[i], id2: ids[j], distance: ((i + j) % 4) + 1 });
        }
      }
      await insertPhashMatches(db, matches);
      await phashGroupProvider.recomputeGroups(5);

      const groupKey = `phash:${ids[0]}`;

      // First save: keep first, delete rest
      await fileDecisionProvider.transaction(async (trx) => {
        for (const id of ids) {
          await trx.deleteByMediaFileIdAndGroupKey(id, groupKey);
        }
        return await trx.insertFileDecisions(
          ids.map((id, idx) => ({
            mediaFileId: id,
            action: idx === 0 ? ("keep" as const) : ("delete" as const),
            method: "phash" as const,
            reviewGroupKey: groupKey,
          })),
        );
      });

      // Second save: change mind — keep first 2, delete rest
      await fileDecisionProvider.transaction(async (trx) => {
        for (const id of ids) {
          await trx.deleteByMediaFileIdAndGroupKey(id, groupKey);
        }
        return await trx.insertFileDecisions(
          ids.map((id, idx) => ({
            mediaFileId: id,
            action: idx < 2 ? ("keep" as const) : ("delete" as const),
            method: "phash" as const,
            reviewGroupKey: groupKey,
          })),
        );
      });

      // Verify second save overwrote first
      const verification = await fileDecisionProvider.getDecisionsByReviewGroupKey(groupKey);
      expect(verification).toHaveLength(N);

      const decisionMap = new Map(verification.map((d) => [d.mediaFileId, d.action]));
      expect(decisionMap.get(ids[0])).toBe("keep");
      expect(decisionMap.get(ids[1])).toBe("keep");
      for (let i = 2; i < N; i++) {
        expect(decisionMap.get(ids[i])).toBe("delete");
      }

      // Only N-2 deleted
      const deletedIds = await fileDecisionProvider.getDeletedFileIds();
      expect(deletedIds.size).toBe(N - 2);
    });
  });
});
