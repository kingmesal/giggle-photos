// ⚠️ FRAGILE: See _FRAGILE.md — feeds the deletion plan.
/**
 * Load everything planDeletions needs from the database: all decisions, the CURRENT members of
 * every group with a delete decision (from hashes / pHash groups, not just from who has decisions),
 * motion and edited pairs of the candidates, the partners' own exact-copy groups (so removing a
 * motion partner never removes the last copy of that video either), and their own sidecars.
 */
import { existsSync } from "node:fs";
import type { DatabaseProvider } from "../db/database-provider";
import type { PlanDecision, PlanFile, PlanInput, PlanSidecar } from "./deletion-plan";

type Db = Pick<
  DatabaseProvider,
  | "getFileDecisionProvider"
  | "getMediaFileProvider"
  | "getPhashGroupProvider"
  | "getTakeoutProvider"
  | "getScanFolderProvider"
>;

export interface LoadedPlanInput {
  input: PlanInput;
  /** mediaFileId → its scan folder path (quarantine keeps paths relative to it). */
  scanFolderPathOf: Map<number, string>;
}

export async function loadPlanInput(db: Db): Promise<LoadedPlanInput> {
  const decisionsProvider = db.getFileDecisionProvider();
  const media = db.getMediaFileProvider();
  const takeout = db.getTakeoutProvider();
  const deletes = await decisionsProvider.getDecisionsByAction("delete");
  const keeps = await decisionsProvider.getDecisionsByAction("keep");
  const decisions: PlanDecision[] = [...keeps, ...deletes].map((d) => ({
    mediaFileId: d.mediaFileId,
    action: d.action,
    reviewGroupKey: d.reviewGroupKey,
  }));
  const candidateIds = [...new Set(deletes.map((d) => d.mediaFileId))];

  const groups = new Map<string, number[]>();
  const addGroup = (key: string, ids: number[]) => groups.set(key, [...new Set([...(groups.get(key) ?? []), ...ids])]);
  for (const d of deletes) {
    if (groups.has(d.reviewGroupKey)) continue;
    let members: number[] = [];
    if (d.method === "phash") {
      members = await db
        .getPhashGroupProvider()
        .getGroupFileIds(Number.parseInt(d.reviewGroupKey.replace("phash:", ""), 10));
    } else if (d.method === "sha256") {
      members = (await media.findBySha256Hash(d.reviewGroupKey)).map((f) => f.id);
    } else if (d.method === "content_hash") {
      members = (await media.findByContentHash(d.reviewGroupKey)).map((f) => f.id);
    }
    const decided = decisions.filter((x) => x.reviewGroupKey === d.reviewGroupKey).map((x) => x.mediaFileId);
    addGroup(d.reviewGroupKey, [...members, ...decided]);
  }

  const motionPairs: PlanInput["motionPairs"] = [];
  const editedPairs: PlanInput["editedPairs"] = [];
  const seenPairs = new Set<number>();
  const partnerIds = new Set<number>();
  for (const id of candidateIds) {
    for (const p of await takeout.getPairsForMedia(id)) {
      if (seenPairs.has(p.id)) continue;
      seenPairs.add(p.id);
      const pair = { primaryId: p.primaryFileId, secondaryId: p.secondaryFileId };
      (p.kind === "motion" ? motionPairs : editedPairs).push(pair);
      partnerIds.add(p.primaryFileId === id ? p.secondaryFileId : p.primaryFileId);
    }
  }

  const ids = new Set([...candidateIds, ...partnerIds, ...[...groups.values()].flat()]);
  const files = new Map<number, PlanFile>();
  const scanFolderIdOf = new Map<number, number>();
  for (const id of ids) {
    const file = await media.getMediaFileById(id);
    if (!file) continue;
    files.set(id, { id, path: file.path, existsOnDisk: existsSync(file.path) });
    scanFolderIdOf.set(id, file.scanFolderId);
    if (partnerIds.has(id) && file.sha256Hash) {
      addGroup(
        `sha256:${file.sha256Hash}`,
        (await media.findBySha256Hash(file.sha256Hash)).map((f) => f.id),
      );
    }
  }
  for (const id of [...groups.values()].flat()) {
    if (files.has(id)) continue;
    const file = await media.getMediaFileById(id);
    if (file) {
      files.set(id, { id, path: file.path, existsOnDisk: existsSync(file.path) });
      scanFolderIdOf.set(id, file.scanFolderId);
    }
  }

  const sidecars: PlanSidecar[] = [];
  for (const id of new Set([...candidateIds, ...partnerIds])) {
    for (const s of await takeout.getSidecarsForMedia(id)) {
      if (s.matchMethod !== "album_reference" && existsSync(s.path))
        sidecars.push({ id: s.id, path: s.path, mediaFileId: id });
    }
  }

  const folderPath = new Map((await db.getScanFolderProvider().getAllScanFolders()).map((f) => [f.id, f.path]));
  const scanFolderPathOf = new Map(
    [...scanFolderIdOf].map(([fileId, folderId]) => [fileId, folderPath.get(folderId) ?? ""]),
  );
  return { input: { decisions, files, groups, motionPairs, editedPairs, sidecars }, scanFolderPathOf };
}
