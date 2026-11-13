/**
 * Review state shared by the results screen, the group review, and the comparison modal. Lives at module
 * level (like the old Sigment signals) so cached groups, skips, and history survive navigating away.
 * Synchronous decision edits live here; RPC-driven actions are in review-actions.ts.
 */
import { createStore, useStore } from "../../external/store";
import type {
  ApplyDecisionResult,
  AutoSelection,
  FileDecisionAction,
  FileWithReviewContext,
  LogicalGroupSummary,
  ReviewSummary,
} from "../../services/processing";
import type { ReviewCategory } from "./categories";

export interface HistoryEntry {
  groupKey: string;
  decisions: Map<number, FileDecisionAction>;
}

export interface ReviewState {
  category: ReviewCategory;
  group: LogicalGroupSummary | null;
  files: FileWithReviewContext[];
  suggestion: AutoSelection | null;
  decisions: Map<number, FileDecisionAction>;
  /** The person changed decisions in the current group (guards category switches). */
  userModified: boolean;
  /** The file shown on the left in the comparison modal. */
  compareThisId: number | null;
  /** The file being compared (modal open when non-null). */
  compareFile: FileWithReviewContext | null;
  summary: ReviewSummary;
  loading: boolean;
  actionLoading: boolean;
  error: string | null;
  hasAttemptedLoad: boolean;
  groupIndex: number;
  totalGroups: number;
  skipped: Set<string>;
  cachedGroups: LogicalGroupSummary[];
  history: HistoryEntry[];
  /** Review-data version the cache was loaded for (-1: never loaded). */
  loadedVersion: number;
  dialog: "none" | "deleteAll" | "unsaved" | "apply" | "conflicts";
  pendingCategory: ReviewCategory | null;
  applyUseTrash: boolean;
  applyPreview: ApplyDecisionResult | null;
}

export const EMPTY_SUMMARY: ReviewSummary = {
  pendingSha256: 0,
  pendingContentHash: 0,
  pendingPhash: 0,
  decidedKeep: 0,
  decidedDelete: 0,
  phashIdenticalPairs: 0,
  phashSimilarPairs: 0,
  conflictCount: 0,
};

function initialState(): ReviewState {
  return {
    category: "sha256",
    group: null,
    files: [],
    suggestion: null,
    decisions: new Map(),
    userModified: false,
    compareThisId: null,
    compareFile: null,
    summary: EMPTY_SUMMARY,
    loading: false,
    actionLoading: false,
    error: null,
    hasAttemptedLoad: false,
    groupIndex: 0,
    totalGroups: 0,
    skipped: new Set(),
    cachedGroups: [],
    history: [],
    loadedVersion: -1,
    dialog: "none",
    pendingCategory: null,
    applyUseTrash: false,
    applyPreview: null,
  };
}

export const reviewStore = createStore<ReviewState>(initialState());

export function useReview(): ReviewState {
  return useStore(reviewStore);
}

export function getReview(): ReviewState {
  return reviewStore.get();
}

export function patchReview(patch: Partial<ReviewState>): void {
  reviewStore.set((s) => ({ ...s, ...patch }));
}

/** Test helper: forget everything. */
export function resetReviewState(): void {
  reviewStore.set(initialState());
}

/** Fields that clear the current group. */
export function clearedGroup(): Partial<ReviewState> {
  return { group: null, files: [], suggestion: null, decisions: new Map(), userModified: false, compareThisId: null };
}

export function totalPending(summary: ReviewSummary): number {
  return summary.pendingSha256 + summary.pendingContentHash + summary.pendingPhash;
}

/** Pending groups in the cache, excluding skipped ones. */
export function pendingGroups(cached: LogicalGroupSummary[], skipped: Set<string>): LogicalGroupSummary[] {
  return cached.filter((g) => !g.allDecided && g.fileCount >= 2 && !skipped.has(g.groupKey));
}

/** Whether another group remains after the current one. */
export function hasMoreGroups(s: ReviewState): boolean {
  const currentKey = s.group?.groupKey;
  return pendingGroups(s.cachedGroups, s.skipped).some((g) => g.groupKey !== currentKey);
}

export function keepCount(decisions: Map<number, FileDecisionAction>): number {
  let count = 0;
  for (const a of decisions.values()) if (a === "keep") count++;
  return count;
}

/**
 * The compare reference after a decision change: one keep → that file; none → null; several → the
 * current one if still kept, else the suggestion if kept, else the first keep.
 */
export function syncCompareThis(
  decisions: Map<number, FileDecisionAction>,
  current: number | null,
  suggestion: AutoSelection | null,
): number | null {
  const keepIds = [...decisions.entries()].filter(([, a]) => a === "keep").map(([id]) => id);
  if (keepIds.length === 0) return null;
  const firstKeep = keepIds[0] ?? null;
  if (keepIds.length === 1) return firstKeep;
  if (current !== null && keepIds.includes(current)) return current;
  if (suggestion && suggestion.fileId > 0 && keepIds.includes(suggestion.fileId)) return suggestion.fileId;
  return firstKeep;
}

/** Decisions to start a group with: stored ones, else every suggested keep + delete the rest, else none. */
export function initialDecisions(
  files: FileWithReviewContext[],
  suggestion: AutoSelection,
): Map<number, FileDecisionAction> {
  const decisions = new Map<number, FileDecisionAction>();
  for (const f of files) if (f.decision) decisions.set(f.file.id, f.decision.action);
  if (decisions.size > 0 || suggestion.fileId <= 0) return decisions;
  const keepIds = new Set(suggestion.keepFileIds?.length ? suggestion.keepFileIds : [suggestion.fileId]);
  for (const f of files) decisions.set(f.file.id, keepIds.has(f.file.id) ? "keep" : "delete");
  return decisions;
}

function editDecisions(edit: (next: Map<number, FileDecisionAction>, s: ReviewState) => void): void {
  reviewStore.set((s) => {
    const next = new Map(s.decisions);
    edit(next, s);
    return {
      ...s,
      decisions: next,
      userModified: true,
      compareThisId: syncCompareThis(next, s.compareThisId, s.suggestion),
    };
  });
}

export function setFileAction(id: number, action: FileDecisionAction): void {
  editDecisions((next) => next.set(id, action));
}

/** Toggle keep ↔ delete (undecided becomes keep). */
export function toggleFileAction(id: number): void {
  editDecisions((next) => next.set(id, next.get(id) === "keep" ? "delete" : "keep"));
}

/** Swap two files' actions, keeping `preservedRef` as the compare reference so the panels stay put. */
export function swapFileActions(
  idA: number,
  actionA: FileDecisionAction,
  idB: number,
  actionB: FileDecisionAction,
  preservedRef: number,
): void {
  editDecisions((next) => {
    next.set(idA, actionA);
    next.set(idB, actionB);
  });
  patchReview({ compareThisId: preservedRef });
}

/** Mark every file in the group with `action` (Keep All / Delete All). */
export function markAll(action: FileDecisionAction): void {
  editDecisions((next, s) => {
    next.clear();
    for (const f of s.files) next.set(f.file.id, action);
  });
}

export function setCompareThis(id: number): void {
  patchReview({ compareThisId: id });
}

/** Open the comparison modal (needs a compare reference). */
export function openComparison(file: FileWithReviewContext): void {
  if (getReview().compareThisId === null) return;
  patchReview({ compareFile: file });
}

export function closeComparison(): void {
  patchReview({ compareFile: null });
}

export function closeDialog(): void {
  patchReview({ dialog: "none", pendingCategory: null });
}

export function setError(error: string | null): void {
  patchReview({ error });
}
