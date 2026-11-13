/** Fake review RPC and data builders for the results screen tests. */
import { mock } from "bun:test";
import type {
  ApplyDecisionResult,
  AutoSelection,
  FileWithReviewContext,
  LogicalGroupSummary,
  ReviewRPC,
  ReviewSummary,
} from "../../services/processing";

export function file(id: number, extra: Partial<FileWithReviewContext> = {}): FileWithReviewContext {
  return {
    file: {
      id,
      path: `/photos/a/img${id}.jpg`,
      filename: `img${id}.jpg`,
      size: 1024 * id,
      extension: "jpg",
      fileType: "image",
    },
    metadata: null,
    folderPriority: 1,
    decision: null,
    ...extra,
  } as unknown as FileWithReviewContext;
}

export function group(groupKey: string, fileCount = 3): LogicalGroupSummary {
  return {
    groupKey,
    method: "sha256",
    fileCount,
    totalSize: 1000,
    suggestedKeepFileId: 1,
    suggestedKeepReason: "test",
    hasDecisions: false,
    allDecided: false,
  };
}

export function summary(extra: Partial<ReviewSummary> = {}): ReviewSummary {
  return {
    pendingSha256: 2,
    pendingContentHash: 0,
    pendingPhash: 0,
    pendingClip: 0,
    decidedKeep: 0,
    decidedDelete: 0,
    phashIdenticalPairs: 0,
    phashSimilarPairs: 0,
    conflictCount: 0,
    ...extra,
  };
}

export function plan(success: number, mode: ApplyDecisionResult["mode"] = "quarantine"): ApplyDecisionResult {
  return { success, failed: 0, skipped: 0, errors: [], mode, sidecarsRemoved: 0, plan: { remove: [], skipped: [] } };
}

/** First parameter of a ReviewRPC method. */
type P<K extends keyof ReviewRPC> = NonNullable<Parameters<ReviewRPC[K]>[0]>;

export interface FakeData {
  groups: LogicalGroupSummary[];
  files: Record<string, { files: FileWithReviewContext[]; suggestion: AutoSelection }>;
  summary: ReviewSummary;
}

/** A ReviewRPC whose answers come from `data` (mutable between calls); every method is a bun mock. */
export function fakeRpc(data: FakeData) {
  return {
    getPendingGroups: mock(async (_p: P<"getPendingGroups">) => ({
      groups: data.groups,
      total: data.groups.length,
      page: 1,
      pageSize: 9999,
    })),
    getLogicalGroupFiles: mock(async ({ groupKey }: P<"getLogicalGroupFiles">) => {
      const entry = data.files[groupKey];
      if (!entry) throw new Error(`no group ${groupKey}`);
      return entry;
    }),
    submitReviewDecisions: mock(async (p: P<"submitReviewDecisions">) => ({
      success: true,
      decisionsStored: p.decisions.length,
    })),
    getReviewSummary: mock(async () => data.summary),
    applyDeletions: mock(async (_p?: { dryRun?: boolean; moveToTrash?: boolean }) => plan(0)),
    undoDecision: mock(async () => ({ success: true })),
    getConflicts: mock(async () => ({ conflicts: [] as Awaited<ReturnType<ReviewRPC["getConflicts"]>>["conflicts"] })),
    resolveConflict: mock(async () => ({ success: true })),
  } satisfies ReviewRPC;
}

/** Two sha256 groups: g1 (files 1-3, keeps 1 and 2), g2 (files 4-5, keep 4). */
export function twoGroups(): FakeData {
  return {
    groups: [group("g1", 3), group("g2", 2)],
    files: {
      g1: { files: [file(1), file(2), file(3)], suggestion: { fileId: 1, keepFileIds: [1, 2], reason: "album" } },
      g2: { files: [file(4), file(5)], suggestion: { fileId: 4, keepFileIds: [4], reason: "priority" } },
    },
    summary: summary(),
  };
}
