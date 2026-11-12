// FRAGILE: See _FRAGILE.md - This permanently deletes files
import { existsSync } from "node:fs";
import { unlink } from "node:fs/promises";
import { getTrashAvailability } from "../config/user-config";
import { DatabaseProvider } from "../db/database-provider";
import { getLogger } from "../logging/logger";

const log = getLogger("core:actions");

import type { MediaFile } from "../zod/media-file";

/**
 * Options for applying deletion decisions.
 */
export interface ApplyDecisionOptions {
  /** If true, move to trash instead of permanent delete (default: false) */
  moveToTrash?: boolean;
  /** If true, don't actually delete, just return what would be deleted */
  dryRun?: boolean;
  /** Progress callback for UI updates */
  onProgress?: (completed: number, total: number, currentFile: string) => void;
}

/**
 * Result of applying deletion decisions.
 */
export interface ApplyDecisionResult {
  /** Files successfully deleted */
  success: number;
  /** Files that failed to delete */
  failed: number;
  /** Files skipped (not found, is the keep file, etc.) */
  skipped: number;
  /** Detailed error information for failed deletions */
  errors: Array<{ fileId: number; path: string; error: string }>;
}

/**
 * Validation result for a file deletion.
 */
interface ValidationResult {
  valid: boolean;
  reason?: string;
}

/**
 * Validates whether a file can be safely deleted.
 * SAFETY: Never deletes a file that has a "keep" decision.
 */
function validateFileDeletion(file: MediaFile): ValidationResult {
  // Check if file still exists on disk
  if (!existsSync(file.path)) {
    return { valid: false, reason: "File does not exist on disk" };
  }

  return { valid: true };
}

/**
 * Attempts to move a file to the system trash using the best available command.
 * Uses `getTrashAvailability()` to determine which command to use:
 *   Linux:   `gio trash <file>` or `trash <file>`
 *   macOS:   `trash <file>` or `gio trash <file>`
 *   Windows: PowerShell + Microsoft.VisualBasic.FileIO → Recycle Bin
 *
 * @returns true if moved to trash, false if no trash command available or it failed
 */
async function moveToTrash(filePath: string): Promise<boolean> {
  const { available, command } = getTrashAvailability();
  if (!available || !command) return false;

  try {
    const { spawn } = await import("node:child_process");
    let bin: string;
    let args: string[];

    if (command === "powershell") {
      // Windows: use PowerShell to send to Recycle Bin via VisualBasic API
      const escaped = filePath.replace(/'/g, "''");
      bin = "powershell";
      args = [
        "-NoProfile",
        "-Command",
        `Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile('${escaped}', 'OnlyErrorDialogs', 'SendToRecycleBin')`,
      ];
    } else if (command === "gio trash") {
      bin = "gio";
      args = ["trash", filePath];
    } else {
      bin = "trash";
      args = [filePath];
    }

    const proc = spawn(bin, args, { stdio: "ignore" });

    return new Promise((resolve) => {
      proc.on("error", () => resolve(false));
      proc.on("close", (code) => resolve(code === 0));
    });
  } catch {
    return false;
  }
}

/**
 * Deletes a single file, either to trash or permanently.
 * Logs the operation with timestamp.
 */
async function deleteFile(
  filePath: string,
  useTrash: boolean,
  dryRun: boolean,
): Promise<{ success: boolean; error?: string }> {
  if (dryRun) {
    log.info("[DRY RUN] Would delete file", { path: filePath, useTrash });
    return { success: true };
  }

  try {
    if (useTrash) {
      const movedToTrash = await moveToTrash(filePath);
      if (movedToTrash) {
        log.info("File moved to trash", {
          path: filePath,
          timestamp: new Date().toISOString(),
        });
        return { success: true };
      }
      // Fall back to permanent deletion
      log.warn("Trash not available, falling back to permanent deletion", {
        path: filePath,
      });
    }

    await unlink(filePath);
    log.info("File permanently deleted", {
      path: filePath,
      timestamp: new Date().toISOString(),
    });
    return { success: true };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    log.error("Failed to delete file", {
      path: filePath,
      error: errorMessage,
      timestamp: new Date().toISOString(),
    });
    return { success: false, error: errorMessage };
  }
}

/**
 * Applies deletion decisions based on fileDecisions table.
 *
 * Queries all files with action = "delete" in fileDecisions,
 * deletes them from disk, and removes the mediaFile record
 * (which cascades to phashMatches, fileDecisions, etc.).
 *
 * SAFETY MEASURES:
 * - Never deletes a file with action = "keep"
 * - Cross-checks that the file has a "delete" decision before proceeding
 * - Verifies file exists before deletion
 * - Logs all operations with timestamps
 * - Supports dry run mode for testing
 *
 * @param options - Options controlling deletion behavior
 * @returns Summary of deletion results
 */
export async function applyDeletions(options?: ApplyDecisionOptions): Promise<ApplyDecisionResult> {
  const { moveToTrash: useTrash = false, dryRun = false, onProgress } = options ?? {};

  const result: ApplyDecisionResult = {
    success: 0,
    failed: 0,
    skipped: 0,
    errors: [],
  };

  log.info("Starting applyDeletions", {
    dryRun,
    useTrash,
    timestamp: new Date().toISOString(),
  });

  const db = await DatabaseProvider.getInstance();
  const fileDecisionProvider = db.getFileDecisionProvider();
  const mediaFileProvider = db.getMediaFileProvider();

  // Get all files marked for deletion
  const deleteDecisions = await fileDecisionProvider.getDecisionsByAction("delete");

  if (deleteDecisions.length === 0) {
    log.info("No files marked for deletion");
    return result;
  }

  // Deduplicate by mediaFileId (a file may be marked delete in multiple groups)
  const uniqueFileIds = new Set(deleteDecisions.map((d) => d.mediaFileId));
  const filesToDelete: Array<{ file: MediaFile; decisionIds: number[] }> = [];

  for (const fileId of uniqueFileIds) {
    // SAFETY: Verify this file doesn't also have a "keep" decision
    const allDecisions = await fileDecisionProvider.getDecisionsByMediaFileId(fileId);
    const hasKeepDecision = allDecisions.some((d) => d.action === "keep");

    if (hasKeepDecision) {
      log.error("BUG: File has both keep and delete decisions — should be resolved before apply", { fileId });
      result.skipped++;
      continue;
    }

    const file = await mediaFileProvider.getMediaFileById(fileId);
    if (!file) {
      log.warn("Decision references non-existent file", { mediaFileId: fileId });
      result.skipped++;
      continue;
    }

    filesToDelete.push({
      file,
      decisionIds: allDecisions.filter((d) => d.action === "delete").map((d) => d.id),
    });
  }

  const totalFiles = filesToDelete.length;
  log.info("Files identified for deletion", { count: totalFiles, dryRun });

  // Delete files
  let completed = 0;

  for (const { file } of filesToDelete) {
    const validation = validateFileDeletion(file);

    if (!validation.valid) {
      log.info("Skipping file", {
        fileId: file.id,
        path: file.path,
        reason: validation.reason,
      });
      result.skipped++;
      completed++;
      onProgress?.(completed, totalFiles, file.path);
      continue;
    }

    // Attempt to delete the file
    const deleteResult = await deleteFile(file.path, useTrash, dryRun);

    if (deleteResult.success) {
      result.success++;

      // Update database — delete the media file record (cascades to fileDecisions, phashMatches, etc.)
      if (!dryRun) {
        try {
          await mediaFileProvider.deleteMediaFile(file.id);

          log.debug("Database records removed", {
            mediaFileId: file.id,
          });
        } catch (dbError) {
          const errorMessage = dbError instanceof Error ? dbError.message : String(dbError);
          log.error("Failed to update database after file deletion", {
            fileId: file.id,
            path: file.path,
            error: errorMessage,
          });
          // Note: File was deleted but DB update failed - this is a partial failure
          // The file is gone but the DB still references it
        }
      }
    } else {
      result.failed++;
      result.errors.push({
        fileId: file.id,
        path: file.path,
        error: deleteResult.error ?? "Unknown error",
      });
    }

    completed++;
    onProgress?.(completed, totalFiles, file.path);
  }

  // Recompute pre-computed group membership table after deletions
  // (CASCADE deletes phashMatches rows, so components may have changed)
  if (!dryRun && result.success > 0) {
    const phashGroupProvider = db.getPhashGroupProvider();
    await phashGroupProvider.recomputeGroups();
  }

  log.info("applyDeletions completed", {
    ...result,
    dryRun,
    timestamp: new Date().toISOString(),
  });

  return result;
}

/**
 * Preview what would be deleted without actually deleting anything.
 * Convenience wrapper around applyDeletions with dryRun=true.
 */
export async function previewDeletions(
  onProgress?: (completed: number, total: number, currentFile: string) => void,
): Promise<ApplyDecisionResult> {
  return applyDeletions({ dryRun: true, onProgress });
}

// Legacy exports for backward compatibility during migration
// These will be removed when old tables are dropped in Phase 6
export const applyDecisions = applyDeletions;
export const previewDecisions = previewDeletions;
