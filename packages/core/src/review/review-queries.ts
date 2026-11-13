import { getAppSettings } from "../config/user-config";
import { DatabaseProvider } from "../db/database-provider";
import type { DatabaseInstance } from "../db/schema";
import { getLogger } from "../logging/logger";
import type { FileDecision, FileDecisionMethod } from "../zod/file-decision";
import type { ImageMetadata } from "../zod/image-metadata";
import type { MediaFile } from "../zod/media-file";
import type { VideoMetadata } from "../zod/video-metadata";
import { type AutoSelectionOptions, computeAutoSelection } from "./auto-selection";
import { clipAnchorId, getClipGroupSummaries, loadClipGroups } from "./clip-groups";

const perfLog = getLogger("performance");

/** Preselection inputs read once per query (settings are read from disk). */
function selectionOptions(dbProvider: DatabaseProvider): AutoSelectionOptions {
  return { owners: dbProvider.getFolderOwnerDeviceProvider(), ruleOrder: getAppSettings().preselectRuleOrder };
}

/**
 * Maximum number of SQL variables per IN/NOT IN clause.
 * SQLite defaults to 999 (SQLITE_MAX_VARIABLE_NUMBER).
 * We use 900 to leave headroom for other query parameters.
 */
const SQL_CHUNK_SIZE = 900;

/**
 * Summary of a logical group of duplicate files.
 * Groups are derived at query time, not pre-computed.
 */
export interface LogicalGroupSummary {
  /** Hash value or "phash:{anchorFileId}" */
  groupKey: string;
  /** Detection method that produced this group */
  method: FileDecisionMethod;
  /** Number of files in the group (excluding already-deleted files) */
  fileCount: number;
  /** Total size of all files in the group */
  totalSize: number;
  /** Auto-selected file ID to keep */
  suggestedKeepFileId: number;
  /** Reason for auto-selection */
  suggestedKeepReason: string;
  /** Whether any files in this group have decisions */
  hasDecisions: boolean;
  /** Whether all files in this group have been decided */
  allDecided: boolean;
  /** For pHash groups: minimum hamming distance */
  minPhashDistance?: number;
  /** For CLIP groups: closest cosine distance between two members */
  minClipDistance?: number;
}

/**
 * A file within a review context, including metadata and decision state.
 */
export interface FileWithReviewContext {
  /** The media file record */
  file: MediaFile;
  /** Image or video metadata (if available) */
  metadata: ImageMetadata | VideoMetadata | null;
  /** Priority of the file's scan folder (1 = highest) */
  folderPriority: number;
  /** User's decision for this file in this group (if any) */
  decision: FileDecision | null;
  /** For pHash groups: hamming distance to anchor image */
  phashDistance?: number;
  /** For CLIP groups: cosine distance to this file's closest match in the group */
  clipDistance?: number;
}

/**
 * Auto-selection result for a group.
 */
export interface AutoSelection {
  /** Primary file to keep (first of keepFileIds), 0 when nothing is preselected. */
  fileId: number;
  /** Every file to preselect as keep (several when all album copies are kept; empty for clip). */
  keepFileIds: number[];
  reason: string;
}

/**
 * Review summary statistics.
 */
export interface ReviewSummary {
  /** Number of pending SHA-256 groups */
  pendingSha256: number;
  /** Number of pending content hash groups */
  pendingContentHash: number;
  /** Number of pending pHash groups */
  pendingPhash: number;
  /** Number of pending CLIP (visual similarity) groups; 0 when CLIP is off */
  pendingClip: number;
  /** Total files decided as "keep" */
  decidedKeep: number;
  /** Total files decided as "delete" */
  decidedDelete: number;
  /** Number of pHash match rows with distance = 0 (perceptually identical pairs) */
  phashIdenticalPairs: number;
  /** Number of pHash match rows with 0 < distance <= threshold (perceptually similar pairs) */
  phashSimilarPairs: number;
  /** Number of files with conflicting keep/delete decisions across groups */
  conflictCount: number;
}

/**
 * Get pending logical groups for a given detection method.
 *
 * Groups are derived at query time from existing data:
 * - SHA-256: files sharing the same sha256Hash
 * - Content hash: files sharing the same contentHash
 * - pHash: files linked via phashMatches within threshold
 */
export async function getPendingGroups(params: {
  method: FileDecisionMethod;
  page?: number;
  pageSize?: number;
  phashThreshold?: number;
  phashCategory?: "identical" | "similar";
}): Promise<{ groups: LogicalGroupSummary[]; total: number; page: number; pageSize: number }> {
  const { method, page = 1, pageSize = 20, phashThreshold = 5, phashCategory } = params;
  const dbProvider = await DatabaseProvider.getInstance();
  const db = dbProvider.getClient().getDb();
  const fileDecisionProvider = dbProvider.getFileDecisionProvider();

  // Get IDs of files already marked for deletion (exclude from groups)
  const deletedFileIds = await fileDecisionProvider.getDeletedFileIds();

  let allGroups: LogicalGroupSummary[];

  if (method === "sha256" || method === "content_hash") {
    allGroups = await getHashBasedGroups(db, dbProvider, method, deletedFileIds, selectionOptions(dbProvider));
  } else if (method === "clip") {
    allGroups = await getClipGroupSummaries(dbProvider, deletedFileIds);
  } else {
    allGroups = await getPhashGroups(db, dbProvider, phashThreshold, deletedFileIds, selectionOptions(dbProvider));
  }

  // Filter to only groups with at least one undecided file
  let pendingGroups = allGroups.filter((g) => !g.allDecided && g.fileCount >= 2);

  // Server-side phash category filtering (identical = distance 0, similar = distance > 0)
  if (method === "phash" && phashCategory) {
    if (phashCategory === "identical") {
      pendingGroups = pendingGroups.filter((g) => g.minPhashDistance === 0);
    } else {
      pendingGroups = pendingGroups.filter((g) => g.minPhashDistance !== undefined && g.minPhashDistance > 0);
    }
  }

  const total = pendingGroups.length;
  const offset = (page - 1) * pageSize;
  const groups = pendingGroups.slice(offset, offset + pageSize);

  return { groups, total, page, pageSize };
}

/**
 * Get SHA-256 or content hash logical groups.
 */
async function getHashBasedGroups(
  db: DatabaseInstance,
  dbProvider: DatabaseProvider,
  method: "sha256" | "content_hash",
  deletedFileIds: Set<number>,
  selection: AutoSelectionOptions,
): Promise<LogicalGroupSummary[]> {
  const hashField = method === "sha256" ? "sha256Hash" : "contentHash";
  const fileDecisionProvider = dbProvider.getFileDecisionProvider();

  // Find hashes that appear more than once
  const duplicateHashes = await db
    .selectFrom("mediaFiles")
    .select([hashField])
    .select((eb) => eb.fn.count("id").as("count"))
    .where(hashField, "is not", null)
    .groupBy(hashField)
    .having((eb) => eb.fn.count("id"), ">", 1)
    .execute();

  const groups: LogicalGroupSummary[] = [];

  for (const row of duplicateHashes) {
    const hashValue = row[hashField] as string;

    // Get all files with this hash
    const files = await db
      .selectFrom("mediaFiles")
      .select(["id", "size"])
      .where(hashField, "=", hashValue)
      .orderBy("id", "asc")
      .execute();

    // Filter out deleted files
    const activeFiles = files.filter((f) => !deletedFileIds.has(f.id as number));

    if (activeFiles.length < 2) continue;

    // Check decisions for this group
    const groupKey = hashValue;
    const decisions = await fileDecisionProvider.getDecisionsByReviewGroupKey(groupKey);
    const decidedFileIds = new Set(decisions.map((d) => d.mediaFileId));

    const hasDecisions = decisions.length > 0;
    const allDecided = activeFiles.every((f) => decidedFileIds.has(f.id as number));

    // Build file contexts for auto-selection
    const filesWithContext = await buildFileContexts(dbProvider, activeFiles, groupKey);
    const suggestion = await computeAutoSelection(dbProvider.getTakeoutProvider(), method, filesWithContext, selection);

    groups.push({
      groupKey,
      method,
      fileCount: activeFiles.length,
      totalSize: activeFiles.reduce((sum, f) => sum + (f.size as number), 0),
      suggestedKeepFileId: suggestion.fileId,
      suggestedKeepReason: suggestion.reason,
      hasDecisions,
      allDecided,
    });
  }

  return groups;
}

/**
 * Recompute the actual minimum pHash distance for each group from active pairs
 * in phashMatches. The stored `groupMinDistance` in phashGroupMembers becomes stale
 * when files are excluded (marked for deletion), because it was computed across ALL
 * pairs including those involving now-excluded files.
 *
 * @returns Map of groupAnchorFileId → recomputed minDistance
 */
async function recomputeActiveMinDistances(
  db: DatabaseInstance,
  phashThreshold: number,
  deletedFileIds: Set<number>,
  allMembers: Array<{ mediaFileId: unknown; groupAnchorFileId: unknown }>,
): Promise<Map<number, number>> {
  const recomputedMin = new Map<number, number>();

  if (deletedFileIds.size === 0) return recomputedMin;

  // Build fileId → anchor reverse map from active members
  const fileToAnchor = new Map<number, number>();
  const allActiveIds: number[] = [];
  for (const m of allMembers) {
    const fid = m.mediaFileId as number;
    fileToAnchor.set(fid, m.groupAnchorFileId as number);
    allActiveIds.push(fid);
  }

  if (allActiveIds.length === 0) return recomputedMin;

  // Query matches in chunks to respect SQLite variable limits.
  // We only filter by mediaFileId1 in chunks and post-filter mediaFileId2 in JS
  // (filtering both in SQL would require N*N chunk combinations).
  const activeIdSet = new Set(allActiveIds);

  for (let i = 0; i < allActiveIds.length; i += SQL_CHUNK_SIZE) {
    const chunk = allActiveIds.slice(i, i + SQL_CHUNK_SIZE);
    const chunkMatches = await db
      .selectFrom("phashMatches")
      .select(["mediaFileId1", "mediaFileId2", "distance"])
      .where("distance", "<=", phashThreshold)
      .where("mediaFileId1", "in", chunk)
      .execute();

    for (const match of chunkMatches) {
      const id1 = match.mediaFileId1 as number;
      const id2 = match.mediaFileId2 as number;
      // Post-filter: mediaFileId2 must also be active
      if (!activeIdSet.has(id2)) continue;
      const anchor1 = fileToAnchor.get(id1);
      const anchor2 = fileToAnchor.get(id2);
      // Both files must be in the same group
      if (anchor1 !== undefined && anchor2 !== undefined && anchor1 === anchor2) {
        const dist = match.distance as number;
        const current = recomputedMin.get(anchor1) ?? 64;
        if (dist < current) recomputedMin.set(anchor1, dist);
      }
    }
  }

  return recomputedMin;
}

/**
 * Get pHash logical groups.
 * Reads from pre-computed phashGroupMembers table instead of rebuilding Union-Find.
 */
async function getPhashGroups(
  db: DatabaseInstance,
  dbProvider: DatabaseProvider,
  phashThreshold: number,
  deletedFileIds: Set<number>,
  selection: AutoSelectionOptions,
): Promise<LogicalGroupSummary[]> {
  const phashGroupProvider = dbProvider.getPhashGroupProvider();

  // Ensure groups are computed (lazy init for migration)
  await phashGroupProvider.ensureGroupsComputed(phashThreshold);

  // Single aggregation query for all group summaries (excluding deleted files)
  const groupSummaries = await phashGroupProvider.getGroupSummariesExcluding(deletedFileIds);

  if (groupSummaries.length === 0) return [];

  // Batch get all decisions for all phash group keys (chunked for SQLite variable limits)
  const allGroupKeys = groupSummaries.map((g) => `phash:${g.groupAnchorFileId}`);
  const allDecisions: Array<{ mediaFileId: unknown; reviewGroupKey: unknown }> = [];
  for (let i = 0; i < allGroupKeys.length; i += SQL_CHUNK_SIZE) {
    const chunk = allGroupKeys.slice(i, i + SQL_CHUNK_SIZE);
    const rows = await db
      .selectFrom("fileDecisions")
      .select(["mediaFileId", "reviewGroupKey"])
      .where("reviewGroupKey", "in", chunk)
      .execute();
    allDecisions.push(...rows);
  }
  const decisionSet = new Set(allDecisions.map((d) => `${d.mediaFileId}:${d.reviewGroupKey}`));

  // Batch get all member file IDs per group (for allDecided check and file sizes).
  // For NOT IN with large deletedFileIds, use chunked exclusion post-filter instead.
  let allMembers: Array<{ mediaFileId: unknown; groupAnchorFileId: unknown }>;
  if (deletedFileIds.size === 0) {
    allMembers = await db.selectFrom("phashGroupMembers").select(["mediaFileId", "groupAnchorFileId"]).execute();
  } else if (deletedFileIds.size <= SQL_CHUNK_SIZE) {
    allMembers = await db
      .selectFrom("phashGroupMembers")
      .select(["mediaFileId", "groupAnchorFileId"])
      .where("mediaFileId", "not in", [...deletedFileIds])
      .execute();
  } else {
    // Too many deleted IDs for SQL — fetch all and filter in JS
    const raw = await db.selectFrom("phashGroupMembers").select(["mediaFileId", "groupAnchorFileId"]).execute();
    allMembers = raw.filter((m) => !deletedFileIds.has(m.mediaFileId as number));
  }

  const membersByAnchor = new Map<number, number[]>();
  for (const m of allMembers) {
    const anchor = m.groupAnchorFileId as number;
    if (!membersByAnchor.has(anchor)) membersByAnchor.set(anchor, []);
    (membersByAnchor.get(anchor) as number[]).push(m.mediaFileId as number);
  }

  // Recompute actual min distances from phashMatches for active file pairs.
  // The stored groupMinDistance is stale when excluded files participated in the min pair.
  const recomputedDistances = await recomputeActiveMinDistances(db, phashThreshold, deletedFileIds, allMembers);

  // Apply recomputed distances to summaries
  for (const summary of groupSummaries) {
    const recomputed = recomputedDistances.get(summary.groupAnchorFileId);
    if (recomputed !== undefined) {
      summary.groupMinDistance = recomputed;
    }
  }

  // Batch get file sizes for all member files (chunked for SQLite variable limits)
  const allMemberIds = allMembers.map((m) => m.mediaFileId as number);
  const fileSizeRows: Array<{ id: unknown; size: unknown }> = [];
  for (let i = 0; i < allMemberIds.length; i += SQL_CHUNK_SIZE) {
    const chunk = allMemberIds.slice(i, i + SQL_CHUNK_SIZE);
    const rows = await db.selectFrom("mediaFiles").select(["id", "size"]).where("id", "in", chunk).execute();
    fileSizeRows.push(...rows);
  }
  const fileSizeMap = new Map(fileSizeRows.map((f) => [f.id as number, f.size as number]));

  const groups: LogicalGroupSummary[] = [];

  for (const summary of groupSummaries) {
    const groupKey = `phash:${summary.groupAnchorFileId}`;
    const memberIds = membersByAnchor.get(summary.groupAnchorFileId) ?? [];

    if (memberIds.length < 2) continue;

    const sortedIds = memberIds.sort((a, b) => a - b);

    const hasDecisions = sortedIds.some((id) => decisionSet.has(`${id}:${groupKey}`));
    const allDecided = sortedIds.every((id) => decisionSet.has(`${id}:${groupKey}`));

    // Build file contexts for auto-selection
    const activeFiles = sortedIds.map((id) => ({ id, size: fileSizeMap.get(id) ?? 0 }));
    const filesWithContext = await buildFileContexts(dbProvider, activeFiles, groupKey);
    const suggestion = await computeAutoSelection(
      dbProvider.getTakeoutProvider(),
      "phash",
      filesWithContext,
      selection,
    );

    groups.push({
      groupKey,
      method: "phash",
      fileCount: sortedIds.length,
      totalSize: sortedIds.reduce((sum, id) => sum + (fileSizeMap.get(id) ?? 0), 0),
      suggestedKeepFileId: suggestion.fileId,
      suggestedKeepReason: suggestion.reason,
      hasDecisions,
      allDecided,
      minPhashDistance: summary.groupMinDistance,
    });
  }

  return groups;
}

/**
 * Build FileWithReviewContext for a set of files in a group.
 * Uses batch queries instead of per-file queries for efficiency.
 */
async function buildFileContexts(
  dbProvider: DatabaseProvider,
  files: Array<{ id: number; size: number }>,
  groupKey: string,
): Promise<FileWithReviewContext[]> {
  if (files.length === 0) return [];

  const mediaFileProvider = dbProvider.getMediaFileProvider();
  const imageMetadataProvider = dbProvider.getImageMetadataProvider();
  const videoMetadataProvider = dbProvider.getVideoMetadataProvider();
  const scanFolderProvider = dbProvider.getScanFolderProvider();
  const fileDecisionProvider = dbProvider.getFileDecisionProvider();

  const ids = files.map((f) => f.id);

  // 4 batch queries instead of 4*N individual queries
  const [mediaFiles, imageMetadata, videoMetadata, decisions, folders] = await Promise.all([
    mediaFileProvider.getMediaFilesByIds(ids),
    imageMetadataProvider.getByMediaFileIds(ids),
    videoMetadataProvider.getVideoMetadataByMediaFileIds(ids),
    fileDecisionProvider.getDecisionsByGroupKeyAndFileIds(groupKey, ids),
    scanFolderProvider.getAllScanFolders(),
  ]);

  // Index into Maps for O(1) lookup
  const fileMap = new Map(mediaFiles.map((f) => [f.id, f]));
  const imgMetaMap = new Map(imageMetadata.map((m) => [m.mediaFileId, m]));
  const vidMetaMap = new Map(videoMetadata.map((m) => [m.mediaFileId, m]));
  const decisionMap = new Map(decisions.map((d) => [d.mediaFileId, d]));
  const folderMap = new Map(folders.map((f) => [f.id, f]));

  // Build contexts from maps (zero additional queries)
  const contexts: FileWithReviewContext[] = [];
  for (const fileRef of files) {
    const file = fileMap.get(fileRef.id);
    if (!file) continue;

    let metadata: ImageMetadata | VideoMetadata | null = null;
    if (file.fileType === "image") {
      metadata = imgMetaMap.get(file.id) ?? null;
    } else if (file.fileType === "video") {
      metadata = vidMetaMap.get(file.id) ?? null;
    }

    const folder = folderMap.get(file.scanFolderId);
    const folderPriority = folder?.priority ?? 3;

    const decision = decisionMap.get(file.id) ?? null;

    contexts.push({
      file,
      metadata,
      folderPriority,
      decision,
    });
  }

  return contexts;
}

/**
 * Get all files in a logical group with full context.
 */
export async function getLogicalGroupFiles(params: {
  method: FileDecisionMethod;
  groupKey: string;
  phashThreshold?: number;
}): Promise<{ files: FileWithReviewContext[]; suggestion: AutoSelection }> {
  const { method, groupKey, phashThreshold = 5 } = params;
  const tTotal = performance.now();
  const dbProvider = await DatabaseProvider.getInstance();
  const db = dbProvider.getClient().getDb();
  const fileDecisionProvider = dbProvider.getFileDecisionProvider();
  const phashMatchProvider = dbProvider.getPhashMatchProvider();

  let t0 = performance.now();
  const deletedFileIds = await fileDecisionProvider.getDeletedFileIds();
  perfLog.info(
    `getLogicalGroupFiles deletedFileIds: ${(performance.now() - t0).toFixed(1)}ms (${deletedFileIds.size} ids)`,
  );

  let fileIds: number[];
  let phashDistanceMap: Map<string, number> | undefined;
  let clipClosest: Map<number, number> | undefined;

  if (method === "sha256" || method === "content_hash") {
    const hashField = method === "sha256" ? "sha256Hash" : "contentHash";
    const files = await db
      .selectFrom("mediaFiles")
      .select(["id", "size"])
      .where(hashField, "=", groupKey)
      .orderBy("id", "asc")
      .execute();
    fileIds = files.filter((f) => !deletedFileIds.has(f.id as number)).map((f) => f.id as number);
  } else if (method === "clip") {
    const anchorId = clipAnchorId(groupKey);
    const group = (await loadClipGroups(dbProvider, deletedFileIds)).find((g) => g.anchorId === anchorId);
    fileIds = group?.memberIds ?? [];
    clipClosest = group?.closest;
  } else {
    // pHash: groupKey is "phash:{anchorFileId}"
    const anchorId = Number.parseInt(groupKey.replace("phash:", ""), 10);
    if (Number.isNaN(anchorId)) {
      throw new Error(`Invalid phash group key: ${groupKey}`);
    }

    const phashGroupProvider = dbProvider.getPhashGroupProvider();

    t0 = performance.now();
    await phashGroupProvider.ensureGroupsComputed(phashThreshold);
    perfLog.info(`getLogicalGroupFiles ensureGroupsComputed: ${(performance.now() - t0).toFixed(1)}ms`);

    // Single indexed query for all file IDs in the group
    t0 = performance.now();
    const memberFileIds = await phashGroupProvider.getGroupFileIds(anchorId);
    fileIds = memberFileIds.filter((id) => !deletedFileIds.has(id)).sort((a, b) => a - b);
    perfLog.info(
      `getLogicalGroupFiles getGroupFileIds: ${(performance.now() - t0).toFixed(1)}ms (${fileIds.length} files)`,
    );

    // Get distance map from phashMatches for just these files
    if (fileIds.length > 0) {
      t0 = performance.now();
      const groupMatches = await phashMatchProvider.getMatchesForFileIds(fileIds, phashThreshold);
      phashDistanceMap = new Map<string, number>();
      for (const match of groupMatches) {
        const key = `${Math.min(match.mediaFileId1, match.mediaFileId2)}:${Math.max(match.mediaFileId1, match.mediaFileId2)}`;
        phashDistanceMap.set(key, match.distance);
      }
      perfLog.info(
        `getLogicalGroupFiles distanceMap: ${(performance.now() - t0).toFixed(1)}ms (${groupMatches.length} matches)`,
      );
    }
  }

  // Build file contexts with batch queries
  const mediaFileProvider = dbProvider.getMediaFileProvider();
  const imageMetadataProvider = dbProvider.getImageMetadataProvider();
  const videoMetadataProvider = dbProvider.getVideoMetadataProvider();
  const scanFolderProvider = dbProvider.getScanFolderProvider();

  t0 = performance.now();
  const [mediaFiles, imageMetadata, videoMetadata, decisions, folders] = await Promise.all([
    mediaFileProvider.getMediaFilesByIds(fileIds),
    imageMetadataProvider.getByMediaFileIds(fileIds),
    videoMetadataProvider.getVideoMetadataByMediaFileIds(fileIds),
    fileDecisionProvider.getDecisionsByGroupKeyAndFileIds(groupKey, fileIds),
    scanFolderProvider.getAllScanFolders(),
  ]);
  perfLog.info(`getLogicalGroupFiles batch context queries: ${(performance.now() - t0).toFixed(1)}ms`);

  // Index into Maps for O(1) lookup
  const fileMap = new Map(mediaFiles.map((f) => [f.id, f]));
  const imgMetaMap = new Map(imageMetadata.map((m) => [m.mediaFileId, m]));
  const vidMetaMap = new Map(videoMetadata.map((m) => [m.mediaFileId, m]));
  const decisionMap = new Map(decisions.map((d) => [d.mediaFileId, d]));
  const folderMap = new Map(folders.map((f) => [f.id, f]));

  const files: FileWithReviewContext[] = [];
  for (const fileId of fileIds) {
    const file = fileMap.get(fileId);
    if (!file) continue;

    let metadata: ImageMetadata | VideoMetadata | null = null;
    if (file.fileType === "image") {
      metadata = imgMetaMap.get(file.id) ?? null;
    } else if (file.fileType === "video") {
      metadata = vidMetaMap.get(file.id) ?? null;
    }

    const folder = folderMap.get(file.scanFolderId);
    const folderPriority = folder?.priority ?? 3;
    const decision = decisionMap.get(file.id) ?? null;

    const ctx: FileWithReviewContext = {
      file,
      metadata,
      folderPriority,
      decision,
    };

    // Add phash distance from pre-built map
    if (method === "phash" && phashDistanceMap) {
      const anchorId = Number.parseInt(groupKey.replace("phash:", ""), 10);
      if (fileId !== anchorId) {
        const key = `${Math.min(fileId, anchorId)}:${Math.max(fileId, anchorId)}`;
        ctx.phashDistance = phashDistanceMap.get(key) ?? undefined;
      } else {
        ctx.phashDistance = 0;
      }
    }

    const closest = clipClosest?.get(fileId);
    if (closest !== undefined) ctx.clipDistance = closest;

    files.push(ctx);
  }

  const suggestion = await computeAutoSelection(
    dbProvider.getTakeoutProvider(),
    method,
    files,
    selectionOptions(dbProvider),
  );

  perfLog.info(
    `getLogicalGroupFiles TOTAL: ${(performance.now() - tTotal).toFixed(1)}ms (${files.length} files, method=${method})`,
  );
  return { files, suggestion };
}

/**
 * Count pending hash-based groups using batch queries instead of building full file contexts.
 * Uses 3 queries total instead of ~N*5 per hash method.
 */
async function getHashGroupPendingCount(
  db: DatabaseInstance,
  method: "sha256" | "content_hash",
  deletedFileIds: Set<number>,
): Promise<number> {
  const hashField = method === "sha256" ? "sha256Hash" : "contentHash";

  // 1. Find all duplicate hashes (1 query)
  const duplicateHashes = await db
    .selectFrom("mediaFiles")
    .select([hashField])
    .select((eb) => eb.fn.count("id").as("count"))
    .where(hashField, "is not", null)
    .groupBy(hashField)
    .having((eb) => eb.fn.count("id"), ">", 1)
    .execute();

  if (duplicateHashes.length === 0) return 0;

  const hashValues = duplicateHashes.map((r) => r[hashField] as string);

  // 2. Get all files for these hashes (chunked for SQLite variable limits)
  const allFiles: Array<{ id: unknown; [key: string]: unknown }> = [];
  for (let i = 0; i < hashValues.length; i += SQL_CHUNK_SIZE) {
    const chunk = hashValues.slice(i, i + SQL_CHUNK_SIZE);
    const rows = await db.selectFrom("mediaFiles").select(["id", hashField]).where(hashField, "in", chunk).execute();
    allFiles.push(...rows);
  }

  // 3. Get all decisions for these group keys (chunked for SQLite variable limits)
  const allDecisions: Array<{ mediaFileId: unknown; reviewGroupKey: unknown }> = [];
  for (let i = 0; i < hashValues.length; i += SQL_CHUNK_SIZE) {
    const chunk = hashValues.slice(i, i + SQL_CHUNK_SIZE);
    const rows = await db
      .selectFrom("fileDecisions")
      .select(["mediaFileId", "reviewGroupKey"])
      .where("reviewGroupKey", "in", chunk)
      .execute();
    allDecisions.push(...rows);
  }

  const decisionSet = new Set(allDecisions.map((d) => `${d.mediaFileId}:${d.reviewGroupKey}`));

  // Group files by hash and count pending groups
  const filesByHash = new Map<string, number[]>();
  for (const file of allFiles) {
    const hash = file[hashField] as string;
    if (!filesByHash.has(hash)) filesByHash.set(hash, []);
    (filesByHash.get(hash) as number[]).push(file.id as number);
  }

  let pendingCount = 0;
  for (const [hash, fileIds] of filesByHash) {
    const activeIds = fileIds.filter((id) => !deletedFileIds.has(id));
    if (activeIds.length < 2) continue;

    const allDecided = activeIds.every((id) => decisionSet.has(`${id}:${hash}`));
    if (!allDecided) pendingCount++;
  }

  return pendingCount;
}

/**
 * Count pending pHash groups using the pre-computed phashGroupMembers table.
 * Uses 2-3 indexed queries instead of full table scan + Union-Find.
 */
async function getPhashGroupCounts(
  db: DatabaseInstance,
  dbProvider: DatabaseProvider,
  phashThreshold: number,
  deletedFileIds: Set<number>,
): Promise<{ pending: number; identical: number; similar: number }> {
  const phashGroupProvider = dbProvider.getPhashGroupProvider();

  // Ensure groups are computed (lazy init for migration)
  await phashGroupProvider.ensureGroupsComputed(phashThreshold);

  // Single aggregation query for group summaries (excluding deleted files)
  const groupSummaries = await phashGroupProvider.getGroupSummariesExcluding(deletedFileIds);

  if (groupSummaries.length === 0) return { pending: 0, identical: 0, similar: 0 };

  // We need per-group file IDs to check if all files have decisions.
  // Chunked NOT IN for large deletedFileIds sets.
  let allMembers: Array<{ mediaFileId: unknown; groupAnchorFileId: unknown }>;
  if (deletedFileIds.size === 0) {
    allMembers = await db.selectFrom("phashGroupMembers").select(["mediaFileId", "groupAnchorFileId"]).execute();
  } else if (deletedFileIds.size <= SQL_CHUNK_SIZE) {
    allMembers = await db
      .selectFrom("phashGroupMembers")
      .select(["mediaFileId", "groupAnchorFileId"])
      .where("mediaFileId", "not in", [...deletedFileIds])
      .execute();
  } else {
    const raw = await db.selectFrom("phashGroupMembers").select(["mediaFileId", "groupAnchorFileId"]).execute();
    allMembers = raw.filter((m) => !deletedFileIds.has(m.mediaFileId as number));
  }

  const membersByAnchor = new Map<number, number[]>();
  for (const m of allMembers) {
    const anchor = m.groupAnchorFileId as number;
    if (!membersByAnchor.has(anchor)) membersByAnchor.set(anchor, []);
    (membersByAnchor.get(anchor) as number[]).push(m.mediaFileId as number);
  }

  // Recompute actual min distances from phashMatches for active file pairs
  const recomputedDistances = await recomputeActiveMinDistances(db, phashThreshold, deletedFileIds, allMembers);

  // Apply recomputed distances to summaries
  for (const summary of groupSummaries) {
    const recomputed = recomputedDistances.get(summary.groupAnchorFileId);
    if (recomputed !== undefined) {
      summary.groupMinDistance = recomputed;
    }
  }

  // Batch get all decisions for all phash group keys (chunked for SQLite variable limits)
  const allGroupKeys = groupSummaries.map((g) => `phash:${g.groupAnchorFileId}`);
  const allDecisions: Array<{ mediaFileId: unknown; reviewGroupKey: unknown }> = [];
  for (let i = 0; i < allGroupKeys.length; i += SQL_CHUNK_SIZE) {
    const chunk = allGroupKeys.slice(i, i + SQL_CHUNK_SIZE);
    const rows = await db
      .selectFrom("fileDecisions")
      .select(["mediaFileId", "reviewGroupKey"])
      .where("reviewGroupKey", "in", chunk)
      .execute();
    allDecisions.push(...rows);
  }

  const decisionSet = new Set(allDecisions.map((d) => `${d.mediaFileId}:${d.reviewGroupKey}`));

  let pending = 0;
  let identical = 0;
  let similar = 0;

  for (const summary of groupSummaries) {
    const groupKey = `phash:${summary.groupAnchorFileId}`;
    const memberIds = membersByAnchor.get(summary.groupAnchorFileId) ?? [];
    if (memberIds.length < 2) continue;

    const allDecided = memberIds.every((id) => decisionSet.has(`${id}:${groupKey}`));
    if (allDecided) continue;

    pending++;
    if (summary.groupMinDistance === 0) {
      identical++;
    } else {
      similar++;
    }
  }

  return { pending, identical, similar };
}

/**
 * Get review summary statistics.
 * Uses lightweight count queries instead of building full file contexts.
 */
export async function getReviewSummary(): Promise<ReviewSummary> {
  const tTotal = performance.now();
  const dbProvider = await DatabaseProvider.getInstance();
  const db = dbProvider.getClient().getDb();
  const fileDecisionProvider = dbProvider.getFileDecisionProvider();

  // Get deleted file IDs once (shared across all counts)
  const deletedFileIds = await fileDecisionProvider.getDeletedFileIds();

  // Run all counts in parallel
  const [pendingSha256, pendingContentHash, phashCounts, clipGroups, counts, conflicts] = await Promise.all([
    getHashGroupPendingCount(db, "sha256", deletedFileIds),
    getHashGroupPendingCount(db, "content_hash", deletedFileIds),
    getPhashGroupCounts(db, dbProvider, 5, deletedFileIds),
    getClipGroupSummaries(dbProvider, deletedFileIds),
    fileDecisionProvider.getCountByAction(),
    fileDecisionProvider.getConflictingFiles(),
  ]);

  perfLog.info(`getReviewSummary TOTAL: ${(performance.now() - tTotal).toFixed(1)}ms`);

  return {
    pendingSha256,
    pendingContentHash,
    pendingPhash: phashCounts.pending,
    pendingClip: clipGroups.filter((g) => !g.allDecided).length,
    decidedKeep: counts.keep,
    decidedDelete: counts.delete,
    phashIdenticalPairs: phashCounts.identical,
    phashSimilarPairs: phashCounts.similar,
    conflictCount: conflicts.length,
  };
}
