// FRAGILE: See _FRAGILE.md - This removes files from the user's library
/**
 * Apply the user's delete decisions (RFD-003 §E.5, §F).
 *
 * 1. loadPlanInput + planDeletions decide exactly what to remove (never a kept file, never the last
 *    copy of a group, never half a motion pair, sidecars along with their own file) and why anything
 *    is refused. A dry run returns that plan and changes nothing — run it first.
 * 2. Each planned file is removed in one of three ways: moved into the quarantine folder (default
 *    for the Takeout run: undoable, keeps the Takeout layout), moved to the system trash, or deleted
 *    permanently. Its own sidecars follow the same way, only after the file itself succeeded,
 *    including a `<file>.xmp` next to it (capture dates, RFD-006).
 * 3. Database records are removed only after the file was removed.
 */
import { existsSync } from "node:fs";
import { DatabaseProvider } from "../db/database-provider";
import { getLogger } from "../logging/logger";
import { type DeletionPlan, type PlannedRemoval, planDeletions } from "./deletion-plan";
import { deleteFile } from "./file-removal";
import { loadPlanInput } from "./plan-loader";
import { quarantineFile } from "./quarantine";

const log = getLogger("core:actions");

export interface ApplyDecisionOptions {
  /** Move removed files (and their sidecars) here instead of deleting them. Takes precedence. */
  quarantineRoot?: string | null;
  /** If true (and no quarantine), move to the system trash instead of deleting permanently. */
  moveToTrash?: boolean;
  /** If true, change nothing: return the plan of what would happen. */
  dryRun?: boolean;
  onProgress?: (completed: number, total: number, currentFile: string) => void;
}

export interface ApplyDecisionResult {
  /** Files removed (or, in a dry run, that would be removed). */
  success: number;
  failed: number;
  /** Files refused by the plan's safety rules or missing on disk. */
  skipped: number;
  errors: Array<{ fileId: number; path: string; error: string }>;
  /** How files were (or would be) removed. */
  mode: "quarantine" | "trash" | "delete";
  sidecarsRemoved: number;
  /** The plan: what is removed and why anything was refused. */
  plan: {
    remove: { fileId: number; path: string; because: PlannedRemoval["because"]; sidecars: number }[];
    skipped: DeletionPlan["skipped"];
  };
}

async function removeOne(
  path: string,
  kind: "media" | "sidecar",
  mode: ApplyDecisionResult["mode"],
  scanFolderPath: string,
  quarantineRoot: string | null,
) {
  if (mode === "quarantine") {
    try {
      await quarantineFile(quarantineRoot as string, scanFolderPath, path, kind);
      log.info("Moved to quarantine", { path, kind, timestamp: new Date().toISOString() });
      return { success: true as const };
    } catch (error) {
      return { success: false as const, error: error instanceof Error ? error.message : String(error) };
    }
  }
  return deleteFile(path, mode === "trash", false);
}

/** Providers used (DatabaseProvider in the app; real providers over a test database in tests). */
export type ApplyDb = Parameters<typeof loadPlanInput>[0];

export async function applyDeletions(options?: ApplyDecisionOptions, database?: ApplyDb): Promise<ApplyDecisionResult> {
  const { moveToTrash: useTrash = false, dryRun = false, onProgress } = options ?? {};
  const quarantineRoot = options?.quarantineRoot || null;
  const mode: ApplyDecisionResult["mode"] = quarantineRoot ? "quarantine" : useTrash ? "trash" : "delete";
  log.info("Starting applyDeletions", { dryRun, mode, quarantineRoot, timestamp: new Date().toISOString() });

  const db = database ?? (await DatabaseProvider.getInstance());
  const { input, scanFolderPathOf } = await loadPlanInput(db);
  const plan = planDeletions(input);
  const result: ApplyDecisionResult = {
    success: 0,
    failed: 0,
    skipped: plan.skipped.length,
    errors: [],
    mode,
    sidecarsRemoved: 0,
    plan: {
      remove: plan.remove.map((r) => ({
        fileId: r.fileId,
        path: r.path,
        because: r.because,
        sidecars: r.sidecars.length,
      })),
      skipped: plan.skipped,
    },
  };
  for (const s of plan.skipped) log.info("Not removing file", s);

  if (dryRun) {
    result.success = plan.remove.length;
    result.sidecarsRemoved = plan.remove.reduce((n, r) => n + r.sidecars.length, 0);
    log.info("[DRY RUN] Deletion plan", { remove: plan.remove.length, skipped: plan.skipped.length, mode });
    return result;
  }

  const media = db.getMediaFileProvider();
  const takeout = db.getTakeoutProvider();
  let completed = 0;
  for (const removal of plan.remove) {
    const scanFolderPath = scanFolderPathOf.get(removal.fileId) ?? "";
    const outcome = await removeOne(removal.path, "media", mode, scanFolderPath, quarantineRoot);
    if (!outcome.success) {
      result.failed++;
      result.errors.push({ fileId: removal.fileId, path: removal.path, error: outcome.error ?? "Unknown error" });
    } else {
      result.success++;
      const movedSidecars: number[] = [];
      for (const sidecar of removal.sidecars) {
        const s = await removeOne(sidecar.path, "sidecar", mode, scanFolderPath, quarantineRoot);
        if (s.success) movedSidecars.push(sidecar.id);
        else result.errors.push({ fileId: removal.fileId, path: sidecar.path, error: s.error ?? "Unknown error" });
      }
      result.sidecarsRemoved += movedSidecars.length;
      const xmp = `${removal.path}.xmp`;
      if (existsSync(xmp)) {
        const x = await removeOne(xmp, "sidecar", mode, scanFolderPath, quarantineRoot);
        if (x.success) result.sidecarsRemoved++;
        else result.errors.push({ fileId: removal.fileId, path: xmp, error: x.error ?? "Unknown error" });
      }
      try {
        await takeout.deleteSidecars(movedSidecars);
        await media.deleteMediaFile(removal.fileId); // cascades to decisions, matches, pairs
      } catch (dbError) {
        // The file is gone but its record remains; a re-scan reconciles it.
        log.error("Failed to update database after removal", {
          fileId: removal.fileId,
          path: removal.path,
          error: dbError instanceof Error ? dbError.message : String(dbError),
        });
      }
    }
    onProgress?.(++completed, plan.remove.length, removal.path);
  }

  // phashMatches rows cascade away with removed files, so group membership may have changed.
  if (result.success > 0) await db.getPhashGroupProvider().recomputeGroups();
  log.info("applyDeletions completed", { ...result, plan: undefined, timestamp: new Date().toISOString() });
  return result;
}

/** What would happen, without changing anything. */
export async function previewDeletions(
  onProgress?: (completed: number, total: number, currentFile: string) => void,
): Promise<ApplyDecisionResult> {
  return applyDeletions({ dryRun: true, onProgress });
}

// Legacy exports for backward compatibility during migration
export const applyDecisions = applyDeletions;
export const previewDecisions = previewDeletions;
