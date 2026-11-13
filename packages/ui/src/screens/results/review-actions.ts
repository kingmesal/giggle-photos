/**
 * RPC-driven review actions: loading groups, navigation (next/previous/skip), saving decisions, and
 * category switches. A newer navigation supersedes an older one: late answers from the older are dropped.
 */
import { getLogger } from "../../services/logger-service";
import { type LogicalGroupSummary, reviewService } from "../../services/processing";
import { categoryToMethod, categoryToPhashFilter, type ReviewCategory } from "./categories";
import { allowDeleteAll, prefsStore } from "./prefs";
import { clearedGroup, getReview, initialDecisions, patchReview, pendingGroups, syncCompareThis } from "./review-store";

const log = getLogger("ui:review-actions");
const perfLog = getLogger("performance");

let epoch = 0;
const message = (error: unknown, fallback: string): string => (error instanceof Error ? error.message : fallback);

async function timed<T>(label: string, run: () => Promise<T>): Promise<T> {
  const t0 = performance.now();
  try {
    return await run();
  } finally {
    perfLog.info(`${label} completed in ${(performance.now() - t0).toFixed(1)}ms`);
  }
}

/** Load a group's files and start its decisions. Returns false when superseded. */
async function loadGroupDetails(group: LogicalGroupSummary, index: number, mine: number): Promise<boolean> {
  try {
    const method = categoryToMethod(getReview().category);
    const result = await reviewService.getLogicalGroupFiles({ method, groupKey: group.groupKey });
    if (mine !== epoch) return false;
    const decisions = initialDecisions(result.files, result.suggestion);
    patchReview({
      group,
      groupIndex: index,
      files: result.files,
      suggestion: result.suggestion,
      decisions,
      userModified: false,
      compareThisId: syncCompareThis(decisions, null, result.suggestion),
    });
  } catch (error) {
    if (mine !== epoch) return false;
    log.error("Failed to load group details", error);
    patchReview({ group, groupIndex: index, error: message(error, "Failed to load group details") });
  }
  return true;
}

/** Fetch groups + summary for the current category and show the first pending group. */
export async function loadNextGroup(): Promise<void> {
  const mine = ++epoch;
  patchReview({ loading: true, error: null, hasAttemptedLoad: true });
  try {
    await timed("load-next-group", async () => {
      const cat = getReview().category;
      const [groupResult, summary] = await Promise.all([
        reviewService.getPendingGroups({
          method: categoryToMethod(cat),
          page: 1,
          pageSize: 9999,
          phashCategory: categoryToPhashFilter(cat),
        }),
        reviewService.getReviewSummary(),
      ]);
      if (mine !== epoch) return;
      const groups = groupResult.groups;
      patchReview({ summary, cachedGroups: groups, totalGroups: groups.length });
      const first = pendingGroups(groups, getReview().skipped)[0];
      if (!first) {
        patchReview({ ...clearedGroup(), groupIndex: 0 });
        return;
      }
      await loadGroupDetails(first, groups.indexOf(first) + 1, mine);
    });
  } catch (error) {
    if (mine !== epoch) return;
    log.error("Failed to load next group", error);
    patchReview({ error: message(error, "Failed to load groups") });
  } finally {
    if (mine === epoch) patchReview({ loading: false });
  }
}

/** Show the next pending group from the cache (refreshing the summary after a save); full load if empty. */
async function advanceFromCache(refreshSummary: boolean): Promise<void> {
  const mine = ++epoch;
  patchReview({ loading: true, error: null });
  try {
    if (refreshSummary) {
      const summary = await reviewService.getReviewSummary();
      if (mine !== epoch) return;
      patchReview({ summary });
    }
    const { cachedGroups, skipped } = getReview();
    patchReview({ totalGroups: pendingGroups(cachedGroups, new Set()).length });
    const next = pendingGroups(cachedGroups, skipped)[0];
    if (!next) {
      await loadNextGroup();
      return;
    }
    await loadGroupDetails(next, cachedGroups.indexOf(next) + 1, mine);
  } catch (error) {
    if (mine !== epoch) return;
    log.error("Failed to advance from cache, falling back to full refresh", error);
    await loadNextGroup();
  } finally {
    if (mine === epoch) patchReview({ loading: false });
  }
}

/** Save the current decisions and load the next group fresh. */
async function submitAndAdvance(): Promise<void> {
  const { group, decisions, category } = getReview();
  if (!group) return;
  patchReview({ actionLoading: true, error: null });
  try {
    await timed("save-and-next", () =>
      reviewService.submitReviewDecisions({
        decisions: [...decisions.entries()].map(([mediaFileId, action]) => ({ mediaFileId, action })),
        method: categoryToMethod(category),
        reviewGroupKey: group.groupKey,
      }),
    );
    patchReview(clearedGroup());
    await loadNextGroup();
  } catch (error) {
    log.error("Failed to submit decisions", error);
    patchReview({ error: message(error, "Failed to submit decisions") });
  } finally {
    patchReview({ actionLoading: false });
  }
}

/** Save & Next: asks first when nothing is kept, unless the person allowed delete-all. */
export async function saveAndNext(): Promise<void> {
  const { group, decisions } = getReview();
  if (!group) return;
  if (decisions.size === 0) {
    patchReview({ error: "Please set actions for all files before submitting" });
    return;
  }
  const hasKeep = [...decisions.values()].some((a) => a === "keep");
  if (!hasKeep && !prefsStore.get().allowDeleteAll) {
    patchReview({ dialog: "deleteAll" });
    return;
  }
  await submitAndAdvance();
}

/** Confirm from the delete-all dialog. */
export async function confirmDeleteAll(remember: boolean): Promise<void> {
  patchReview({ dialog: "none" });
  if (remember) allowDeleteAll();
  await submitAndAdvance();
}

/** Next Group: skip without saving (remembered for Prev Group). */
export async function skipGroup(): Promise<void> {
  const s = getReview();
  if (s.group) {
    patchReview({
      history: [...s.history, { groupKey: s.group.groupKey, decisions: new Map(s.decisions) }],
      skipped: new Set(s.skipped).add(s.group.groupKey),
    });
  }
  patchReview(clearedGroup());
  await timed("skip", () => advanceFromCache(false));
}

/** Prev Group: back to the last skipped group, restoring its decisions. */
export async function previousGroup(): Promise<void> {
  const s = getReview();
  const prev = s.history[s.history.length - 1];
  if (!prev) return;
  const skipped = new Set(s.skipped);
  skipped.delete(prev.groupKey);
  patchReview({ history: s.history.slice(0, -1), skipped });
  const group = s.cachedGroups.find((g) => g.groupKey === prev.groupKey);
  if (!group) {
    await loadNextGroup();
    return;
  }
  const mine = ++epoch;
  patchReview({ loading: true, error: null });
  try {
    const current = await timed("previous-group", () =>
      loadGroupDetails(group, s.cachedGroups.indexOf(group) + 1, mine),
    );
    if (current && prev.decisions.size > 0) {
      const { suggestion } = getReview();
      patchReview({
        decisions: prev.decisions,
        userModified: false,
        compareThisId: syncCompareThis(prev.decisions, null, suggestion),
      });
    }
  } finally {
    if (mine === epoch) patchReview({ loading: false });
  }
}

/** Switch tabs, asking first when the person changed the current group's decisions. */
export function changeCategory(category: ReviewCategory): void {
  const s = getReview();
  if (s.userModified && s.group) {
    patchReview({ dialog: "unsaved", pendingCategory: category });
    return;
  }
  void switchCategory(category);
}

/** Discard & Switch from the unsaved-changes dialog. */
export function confirmUnsavedChanges(): void {
  const pending = getReview().pendingCategory;
  patchReview({ dialog: "none", pendingCategory: null });
  if (pending) void switchCategory(pending);
}

function switchCategory(category: ReviewCategory): Promise<void> {
  patchReview({
    ...clearedGroup(),
    category,
    skipped: new Set(),
    cachedGroups: [],
    history: [],
    groupIndex: 0,
    totalGroups: 0,
  });
  return loadNextGroup();
}

/** Review data changed elsewhere (or first visit): drop cached groups and history, then reload. */
export function reloadForVersion(version: number): Promise<void> {
  patchReview({
    ...clearedGroup(),
    loadedVersion: version,
    skipped: new Set(),
    cachedGroups: [],
    history: [],
    compareFile: null,
  });
  return loadNextGroup();
}
