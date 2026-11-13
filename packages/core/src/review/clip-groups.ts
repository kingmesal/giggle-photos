/**
 * CLIP review groups (RFD-002 §F–G), derived at query time like pHash groups:
 * pairs from `clipMatches` at or under the review cutoff are joined into connected groups keyed
 * `clip:{lowest file id}`. Review-only: nothing is ever preselected.
 *
 * A pair is left out when both files are already grouped by an earlier method (same SHA-256, same
 * content hash, or the same pHash group): those are reviewed there, and CLIP would only repeat them.
 */

import { clipThresholds } from "../clip/clip-settings";
import { CLIP_MODEL } from "../clip/model-manifest";
import { type AppSettings, getAppSettings } from "../config/user-config";
import type { DatabaseProvider } from "../db/database-provider";
import type { LogicalGroupSummary } from "./review-queries";

const SQL_CHUNK_SIZE = 900;

export interface ClipPairLike {
  mediaFileId1: number;
  mediaFileId2: number;
  distance: number;
}

export interface ClipGroup {
  anchorId: number;
  /** Sorted ascending; the anchor is the first. */
  memberIds: number[];
  minDistance: number;
  /** Each member's distance to its closest match inside the group. */
  closest: Map<number, number>;
}

export const CLIP_REVIEW_REASON = "Visual matches are for review only";

/** Join pairs into connected groups, skipping excluded files and pairs already grouped elsewhere. */
export function groupClipPairs(
  pairs: readonly ClipPairLike[],
  exclude: ReadonlySet<number>,
  alreadyGrouped: (a: number, b: number) => boolean = () => false,
): ClipGroup[] {
  const parent = new Map<number, number>();
  const find = (x: number): number => {
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root) as number;
    for (let n = x; n !== root; ) {
      const next = parent.get(n) as number;
      parent.set(n, root);
      n = next;
    }
    return root;
  };
  const kept = pairs.filter(
    (p) =>
      !exclude.has(p.mediaFileId1) && !exclude.has(p.mediaFileId2) && !alreadyGrouped(p.mediaFileId1, p.mediaFileId2),
  );
  for (const p of kept) {
    for (const id of [p.mediaFileId1, p.mediaFileId2]) if (!parent.has(id)) parent.set(id, id);
    const a = find(p.mediaFileId1);
    const b = find(p.mediaFileId2);
    if (a !== b) parent.set(Math.max(a, b), Math.min(a, b));
  }

  const groups = new Map<number, ClipGroup>();
  const groupOf = (id: number): ClipGroup => {
    const root = find(id);
    let g = groups.get(root);
    if (!g) {
      g = { anchorId: root, memberIds: [], minDistance: Number.POSITIVE_INFINITY, closest: new Map() };
      groups.set(root, g);
    }
    return g;
  };
  for (const p of kept) {
    const g = groupOf(p.mediaFileId1);
    g.minDistance = Math.min(g.minDistance, p.distance);
    for (const id of [p.mediaFileId1, p.mediaFileId2]) {
      g.closest.set(id, Math.min(g.closest.get(id) ?? Number.POSITIVE_INFINITY, p.distance));
    }
  }
  for (const g of groups.values()) {
    g.memberIds = [...g.closest.keys()].sort((a, b) => a - b);
    g.anchorId = g.memberIds[0] as number;
  }
  return [...groups.values()].sort((a, b) => a.minDistance - b.minDistance || a.anchorId - b.anchorId);
}

type Db = Pick<DatabaseProvider, "getClient" | "getClipProvider">;

/** Current CLIP groups (empty when CLIP is turned off), excluding files already marked delete. */
type ClipGroupSettings = Parameters<typeof clipThresholds>[0] & Pick<AppSettings, "clipEnabled">;

export async function loadClipGroups(
  dbProvider: Db,
  deletedFileIds: ReadonlySet<number>,
  settings: ClipGroupSettings = getAppSettings(),
): Promise<ClipGroup[]> {
  if (!settings.clipEnabled) return [];
  const pairs = await dbProvider.getClipProvider().getMatches(CLIP_MODEL.id, clipThresholds(settings).review);
  if (pairs.length === 0) return [];

  const ids = [...new Set(pairs.flatMap((p) => [p.mediaFileId1, p.mediaFileId2]))];
  const db = dbProvider.getClient().getDb();
  const hashes = new Map<number, { sha: string | null; content: string | null; phash: number | null }>();
  for (let i = 0; i < ids.length; i += SQL_CHUNK_SIZE) {
    const chunk = ids.slice(i, i + SQL_CHUNK_SIZE);
    const [files, members] = await Promise.all([
      db.selectFrom("mediaFiles").select(["id", "sha256Hash", "contentHash"]).where("id", "in", chunk).execute(),
      db
        .selectFrom("phashGroupMembers")
        .select(["mediaFileId", "groupAnchorFileId"])
        .where("mediaFileId", "in", chunk)
        .execute(),
    ]);
    const anchorOf = new Map(members.map((m) => [m.mediaFileId as number, m.groupAnchorFileId as number]));
    for (const f of files) {
      const id = f.id as number;
      hashes.set(id, { sha: f.sha256Hash ?? null, content: f.contentHash ?? null, phash: anchorOf.get(id) ?? null });
    }
  }
  const same = (a: string | number | null | undefined, b: string | number | null | undefined) =>
    a !== null && a !== undefined && a === b;
  return groupClipPairs(pairs, deletedFileIds, (a, b) => {
    const x = hashes.get(a);
    const y = hashes.get(b);
    return same(x?.sha, y?.sha) || same(x?.content, y?.content) || same(x?.phash, y?.phash);
  });
}

/** Parse `clip:{anchor}`; throws on anything else. */
export function clipAnchorId(groupKey: string): number {
  const anchor = Number.parseInt(groupKey.replace("clip:", ""), 10);
  if (!groupKey.startsWith("clip:") || Number.isNaN(anchor)) throw new Error(`Invalid clip group key: ${groupKey}`);
  return anchor;
}

/** Group summaries for the review list. No preselection, so no per-group file contexts are built. */
export async function getClipGroupSummaries(
  dbProvider: Db & Pick<DatabaseProvider, "getFileDecisionProvider">,
  deletedFileIds: ReadonlySet<number>,
  settings: ClipGroupSettings = getAppSettings(),
): Promise<LogicalGroupSummary[]> {
  const groups = await loadClipGroups(dbProvider, deletedFileIds, settings);
  if (groups.length === 0) return [];
  const decided = new Set(
    (await dbProvider.getFileDecisionProvider().getDecisionsByMethod("clip")).map(
      (d) => `${d.mediaFileId}:${d.reviewGroupKey}`,
    ),
  );
  const ids = groups.flatMap((g) => g.memberIds);
  const db = dbProvider.getClient().getDb();
  const sizeOf = new Map<number, number>();
  for (let i = 0; i < ids.length; i += SQL_CHUNK_SIZE) {
    const rows = await db
      .selectFrom("mediaFiles")
      .select(["id", "size"])
      .where("id", "in", ids.slice(i, i + SQL_CHUNK_SIZE))
      .execute();
    for (const r of rows) sizeOf.set(r.id as number, r.size as number);
  }
  return groups.map((g) => {
    const groupKey = `clip:${g.anchorId}`;
    const isDecided = (id: number) => decided.has(`${id}:${groupKey}`);
    return {
      groupKey,
      method: "clip",
      fileCount: g.memberIds.length,
      totalSize: g.memberIds.reduce((sum, id) => sum + (sizeOf.get(id) ?? 0), 0),
      suggestedKeepFileId: 0,
      suggestedKeepReason: CLIP_REVIEW_REASON,
      hasDecisions: g.memberIds.some(isDecided),
      allDecided: g.memberIds.every(isDecided),
      minClipDistance: g.minDistance,
    };
  });
}
