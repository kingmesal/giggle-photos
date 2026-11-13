/**
 * Review service for duplicate detection results
 * Works both in dev preview (localStorage fallback) and Electrobun (RPC)
 *
 * Replaces the old group-based service with the query-based logical group architecture.
 */

import type { ApplyDecisionResult } from "@giggle-photos/core/actions/applyDecisions";
import type {
  AutoSelection,
  FileWithReviewContext,
  LogicalGroupSummary,
  ReviewSummary,
} from "@giggle-photos/core/review/review-queries";
import type { FileDecisionAction, FileDecisionMethod } from "@giggle-photos/core/zod/file-decision";
import { getLogger } from "./logger-service";

const log = getLogger("ui:review");

/** Re-export types from core for convenience */
export type {
  ApplyDecisionResult,
  AutoSelection,
  FileDecisionAction,
  FileDecisionMethod,
  FileWithReviewContext,
  LogicalGroupSummary,
  ReviewSummary,
};

/** RPC client interface for review operations */
export interface ReviewRPC {
  getPendingGroups: (params: {
    method: FileDecisionMethod;
    page?: number;
    pageSize?: number;
    phashThreshold?: number;
    phashCategory?: "identical" | "similar";
  }) => Promise<{
    groups: LogicalGroupSummary[];
    total: number;
    page: number;
    pageSize: number;
  }>;
  getLogicalGroupFiles: (params: { method: FileDecisionMethod; groupKey: string; phashThreshold?: number }) => Promise<{
    files: FileWithReviewContext[];
    suggestion: AutoSelection;
  }>;
  submitReviewDecisions: (params: {
    decisions: Array<{ mediaFileId: number; action: FileDecisionAction }>;
    method: FileDecisionMethod;
    reviewGroupKey: string;
  }) => Promise<{
    success: boolean;
    decisionsStored: number;
  }>;
  getReviewSummary: () => Promise<ReviewSummary>;
  applyDeletions: (params?: { dryRun?: boolean; moveToTrash?: boolean }) => Promise<ApplyDecisionResult>;
  undoDecision: (params: { mediaFileId: number; reviewGroupKey: string }) => Promise<{ success: boolean }>;
  getConflicts: () => Promise<{
    conflicts: Array<{
      mediaFileId: number;
      fileName: string;
      filePath: string;
      decisions: Array<{ reviewGroupKey: string; action: "keep" | "delete" }>;
    }>;
  }>;
  resolveConflict: (params: { mediaFileId: number; action: "keep" | "delete" }) => Promise<{ success: boolean }>;
}

// Module-level RPC client reference
let rpcClient: ReviewRPC | null = null;

/**
 * Initialize the review service with an RPC client
 * Call this from mainview.ts when RPC is available
 */
export function initReviewService(rpc: ReviewRPC): void {
  rpcClient = rpc;
  log.debug("Review service initialized with RPC");
}

/** Forget the RPC client (tests: back to the dev-preview mock data). */
export function clearReviewService(): void {
  rpcClient = null;
}

/**
 * Check if RPC is available
 */
export function hasRPC(): boolean {
  return rpcClient !== null;
}

// Mock data for development preview
const mockGroups: LogicalGroupSummary[] = [
  {
    groupKey: "abc123def456",
    method: "sha256",
    fileCount: 2,
    totalSize: 4500000,
    suggestedKeepFileId: 101,
    suggestedKeepReason: "Highest folder priority",
    hasDecisions: false,
    allDecided: false,
  },
  {
    groupKey: "xyz789ghi012",
    method: "content_hash",
    fileCount: 3,
    totalSize: 12000000,
    suggestedKeepFileId: 201,
    suggestedKeepReason: "Oldest date taken",
    hasDecisions: false,
    allDecided: false,
  },
  {
    groupKey: "phash:301",
    method: "phash",
    fileCount: 2,
    totalSize: 8000000,
    suggestedKeepFileId: 301,
    suggestedKeepReason: "Stable fallback (lowest file ID)",
    hasDecisions: false,
    allDecided: false,
    minPhashDistance: 3,
  },
];

/**
 * Review service for UI consumption
 */
export const reviewService = {
  /**
   * Get pending logical groups for a given detection method
   */
  async getPendingGroups(params: {
    method: FileDecisionMethod;
    page?: number;
    pageSize?: number;
    phashThreshold?: number;
    phashCategory?: "identical" | "similar";
  }): Promise<{ groups: LogicalGroupSummary[]; total: number; page: number; pageSize: number }> {
    if (rpcClient) {
      try {
        return await rpcClient.getPendingGroups(params);
      } catch (error) {
        log.error("Failed to get pending groups via RPC", error);
        throw error;
      }
    }

    // Fallback to mock data for dev preview
    const groups = mockGroups.filter((g) => g.method === params.method);
    const page = params.page ?? 1;
    const pageSize = params.pageSize ?? 20;

    return {
      groups,
      total: groups.length,
      page,
      pageSize,
    };
  },

  /**
   * Get files in a logical group with full context
   */
  async getLogicalGroupFiles(params: {
    method: FileDecisionMethod;
    groupKey: string;
    phashThreshold?: number;
  }): Promise<{ files: FileWithReviewContext[]; suggestion: AutoSelection }> {
    if (rpcClient) {
      try {
        return await rpcClient.getLogicalGroupFiles(params);
      } catch (error) {
        log.error("Failed to get group files via RPC", error);
        throw error;
      }
    }

    // Fallback to empty mock data for dev preview
    return {
      files: [],
      suggestion: { fileId: 0, keepFileIds: [], reason: "No files" },
    };
  },

  /**
   * Submit review decisions for files in a group
   */
  async submitReviewDecisions(params: {
    decisions: Array<{ mediaFileId: number; action: FileDecisionAction }>;
    method: FileDecisionMethod;
    reviewGroupKey: string;
  }): Promise<{ success: boolean; decisionsStored: number }> {
    if (rpcClient) {
      try {
        return await rpcClient.submitReviewDecisions(params);
      } catch (error) {
        log.error("Failed to submit review decisions via RPC", error);
        throw error;
      }
    }

    // Fallback for dev preview
    log.debug("submitReviewDecisions (mock)", params);
    return { success: true, decisionsStored: params.decisions.length };
  },

  /**
   * Get review summary statistics
   */
  async getReviewSummary(): Promise<ReviewSummary> {
    if (rpcClient) {
      try {
        return await rpcClient.getReviewSummary();
      } catch (error) {
        log.error("Failed to get review summary via RPC", error);
        throw error;
      }
    }

    // Fallback for dev preview
    return {
      pendingSha256: 1,
      pendingContentHash: 1,
      pendingPhash: 1,
      decidedKeep: 0,
      decidedDelete: 0,
      phashIdenticalPairs: 0,
      phashSimilarPairs: 0,
      conflictCount: 0,
    };
  },

  /**
   * Apply all pending deletions (files with action = "delete")
   */
  async applyDeletions(params?: { dryRun?: boolean; moveToTrash?: boolean }): Promise<ApplyDecisionResult> {
    if (rpcClient) {
      try {
        return await rpcClient.applyDeletions(params);
      } catch (error) {
        log.error("Failed to apply deletions via RPC", error);
        throw error;
      }
    }

    // Fallback for dev preview
    log.debug("applyDeletions (mock)", params);
    return {
      success: 0,
      failed: 0,
      skipped: 0,
      errors: [],
      mode: "delete",
      sidecarsRemoved: 0,
      plan: { remove: [], skipped: [] },
    };
  },

  /**
   * Undo a specific file decision
   */
  async undoDecision(params: { mediaFileId: number; reviewGroupKey: string }): Promise<{ success: boolean }> {
    if (rpcClient) {
      try {
        return await rpcClient.undoDecision(params);
      } catch (error) {
        log.error("Failed to undo decision via RPC", error);
        throw error;
      }
    }

    // Fallback for dev preview
    log.debug("undoDecision (mock)", params);
    return { success: true };
  },

  /**
   * Get files with conflicting keep/delete decisions
   */
  async getConflicts(): Promise<{
    conflicts: Array<{
      mediaFileId: number;
      fileName: string;
      filePath: string;
      decisions: Array<{ reviewGroupKey: string; action: "keep" | "delete" }>;
    }>;
  }> {
    if (rpcClient) {
      try {
        return await rpcClient.getConflicts();
      } catch (error) {
        log.error("Failed to get conflicts via RPC", error);
        throw error;
      }
    }

    // Fallback for dev preview
    return { conflicts: [] };
  },

  /**
   * Resolve a conflict for a specific file
   */
  async resolveConflict(params: { mediaFileId: number; action: "keep" | "delete" }): Promise<{ success: boolean }> {
    if (rpcClient) {
      try {
        return await rpcClient.resolveConflict(params);
      } catch (error) {
        log.error("Failed to resolve conflict via RPC", error);
        throw error;
      }
    }

    // Fallback for dev preview
    log.debug("resolveConflict (mock)", params);
    return { success: true };
  },
};
