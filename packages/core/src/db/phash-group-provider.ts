import { getLogger } from "../logging/logger";
import { PhashGroupMemberRecord } from "../zod/phash-group-member";
import type { DatabaseInstance } from "./schema";

const log = getLogger("core:phash-group-provider");

/**
 * Summary of a single pHash group (connected component).
 */
export interface PhashGroupSummary {
  groupAnchorFileId: number;
  groupMinDistance: number;
  fileCount: number;
}

/**
 * Provider for the pre-computed phashGroupMembers table.
 *
 * Groups are recomputed (truncate + repopulate) after:
 * 1. Duplicate detection (new matches added)
 * 2. File deletions (components may have split)
 *
 * Between those events the table is read-only, enabling fast indexed
 * lookups instead of rebuilding Union-Find on every review query.
 */
export class PhashGroupProvider {
  constructor(private db: DatabaseInstance) {}

  /**
   * Rebuild all groups from phashMatches.
   * Truncates the table and repopulates from scratch using Union-Find.
   *
   * @param threshold - max hamming distance to include (default 5)
   */
  async recomputeGroups(threshold = 5): Promise<void> {
    const start = performance.now();

    // 1. Delete all existing group members
    await this.db.deleteFrom("phashGroupMembers").execute();

    // 2. Fetch all qualifying matches
    const allMatches = await this.db
      .selectFrom("phashMatches")
      .select(["mediaFileId1", "mediaFileId2", "distance"])
      .where("distance", "<=", threshold)
      .execute();

    if (allMatches.length === 0) {
      log.info("No phash matches within threshold, groups table cleared");
      return;
    }

    // 3. Union-Find to compute connected components
    const parent = new Map<number, number>();
    const rank = new Map<number, number>();

    function find(x: number): number {
      if (!parent.has(x)) {
        parent.set(x, x);
        rank.set(x, 0);
      }
      let root = x;
      while (parent.get(root) !== root) {
        root = parent.get(root) as number;
      }
      // Path compression
      let current = x;
      while (current !== root) {
        const next = parent.get(current) as number;
        parent.set(current, root);
        current = next;
      }
      return root;
    }

    function union(a: number, b: number): void {
      const rootA = find(a);
      const rootB = find(b);
      if (rootA === rootB) return;
      const rankA = rank.get(rootA) ?? 0;
      const rankB = rank.get(rootB) ?? 0;
      if (rankA < rankB) {
        parent.set(rootA, rootB);
      } else if (rankA > rankB) {
        parent.set(rootB, rootA);
      } else {
        parent.set(rootB, rootA);
        rank.set(rootA, rankA + 1);
      }
    }

    // Track min distance per pair for component min-distance calculation
    const pairDistances = new Map<string, number>();

    for (const match of allMatches) {
      const id1 = match.mediaFileId1 as number;
      const id2 = match.mediaFileId2 as number;
      union(id1, id2);
      const key = `${Math.min(id1, id2)}:${Math.max(id1, id2)}`;
      pairDistances.set(key, match.distance as number);
    }

    // 4. Group files by connected component
    const components = new Map<number, number[]>();
    for (const fileId of parent.keys()) {
      const root = find(fileId);
      if (!components.has(root)) {
        components.set(root, []);
      }
      (components.get(root) as number[]).push(fileId);
    }

    // 5. Build insert rows for components with 2+ files
    const now = new Date();
    const rows: Array<{
      mediaFileId: number;
      groupAnchorFileId: number;
      groupMinDistance: number;
    }> = [];

    for (const [, fileIds] of components) {
      if (fileIds.length < 2) continue;

      const sortedIds = fileIds.sort((a, b) => a - b);
      const anchorFileId = sortedIds[0] as number;

      // Find minimum distance within this component
      let minDistance = 64;
      for (let i = 0; i < sortedIds.length; i++) {
        for (let j = i + 1; j < sortedIds.length; j++) {
          const key = `${sortedIds[i]}:${sortedIds[j]}`;
          const dist = pairDistances.get(key);
          if (dist !== undefined && dist < minDistance) {
            minDistance = dist;
          }
        }
      }

      for (const fileId of sortedIds) {
        rows.push({
          mediaFileId: fileId,
          groupAnchorFileId: anchorFileId,
          groupMinDistance: minDistance,
        });
      }
    }

    // 6. Batch insert (chunks of 500 to avoid SQLite variable limits)
    const CHUNK_SIZE = 500;
    for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
      const chunk = rows.slice(i, i + CHUNK_SIZE);
      const validated = chunk.map((r) =>
        PhashGroupMemberRecord.parse({
          ...r,
          createdAt: now,
        }),
      );
      await this.db.insertInto("phashGroupMembers").values(validated).execute();
    }

    const elapsed = performance.now() - start;
    log.info(
      `Recomputed phash groups: ${rows.length} members in ${components.size} components (${elapsed.toFixed(1)}ms)`,
    );
  }

  /**
   * Get all file IDs belonging to a group (by anchor file ID).
   */
  async getGroupFileIds(anchorFileId: number): Promise<number[]> {
    const rows = await this.db
      .selectFrom("phashGroupMembers")
      .select("mediaFileId")
      .where("groupAnchorFileId", "=", anchorFileId)
      .execute();

    return rows.map((r) => r.mediaFileId as number);
  }

  /**
   * Get group info for a specific file.
   */
  async getGroupForFile(mediaFileId: number): Promise<{ groupAnchorFileId: number; groupMinDistance: number } | null> {
    const row = await this.db
      .selectFrom("phashGroupMembers")
      .select(["groupAnchorFileId", "groupMinDistance"])
      .where("mediaFileId", "=", mediaFileId)
      .executeTakeFirst();

    if (!row) return null;
    return {
      groupAnchorFileId: row.groupAnchorFileId as number,
      groupMinDistance: row.groupMinDistance as number,
    };
  }

  /**
   * Get all group summaries (anchor, minDistance, fileCount) in a single aggregation query.
   */
  async getAllGroupSummaries(): Promise<PhashGroupSummary[]> {
    const rows = await this.db
      .selectFrom("phashGroupMembers")
      .select(["groupAnchorFileId"])
      .select((eb) => eb.fn.min("groupMinDistance").as("groupMinDistance"))
      .select((eb) => eb.fn.count("id").as("fileCount"))
      .groupBy("groupAnchorFileId")
      .having((eb) => eb.fn.count("id"), ">=", 2)
      .execute();

    return rows.map((r) => ({
      groupAnchorFileId: r.groupAnchorFileId as number,
      groupMinDistance: Number(r.groupMinDistance),
      fileCount: Number(r.fileCount),
    }));
  }

  /**
   * Get group summaries excluding specific file IDs.
   * Returns only groups that still have 2+ active members.
   *
   * Note: The returned `groupMinDistance` is the stored value from the table,
   * which may be stale if excluded files participated in the minimum-distance pair.
   * Callers should recompute the distance from phashMatches for accuracy.
   */
  async getGroupSummariesExcluding(excludeFileIds: Set<number>): Promise<PhashGroupSummary[]> {
    if (excludeFileIds.size === 0) {
      return this.getAllGroupSummaries();
    }

    // SQLite variable limit: if too many IDs, fetch all and filter in JS
    const SQL_CHUNK_SIZE = 900;
    if (excludeFileIds.size <= SQL_CHUNK_SIZE) {
      const excludeArray = [...excludeFileIds];
      const rows = await this.db
        .selectFrom("phashGroupMembers")
        .select(["groupAnchorFileId"])
        .select((eb) => eb.fn.min("groupMinDistance").as("groupMinDistance"))
        .select((eb) => eb.fn.count("id").as("fileCount"))
        .where("mediaFileId", "not in", excludeArray)
        .groupBy("groupAnchorFileId")
        .having((eb) => eb.fn.count("id"), ">=", 2)
        .execute();

      return rows.map((r) => ({
        groupAnchorFileId: r.groupAnchorFileId as number,
        groupMinDistance: Number(r.groupMinDistance),
        fileCount: Number(r.fileCount),
      }));
    }

    // Large exclusion set: fetch all rows, filter in JS, aggregate manually
    const allRows = await this.db
      .selectFrom("phashGroupMembers")
      .select(["mediaFileId", "groupAnchorFileId", "groupMinDistance"])
      .execute();

    const groups = new Map<number, { minDist: number; count: number }>();
    for (const row of allRows) {
      const fid = row.mediaFileId as number;
      if (excludeFileIds.has(fid)) continue;
      const anchor = row.groupAnchorFileId as number;
      const dist = Number(row.groupMinDistance);
      const existing = groups.get(anchor);
      if (existing) {
        existing.count++;
        if (dist < existing.minDist) existing.minDist = dist;
      } else {
        groups.set(anchor, { minDist: dist, count: 1 });
      }
    }

    const result: PhashGroupSummary[] = [];
    for (const [anchor, data] of groups) {
      if (data.count >= 2) {
        result.push({
          groupAnchorFileId: anchor,
          groupMinDistance: data.minDist,
          fileCount: data.count,
        });
      }
    }
    return result;
  }

  /**
   * Ensure groups are computed. If the table is empty but phashMatches has data,
   * runs recomputeGroups() once (lazy initialization for migration).
   */
  async ensureGroupsComputed(threshold = 5): Promise<void> {
    const memberCount = await this.db
      .selectFrom("phashGroupMembers")
      .select((eb) => eb.fn.count("id").as("count"))
      .executeTakeFirst();

    if (Number(memberCount?.count ?? 0) > 0) return;

    // Check if phashMatches has data
    const matchCount = await this.db
      .selectFrom("phashMatches")
      .select((eb) => eb.fn.count("id").as("count"))
      .where("distance", "<=", threshold)
      .executeTakeFirst();

    if (Number(matchCount?.count ?? 0) === 0) return;

    log.info("phashGroupMembers empty but phashMatches has data — running lazy recompute");
    await this.recomputeGroups(threshold);
  }

  /**
   * Delete all group members.
   */
  async deleteAll(): Promise<void> {
    await this.db.deleteFrom("phashGroupMembers").execute();
  }
}
