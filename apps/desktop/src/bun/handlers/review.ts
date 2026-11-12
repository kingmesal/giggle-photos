import type { ApplyDecisionResult } from "@giggle-photos/core/actions/applyDecisions";
import { applyDeletions } from "@giggle-photos/core/actions/applyDecisions";
import { DatabaseProvider } from "@giggle-photos/core/db/database-provider";
import { getLogger } from "@giggle-photos/core/logging/logger";
import {
  type AutoSelection,
  type FileWithReviewContext,
  getLogicalGroupFiles,
  getPendingGroups,
  getReviewSummary,
  type LogicalGroupSummary,
  type ReviewSummary,
} from "@giggle-photos/core/review/review-queries";
import type { FileDecisionMethod } from "@giggle-photos/core/zod/file-decision";

const log = getLogger("rpc:review");

/**
 * Get pending logical groups for a detection method with pagination.
 */
export async function getPendingGroupsHandler(params: {
  method: FileDecisionMethod;
  page?: number;
  pageSize?: number;
  phashThreshold?: number;
  phashCategory?: "identical" | "similar";
}): Promise<{ groups: LogicalGroupSummary[]; total: number; page: number; pageSize: number }> {
  log.debug("getPendingGroups called", params);

  try {
    return await getPendingGroups(params);
  } catch (error) {
    log.error("Failed to get pending groups", error);
    throw error;
  }
}

/**
 * Get all files in a logical group with full context.
 */
export async function getLogicalGroupFilesHandler(params: {
  method: FileDecisionMethod;
  groupKey: string;
  phashThreshold?: number;
}): Promise<{ files: FileWithReviewContext[]; suggestion: AutoSelection }> {
  log.debug("getLogicalGroupFiles called", params);

  try {
    return await getLogicalGroupFiles(params);
  } catch (error) {
    log.error("Failed to get logical group files", error);
    throw error;
  }
}

/**
 * Submit review decisions for files in a group.
 */
export async function submitReviewDecisions(params: {
  decisions: Array<{ mediaFileId: number; action: "keep" | "delete" }>;
  method: FileDecisionMethod;
  reviewGroupKey: string;
}): Promise<{ success: boolean; decisionsStored: number }> {
  log.debug("submitReviewDecisions called", params);

  try {
    const dbProvider = await DatabaseProvider.getInstance();
    const fileDecisionProvider = dbProvider.getFileDecisionProvider();

    // Validate: at least one file must be "keep"
    const hasKeep = params.decisions.some((d) => d.action === "keep");

    if (!hasKeep) {
      throw new Error("At least one file must be marked as 'keep'");
    }

    // Use a transaction to ensure all-or-nothing.
    // Strategy: delete all existing decisions for this group, then batch insert.
    // This avoids per-row RETURNING clauses that can fail in SQLite transactions.
    const stored = await fileDecisionProvider.transaction(async (trx) => {
      // Delete ALL existing decisions for this group (clean slate)
      // Use per-file delete since the trx provider only has this method
      for (const decision of params.decisions) {
        await trx.deleteByMediaFileIdAndGroupKey(decision.mediaFileId, params.reviewGroupKey);
      }

      // Batch insert all decisions (no RETURNING clause — plain INSERT)
      const count = await trx.insertFileDecisions(
        params.decisions.map((d) => ({
          mediaFileId: d.mediaFileId,
          action: d.action,
          method: params.method,
          reviewGroupKey: params.reviewGroupKey,
        })),
      );

      return count;
    });

    // Post-save verification: confirm decisions were actually persisted
    const verification = await fileDecisionProvider.getDecisionsByReviewGroupKey(params.reviewGroupKey);
    if (verification.length !== params.decisions.length) {
      log.error("Decision verification FAILED", {
        expected: params.decisions.length,
        actual: verification.length,
        groupKey: params.reviewGroupKey,
      });
      throw new Error(
        `Decision save verification failed: expected ${params.decisions.length} decisions, found ${verification.length}`,
      );
    }

    log.info("Review decisions submitted and verified", {
      groupKey: params.reviewGroupKey,
      method: params.method,
      decisionsStored: stored,
      verified: verification.length,
    });

    return { success: true, decisionsStored: stored };
  } catch (error) {
    log.error("Failed to submit review decisions", error);
    throw error;
  }
}

/**
 * Get review summary statistics.
 */
export async function getReviewSummaryHandler(): Promise<ReviewSummary> {
  log.debug("getReviewSummary called");

  try {
    return await getReviewSummary();
  } catch (error) {
    log.error("Failed to get review summary", error);
    throw error;
  }
}

/**
 * Apply all pending deletions (files with action = "delete").
 */
export async function applyDeletionsHandler(params?: {
  dryRun?: boolean;
  moveToTrash?: boolean;
}): Promise<ApplyDecisionResult> {
  log.debug("applyDeletions called", params);

  try {
    return await applyDeletions({
      dryRun: params?.dryRun ?? false,
      moveToTrash: params?.moveToTrash ?? false,
    });
  } catch (error) {
    log.error("Failed to apply deletions", error);
    throw error;
  }
}

/**
 * Get files with conflicting keep/delete decisions.
 */
export async function getConflictsHandler(): Promise<{
  conflicts: Array<{
    mediaFileId: number;
    fileName: string;
    filePath: string;
    decisions: Array<{ reviewGroupKey: string; action: "keep" | "delete" }>;
  }>;
}> {
  log.debug("getConflicts called");

  try {
    const dbProvider = await DatabaseProvider.getInstance();
    const fileDecisionProvider = dbProvider.getFileDecisionProvider();
    const mediaFileProvider = dbProvider.getMediaFileProvider();

    const rawConflicts = await fileDecisionProvider.getConflictingFiles();

    const conflicts = await Promise.all(
      rawConflicts.map(async (c) => {
        const file = await mediaFileProvider.getMediaFileById(c.mediaFileId);
        return {
          mediaFileId: c.mediaFileId,
          fileName: file?.filename ?? "Unknown",
          filePath: file?.path ?? "Unknown",
          decisions: c.decisions,
        };
      }),
    );

    return { conflicts };
  } catch (error) {
    log.error("Failed to get conflicts", error);
    throw error;
  }
}

/**
 * Resolve a conflict for a specific file.
 */
export async function resolveConflictHandler(params: {
  mediaFileId: number;
  action: "keep" | "delete";
}): Promise<{ success: boolean }> {
  log.debug("resolveConflict called", params);

  try {
    const dbProvider = await DatabaseProvider.getInstance();
    const fileDecisionProvider = dbProvider.getFileDecisionProvider();

    await fileDecisionProvider.resolveConflict(params.mediaFileId, params.action);

    log.info("Conflict resolved", params);
    return { success: true };
  } catch (error) {
    log.error("Failed to resolve conflict", error);
    throw error;
  }
}

/**
 * Undo a specific file decision.
 */
export async function undoDecision(params: {
  mediaFileId: number;
  reviewGroupKey: string;
}): Promise<{ success: boolean }> {
  log.debug("undoDecision called", params);

  try {
    const dbProvider = await DatabaseProvider.getInstance();
    const fileDecisionProvider = dbProvider.getFileDecisionProvider();

    // Delete the decision
    await fileDecisionProvider.deleteByMediaFileIdAndGroupKey(params.mediaFileId, params.reviewGroupKey);

    log.info("Decision undone", params);
    return { success: true };
  } catch (error) {
    log.error("Failed to undo decision", error);
    throw error;
  }
}
