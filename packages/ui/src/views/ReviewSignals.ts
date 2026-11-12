/**
 * Shared signals, data loading, and actions for the duplicate review flow.
 * All reactive state lives here so that ResultsView, DuplicateGroupReview,
 * ImageCard, and ComparisonModal can share it without circular imports.
 */

import { createSignal, signal } from "sigment";
import { getLogger } from "../services/logger-service";
import {
  type AutoSelection,
  type FileDecisionAction,
  type FileDecisionMethod,
  type FileWithReviewContext,
  initReviewService,
  type LogicalGroupSummary,
  type ReviewRPC,
  type ReviewSummary,
  reviewService,
} from "../services/processing";
import { checkTrashAvailable, loadSettings, saveSettings } from "../services/settings-service";
import { initTheme } from "../state/theme";

const log = getLogger("ui:review-signals");
const perfLog = getLogger("performance");

// ---------------------------------------------------------------------------
// Review categories (user-friendly tabs)
// ---------------------------------------------------------------------------

export type ReviewCategory = "sha256" | "content_hash" | "phash_identical" | "phash_similar";

/** Map a review category to the RPC FileDecisionMethod */
export function categoryToMethod(cat: ReviewCategory): FileDecisionMethod {
  if (cat === "sha256") return "sha256";
  if (cat === "content_hash") return "content_hash";
  return "phash";
}

/** Map a review category to the backend phashCategory filter */
function categoryToPhashFilter(cat: ReviewCategory): "identical" | "similar" | undefined {
  if (cat === "phash_identical") return "identical";
  if (cat === "phash_similar") return "similar";
  return undefined;
}

/** Human-readable label for a review category */
export function categoryLabel(cat: ReviewCategory): string {
  switch (cat) {
    case "sha256":
      return "Exact Duplicates";
    case "content_hash":
      return "Same Content";
    case "phash_identical":
      return "Perceptually Identical";
    case "phash_similar":
      return "Perceptually Similar";
  }
}

/** Icon class for a category */
export function categoryIcon(cat: ReviewCategory): string {
  switch (cat) {
    case "sha256":
      return "fa-fingerprint";
    case "content_hash":
      return "fa-image";
    case "phash_identical":
      return "fa-eye";
    case "phash_similar":
      return "fa-eye";
  }
}

/** Color classes for a category tab (active state) */
export function categoryActiveColor(cat: ReviewCategory): string {
  switch (cat) {
    case "sha256":
      return "bg-blue-600 text-white";
    case "content_hash":
      return "bg-purple-600 text-white";
    case "phash_identical":
      return "bg-orange-600 text-white";
    case "phash_similar":
      return "bg-orange-600 text-white";
  }
}

/** Badge color for a category (for count badge when active) */
export function categoryBadgeActiveColor(cat: ReviewCategory): string {
  switch (cat) {
    case "sha256":
      return "bg-blue-500 text-white";
    case "content_hash":
      return "bg-purple-500 text-white";
    case "phash_identical":
      return "bg-orange-500 text-white";
    case "phash_similar":
      return "bg-orange-500 text-white";
  }
}

// ---------------------------------------------------------------------------
// Signals
// ---------------------------------------------------------------------------

/** Currently selected review category */
const [getActiveCategory, setActiveCategory] = signal<ReviewCategory>("sha256");

/** Current group being reviewed (one at a time) */
const [getCurrentGroup, setCurrentGroup] = signal<LogicalGroupSummary | null>(null);

/** Files in the current group with review context */
const [getGroupFiles, setGroupFiles] = createSignal<FileWithReviewContext[]>([]);

/** Auto-selection suggestion for the current group */
const [getSuggestion, setSuggestion] = signal<AutoSelection | null>(null);

/** Local decision overrides: mediaFileId -> action */
const [getLocalDecisions, setLocalDecisions] = createSignal<Map<number, FileDecisionAction>>(new Map());

/** Review summary stats */
const [getSummary, setSummary] = createSignal<ReviewSummary>({
  pendingSha256: 0,
  pendingContentHash: 0,
  pendingPhash: 0,
  decidedKeep: 0,
  decidedDelete: 0,
  phashIdenticalPairs: 0,
  phashSimilarPairs: 0,
  conflictCount: 0,
});

/** Grid size for duplicate thumbnails */
export type GridSize = "sm" | "md" | "lg" | "xl";
const [getGridSize, _setGridSize] = signal<GridSize>("md");

/** Comparison modal view mode */
export type CompareViewMode = "large" | "balanced" | "compact" | "xl";
const [getCompareViewMode, _setCompareViewMode] = signal<CompareViewMode>("balanced");

/** Persist-aware setter for grid size */
function setGridSize(size: GridSize): void {
  _setGridSize(size);
  saveSettings({ reviewGridSize: size }).catch((e) => log.warn("Failed to save grid size", e));
}

/** Persist-aware setter for compare view mode */
function setCompareViewMode(mode: CompareViewMode): void {
  _setCompareViewMode(mode);
  saveSettings({ compareViewMode: mode }).catch((e) => log.warn("Failed to save compare view mode", e));
}

/** File for comparison modal (null = closed) */
const [getCompareFile, setCompareFile] = signal<FileWithReviewContext | null>(null);

/** Compare-this reference file id (the file used as left panel in comparison) */
const [getCompareThisFileId, setCompareThisFileId] = signal<number | null>(null);

/** Loading states */
const [getLoading, setLoading] = signal<boolean>(false);
const [getActionLoading, setActionLoading] = signal<boolean>(false);
const [getError, setError] = signal<string | null>(null);
const [getHasAttemptedLoad, setHasAttemptedLoad] = signal<boolean>(false);

/** Progress tracking */
const [getCurrentGroupIndex, setCurrentGroupIndex] = signal<number>(0);
const [getTotalGroups, setTotalGroups] = signal<number>(0);

/** Session-scoped set of skipped group keys (cleared on category change) */
const [getSkippedKeys, setSkippedKeys] = createSignal<Set<string>>(new Set());

/** Cached pHash subcategory counts */
const [getPhashIdenticalCount, setPhashIdenticalCount] = signal<number>(0);
const [getPhashSimilarCount, setPhashSimilarCount] = signal<number>(0);

/** Cached filtered group list (avoids re-fetching all groups on skip/save) */
const [getCachedGroups, setCachedGroups] = createSignal<LogicalGroupSummary[]>([]);

/** History stack of previously visited groups (for "Previous Group" navigation) */
const [getGroupHistory, setGroupHistory] = createSignal<
  Array<{ groupKey: string; decisions: Map<number, FileDecisionAction> }>
>([]);

/** File server port for loading local images (0 = not available, use file:// fallback) */
const [getFileServerPort, setFileServerPort] = signal<number>(0);

/** Whether to skip the delete-all confirmation dialog */
const [getAllowDeleteAll, _setAllowDeleteAll] = signal<boolean>(false);

/** Whether the delete-all confirmation dialog is visible */
const [getShowDeleteAllConfirm, setShowDeleteAllConfirm] = signal<boolean>(false);

/** Whether the unsaved-changes confirmation dialog is visible */
const [getShowUnsavedChangesConfirm, setShowUnsavedChangesConfirm] = signal<boolean>(false);

/** Whether the apply-deletions confirmation dialog is visible */
const [getShowApplyConfirm, setShowApplyConfirm] = signal<boolean>(false);

/** Whether trash is available for the apply-deletions dialog messaging */
const [getApplyUseTrash, setApplyUseTrash] = signal<boolean>(false);

/** Whether the user has manually modified decisions for the current group */
let userModifiedDecisions = false;

/** Pending category to switch to after unsaved-changes confirmation */
let pendingCategorySwitch: ReviewCategory | null = null;

// ---------------------------------------------------------------------------
// Exports — signals
// ---------------------------------------------------------------------------

export {
  getActionLoading,
  getActiveCategory,
  getAllowDeleteAll,
  getApplyUseTrash,
  getCompareFile,
  getCompareThisFileId,
  getCompareViewMode,
  getCurrentGroup,
  getCurrentGroupIndex,
  getError,
  getGridSize,
  getGroupFiles,
  getGroupHistory,
  getHasAttemptedLoad,
  getLoading,
  getLocalDecisions,
  getPhashIdenticalCount,
  getPhashSimilarCount,
  getShowApplyConfirm,
  getShowDeleteAllConfirm,
  getShowUnsavedChangesConfirm,
  getSuggestion,
  getSummary,
  getTotalGroups,
  setActiveCategory,
  setCompareFile,
  setCompareThisFileId,
  setCompareViewMode,
  setError,
  setFileServerPort,
  setGridSize,
  setShowApplyConfirm,
  setShowDeleteAllConfirm,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/**
 * Extract a Date from a file's metadata (dateTaken for images, creationTime for videos).
 * Returns null if no date is available.
 */
export function extractDateTaken(ctx: FileWithReviewContext): Date | null {
  if (!ctx.metadata) return null;
  if ("dateTaken" in ctx.metadata && ctx.metadata.dateTaken) {
    const d = ctx.metadata.dateTaken;
    return d instanceof Date ? d : new Date(d as string);
  }
  if ("creationTime" in ctx.metadata && ctx.metadata.creationTime) {
    const d = ctx.metadata.creationTime;
    return d instanceof Date ? d : new Date(d as string);
  }
  return null;
}

/**
 * Format a time difference in milliseconds to a human-readable string.
 * Positive = newer than reference, negative = older than reference.
 * Returns null if the difference is exactly 0.
 */
export function formatTimeDiff(diffMs: number): string {
  if (diffMs === 0) return "same time";
  const sign = diffMs > 0 ? "+" : "-";
  const abs = Math.abs(diffMs);

  const seconds = Math.floor(abs / 1000);
  if (seconds < 60) return `${sign}${seconds}s`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    const remSec = seconds % 60;
    return remSec > 0 ? `${sign}${minutes}m ${remSec}s` : `${sign}${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const remMin = minutes % 60;
    return remMin > 0 ? `${sign}${hours}h ${remMin}m` : `${sign}${hours}h`;
  }

  const days = Math.floor(hours / 24);
  if (days < 365) {
    const remHrs = hours % 24;
    return remHrs > 0 ? `${sign}${days}d ${remHrs}h` : `${sign}${days}d`;
  }

  const years = Math.floor(days / 365);
  const remDays = days % 365;
  return remDays > 0 ? `${sign}${years}y ${remDays}d` : `${sign}${years}y`;
}

/**
 * Compute time difference string between a file and a reference (keep) file.
 * Returns null if either file has no date metadata.
 */
export function computeTimeDiff(file: FileWithReviewContext, keepFile: FileWithReviewContext): string | null {
  const fileDate = extractDateTaken(file);
  const keepDate = extractDateTaken(keepFile);
  if (!fileDate || !keepDate) return null;
  const diffMs = fileDate.getTime() - keepDate.getTime();
  return formatTimeDiff(diffMs);
}

/**
 * Build a URL for loading a local image file.
 * Uses the local file server when available, falls back to file:// protocol.
 */
export function getImageUrl(filePath: string): string {
  const port = getFileServerPort();
  if (port > 0) {
    return `http://127.0.0.1:${port}/file?path=${encodeURIComponent(filePath)}`;
  }
  return `file://${filePath}`;
}

/**
 * Build a URL for a video thumbnail (first-frame JPEG).
 * Uses the file server's /thumbnail endpoint which extracts via ffmpeg.
 */
export function getVideoThumbnailUrl(filePath: string): string {
  const port = getFileServerPort();
  if (port > 0) {
    return `http://127.0.0.1:${port}/thumbnail?path=${encodeURIComponent(filePath)}`;
  }
  return "";
}

/** Get URL for a video frame at a specific timestamp (seconds) */
export function getVideoFrameUrl(filePath: string, time: number): string {
  const port = getFileServerPort();
  if (port > 0) {
    return `http://127.0.0.1:${port}/thumbnail?path=${encodeURIComponent(filePath)}&time=${time.toFixed(3)}`;
  }
  return "";
}

/**
 * Format GPS coordinates to a human-readable string.
 * Returns null if latitude or longitude are missing.
 */
export function formatGpsCoords(
  latitude: number | null | undefined,
  longitude: number | null | undefined,
  altitude: number | null | undefined,
): string | null {
  if (latitude == null || longitude == null) return null;
  const latStr = `${Math.abs(latitude).toFixed(2)}\u00B0 ${latitude >= 0 ? "N" : "S"}`;
  const lonStr = `${Math.abs(longitude).toFixed(2)}\u00B0 ${longitude >= 0 ? "E" : "W"}`;
  let result = `${latStr} ${lonStr}`;
  if (altitude != null) {
    result += ` ${altitude >= 0 ? "+" : ""}${Math.round(altitude)}m`;
  }
  return result;
}

/** Check if there are more groups to navigate to after the current one */
export function hasMoreGroups(): boolean {
  const cached = getCachedGroups();
  const skipped = getSkippedKeys();
  const currentKey = getCurrentGroup()?.groupKey;
  return cached.some((g) => !g.allDecided && g.fileCount >= 2 && !skipped.has(g.groupKey) && g.groupKey !== currentKey);
}

/** Count how many files are marked "keep" in local decisions */
export function getKeepCount(): number {
  let count = 0;
  for (const a of getLocalDecisions().values()) {
    if (a === "keep") count++;
  }
  return count;
}

/**
 * Synchronize the compare-this reference after any decision change.
 * - 1 keep → auto-set that file as compare-this
 * - 0 keeps → clear compare-this
 * - 2+ keeps → keep current if still a keep, otherwise default to suggestion or first keep
 */
function syncCompareThisFile(): void {
  const decisions = getLocalDecisions();
  const keepIds: number[] = [];
  for (const [id, action] of decisions.entries()) {
    if (action === "keep") keepIds.push(id);
  }

  if (keepIds.length === 0) {
    setCompareThisFileId(null);
    return;
  }

  const firstKeep = keepIds[0] ?? null;

  if (keepIds.length === 1) {
    setCompareThisFileId(firstKeep);
    return;
  }

  // 2+ keeps: keep current if still valid
  const current = getCompareThisFileId();
  if (current !== null && keepIds.includes(current)) return;

  // Default to suggestion if it's a keep, otherwise first keep
  const suggestion = getSuggestion();
  if (suggestion && suggestion.fileId > 0 && keepIds.includes(suggestion.fileId)) {
    setCompareThisFileId(suggestion.fileId);
  } else {
    setCompareThisFileId(firstKeep);
  }
}

/** Map grid size to Tailwind grid-cols class */
export function getGridColsClass(size: GridSize): string {
  switch (size) {
    case "sm":
      return "grid-cols-6";
    case "md":
      return "grid-cols-4";
    case "lg":
      return "grid-cols-3";
    case "xl":
      return "grid-cols-2";
  }
}

// ---------------------------------------------------------------------------
// Navigation performance timer
// ---------------------------------------------------------------------------

let _navTimerStart: number | null = null;
let _navTimerAction: string | null = null;

function startNavTimer(action: string): void {
  _navTimerStart = performance.now();
  _navTimerAction = action;
}

function stopNavTimer(): void {
  if (_navTimerStart !== null && _navTimerAction !== null) {
    const elapsed = performance.now() - _navTimerStart;
    perfLog.info(`${_navTimerAction} completed in ${elapsed.toFixed(1)}ms`);
    _navTimerStart = null;
    _navTimerAction = null;
  }
}

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------

/** Update pHash subcategory counts from the review summary's match row counts */
function updatePhashCountsFromSummary(summary: ReviewSummary): void {
  setPhashIdenticalCount(summary.phashIdenticalPairs);
  setPhashSimilarCount(summary.phashSimilarPairs);
}

/** Load next pending group for the current category */
export async function loadNextGroup(): Promise<void> {
  setLoading(true);
  setError(null);
  setHasAttemptedLoad(true);

  try {
    const cat = getActiveCategory();
    const method = categoryToMethod(cat);
    const phashCategory = categoryToPhashFilter(cat);

    // Fetch summary and groups in parallel (backend filters by phash category)
    const [groupResult, summary] = await Promise.all([
      reviewService.getPendingGroups({ method, page: 1, pageSize: 9999, phashCategory }),
      reviewService.getReviewSummary(),
    ]);

    setSummary(summary);

    // Groups are already filtered by backend (method + phash category + pending only)
    setCachedGroups(groupResult.groups);

    // Update pHash subcounts from summary match row counts
    updatePhashCountsFromSummary(summary);

    // Find total for this category
    setTotalGroups(groupResult.groups.length);

    // Pick first unreviewed group (excluding session-skipped groups)
    const skipped = getSkippedKeys();
    const pending = groupResult.groups.filter((g) => !g.allDecided && g.fileCount >= 2 && !skipped.has(g.groupKey));
    if (pending.length === 0) {
      setCurrentGroup(null);
      setGroupFiles([]);
      setSuggestion(null);
      setLocalDecisions(new Map());
      setCurrentGroupIndex(0);
      setLoading(false);
      return;
    }

    const group = pending[0] as LogicalGroupSummary;
    const indexInAll = groupResult.groups.indexOf(group);
    setCurrentGroupIndex(indexInAll + 1);
    setCurrentGroup(group);

    await loadGroupDetails(group.groupKey);
  } catch (error) {
    log.error("Failed to load next group", error);
    setError(error instanceof Error ? error.message : "Failed to load groups");
  } finally {
    stopNavTimer();
    setLoading(false);
  }
}

/** Load full details for a specific group */
async function loadGroupDetails(groupKey: string): Promise<void> {
  const cat = getActiveCategory();
  const method = categoryToMethod(cat);

  try {
    const t0 = performance.now();
    const result = await reviewService.getLogicalGroupFiles({ method, groupKey });
    const t1 = performance.now();
    perfLog.info(`loadGroupDetails RPC call: ${(t1 - t0).toFixed(1)}ms (${result.files.length} files)`);

    let tSig = performance.now();
    setGroupFiles(result.files);
    perfLog.info(`loadGroupDetails setGroupFiles: ${(performance.now() - tSig).toFixed(1)}ms`);

    tSig = performance.now();
    setSuggestion(result.suggestion);

    // Initialize local decisions from existing decisions, or auto-suggestion
    const decisions = new Map<number, FileDecisionAction>();
    let hasExistingDecisions = false;

    for (const f of result.files) {
      if (f.decision) {
        decisions.set(f.file.id, f.decision.action);
        hasExistingDecisions = true;
      }
    }

    // If no existing decisions, pre-fill from auto-suggestion
    if (!hasExistingDecisions && result.suggestion.fileId > 0) {
      for (const f of result.files) {
        if (f.file.id === result.suggestion.fileId) {
          decisions.set(f.file.id, "keep");
        } else {
          decisions.set(f.file.id, "delete");
        }
      }
    }

    setLocalDecisions(decisions);
    userModifiedDecisions = false; // Auto-populated, not user-modified
    syncCompareThisFile();
    perfLog.info(`loadGroupDetails signal sets (after RPC): ${(performance.now() - tSig).toFixed(1)}ms`);
  } catch (error) {
    log.error("Failed to load group details", error);
    setError(error instanceof Error ? error.message : "Failed to load group details");
  }
}

/**
 * Pick the next group from the cached list without re-fetching all groups.
 * Falls back to loadNextGroup() if the cache is exhausted.
 * @param removeGroupKey - group key to remove from cache (already decided), or null to keep all
 * @param refreshSummary - whether to refresh review summary (skip on no-op skip, refresh after save)
 */
async function advanceFromCache(removeGroupKey: string | null, refreshSummary = true): Promise<void> {
  setLoading(true);
  setError(null);

  try {
    const tStart = performance.now();

    // Remove decided group from cache
    let cached = getCachedGroups();
    if (removeGroupKey) {
      cached = cached.filter((g) => g.groupKey !== removeGroupKey);
      setCachedGroups(cached);
    }

    // Only refresh summary when decisions changed (not on skip)
    if (refreshSummary) {
      const tSummary0 = performance.now();
      const summary = await reviewService.getReviewSummary();
      perfLog.info(`advanceFromCache summary refresh: ${(performance.now() - tSummary0).toFixed(1)}ms`);
      setSummary(summary);
      updatePhashCountsFromSummary(summary);
    }

    // Pick next non-skipped group from cache
    const skipped = getSkippedKeys();
    const pending = cached.filter((g) => !g.allDecided && g.fileCount >= 2 && !skipped.has(g.groupKey));
    setTotalGroups(cached.filter((g) => !g.allDecided && g.fileCount >= 2).length);

    perfLog.info(
      `advanceFromCache cache filter: ${(performance.now() - tStart).toFixed(1)}ms (cached=${cached.length}, pending=${pending.length}, skipped=${skipped.size})`,
    );

    if (pending.length === 0) {
      // Cache exhausted — do full refresh in case new groups appeared
      await loadNextGroup();
      return;
    }

    const group = pending[0] as LogicalGroupSummary;
    const indexInAll = cached.indexOf(group);

    let tSig = performance.now();
    setCurrentGroupIndex(indexInAll + 1);
    setCurrentGroup(group);
    perfLog.info(`advanceFromCache setCurrentGroup: ${(performance.now() - tSig).toFixed(1)}ms`);

    tSig = performance.now();
    await loadGroupDetails(group.groupKey);
    perfLog.info(`advanceFromCache loadGroupDetails total: ${(performance.now() - tSig).toFixed(1)}ms`);
  } catch (error) {
    log.error("Failed to advance from cache, falling back to full refresh", error);
    await loadNextGroup();
  } finally {
    stopNavTimer();
    const tLoad = performance.now();
    setLoading(false);
    perfLog.info(`advanceFromCache setLoading(false): ${(performance.now() - tLoad).toFixed(1)}ms`);
  }
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/** Set a single file's action (no auto-cascade) */
export function setFileAction(mediaFileId: number, action: FileDecisionAction): void {
  userModifiedDecisions = true;
  const current = new Map(getLocalDecisions());
  current.set(mediaFileId, action);
  setLocalDecisions(current);
  syncCompareThisFile();
}

/** Swap actions for two files atomically (single map update, single sync) */
export function swapFileActions(
  idA: number,
  actionA: FileDecisionAction,
  idB: number,
  actionB: FileDecisionAction,
): void {
  userModifiedDecisions = true;
  const current = new Map(getLocalDecisions());
  current.set(idA, actionA);
  current.set(idB, actionB);
  setLocalDecisions(current);
  syncCompareThisFile();
}

/** Toggle a file between keep and delete */
export function toggleFileAction(mediaFileId: number): void {
  userModifiedDecisions = true;
  const current = new Map(getLocalDecisions());
  const existing = current.get(mediaFileId);
  if (existing === "keep") {
    current.set(mediaFileId, "delete");
  } else {
    current.set(mediaFileId, "keep");
  }
  setLocalDecisions(current);
  syncCompareThisFile();
}

/** Mark all files as delete */
export function handleMarkAllDelete(): void {
  userModifiedDecisions = true;
  const files = getGroupFiles();
  const decisions = new Map<number, FileDecisionAction>();
  for (const f of files) {
    decisions.set(f.file.id, "delete");
  }
  setLocalDecisions(decisions);
  syncCompareThisFile();
}

/** Mark all files as keep */
export function handleKeepAll(): void {
  userModifiedDecisions = true;
  const files = getGroupFiles();
  const decisions = new Map<number, FileDecisionAction>();
  for (const f of files) {
    decisions.set(f.file.id, "keep");
  }
  setLocalDecisions(decisions);
  syncCompareThisFile();
}

/** Internal: submit the current decisions and advance to next group */
async function submitAndAdvance(): Promise<void> {
  startNavTimer("save-and-next");
  const group = getCurrentGroup();
  if (!group) return;

  setActionLoading(true);
  setError(null);

  try {
    const decisions = getLocalDecisions();
    const decisionArray = [...decisions.entries()].map(([mediaFileId, action]) => ({
      mediaFileId,
      action,
    }));

    await reviewService.submitReviewDecisions({
      decisions: decisionArray,
      method: categoryToMethod(getActiveCategory()),
      reviewGroupKey: group.groupKey,
    });

    // Clear and load fresh from DB (no stale cache)
    setCurrentGroup(null);
    setGroupFiles([]);
    setSuggestion(null);
    setLocalDecisions(new Map());
    userModifiedDecisions = false;
    setCompareThisFileId(null);
    await loadNextGroup();
  } catch (error) {
    log.error("Failed to submit decisions", error);
    setError(error instanceof Error ? error.message : "Failed to submit decisions");
  } finally {
    setActionLoading(false);
  }
}

/** Validate, submit decisions, and advance to next group */
export async function handleSaveAndNext(): Promise<void> {
  const group = getCurrentGroup();
  if (!group) return;

  const decisions = getLocalDecisions();
  if (decisions.size === 0) {
    setError("Please set actions for all files before submitting");
    return;
  }

  // Check if no file is kept
  const hasKeep = [...decisions.values()].some((a) => a === "keep");

  if (!hasKeep) {
    // If the user already opted in to allow delete-all, skip the dialog
    if (getAllowDeleteAll()) {
      await submitAndAdvance();
      return;
    }
    // Otherwise, show the confirmation dialog
    setShowDeleteAllConfirm(true);
    return;
  }

  await submitAndAdvance();
}

/** Confirm the delete-all action from the confirmation dialog */
export async function confirmDeleteAll(remember: boolean): Promise<void> {
  setShowDeleteAllConfirm(false);

  if (remember) {
    _setAllowDeleteAll(true);
    saveSettings({ allowDeleteAll: true }).catch((e) => log.warn("Failed to save allowDeleteAll", e));
  }

  await submitAndAdvance();
}

/** Cancel the delete-all confirmation dialog */
export function cancelDeleteAll(): void {
  setShowDeleteAllConfirm(false);
}

/** Skip current group without saving and load next (renamed to "Next Group" in UI) */
export async function handleSkip(): Promise<void> {
  startNavTimer("skip");
  let t = performance.now();
  const group = getCurrentGroup();
  if (group) {
    // Save current group to history for "Previous Group" navigation
    const history = [...getGroupHistory()];
    history.push({ groupKey: group.groupKey, decisions: new Map(getLocalDecisions()) });
    setGroupHistory(history);

    const newSkipped = new Set(getSkippedKeys());
    newSkipped.add(group.groupKey);
    setSkippedKeys(newSkipped);
  }
  perfLog.info(`handleSkip setSkippedKeys: ${(performance.now() - t).toFixed(1)}ms`);

  t = performance.now();
  setCurrentGroup(null);
  perfLog.info(`handleSkip setCurrentGroup(null): ${(performance.now() - t).toFixed(1)}ms`);

  t = performance.now();
  setGroupFiles([]);
  perfLog.info(`handleSkip setGroupFiles([]): ${(performance.now() - t).toFixed(1)}ms`);

  t = performance.now();
  setSuggestion(null);
  setLocalDecisions(new Map());
  setCompareThisFileId(null);
  perfLog.info(`handleSkip remaining clears: ${(performance.now() - t).toFixed(1)}ms`);

  await advanceFromCache(null, false);
}

/** Navigate to the previous group from the history stack */
export async function handlePreviousGroup(): Promise<void> {
  const history = [...getGroupHistory()];
  if (history.length === 0) return;

  startNavTimer("previous-group");

  const prev = history.pop();
  if (!prev) return;
  setGroupHistory(history);

  // Remove from skipped keys so it shows up again
  const newSkipped = new Set(getSkippedKeys());
  newSkipped.delete(prev.groupKey);
  setSkippedKeys(newSkipped);

  // Find the group in cached groups
  const cached = getCachedGroups();
  const group = cached.find((g) => g.groupKey === prev.groupKey);
  if (!group) {
    // Group no longer in cache — do a full reload
    await loadNextGroup();
    return;
  }

  setLoading(true);
  setError(null);

  try {
    const indexInAll = cached.indexOf(group);
    setCurrentGroupIndex(indexInAll + 1);
    setCurrentGroup(group);

    await loadGroupDetails(group.groupKey);

    // Restore previous decisions if the user had made changes
    if (prev.decisions.size > 0) {
      setLocalDecisions(prev.decisions);
      userModifiedDecisions = false;
      syncCompareThisFile();
    }
  } catch (error) {
    log.error("Failed to navigate to previous group", error);
    await loadNextGroup();
  } finally {
    stopNavTimer();
    setLoading(false);
  }
}

/** Show the apply-deletions confirmation dialog */
export async function handleApplyDeletions(): Promise<void> {
  const summary = getSummary();
  const deleteCount = summary.decidedDelete;

  if (deleteCount === 0) {
    setError("No files are marked for deletion. Review groups and mark duplicates first.");
    return;
  }

  // Determine if trash will be used (setting enabled AND command available)
  try {
    const [settings, trashInfo] = await Promise.all([loadSettings(), checkTrashAvailable()]);
    setApplyUseTrash(settings.moveToTrash && trashInfo.available);
  } catch {
    setApplyUseTrash(false);
  }

  setShowApplyConfirm(true);
}

/** Cancel the apply-deletions dialog */
export function cancelApplyDeletions(): void {
  setShowApplyConfirm(false);
}

/** Confirm and execute all pending deletions */
export async function confirmApplyDeletions(): Promise<void> {
  setShowApplyConfirm(false);
  setActionLoading(true);
  setError(null);

  try {
    // Read moveToTrash setting from persisted settings
    let moveToTrash = true;
    try {
      const settings = await loadSettings();
      moveToTrash = settings.moveToTrash;
    } catch {
      // Fall back to true if settings can't be loaded
    }
    const result = await reviewService.applyDeletions({ moveToTrash });
    log.info("Deletions applied", result);
    await loadNextGroup();
  } catch (error) {
    log.error("Failed to apply deletions", error);
    setError(error instanceof Error ? error.message : "Failed to apply deletions");
  } finally {
    setActionLoading(false);
  }
}

/** Switch to a different review category, reset state, load next group */
export function handleCategoryChange(category: ReviewCategory): void {
  // Guard: warn only if the user has manually modified decisions
  if (userModifiedDecisions && getCurrentGroup()) {
    pendingCategorySwitch = category;
    setShowUnsavedChangesConfirm(true);
    return;
  }

  performCategorySwitch(category);
}

/** Confirm discarding unsaved changes and switching category */
export function confirmUnsavedChanges(): void {
  setShowUnsavedChangesConfirm(false);
  if (pendingCategorySwitch) {
    const cat = pendingCategorySwitch;
    pendingCategorySwitch = null;
    performCategorySwitch(cat);
  }
}

/** Cancel the unsaved-changes dialog */
export function cancelUnsavedChanges(): void {
  setShowUnsavedChangesConfirm(false);
  pendingCategorySwitch = null;
}

/** Internal: actually perform the category switch */
function performCategorySwitch(category: ReviewCategory): void {
  userModifiedDecisions = false;
  setActiveCategory(category);
  setCurrentGroup(null);
  setGroupFiles([]);
  setSuggestion(null);
  setLocalDecisions(new Map());
  setCompareThisFileId(null);
  setSkippedKeys(new Set());
  setCachedGroups([]);
  setGroupHistory([]);
  setCurrentGroupIndex(0);
  setTotalGroups(0);
  loadNextGroup();
}

/** Open comparison modal for a file (guarded: requires a compare-this reference) */
export function openComparison(file: FileWithReviewContext): void {
  if (getCompareThisFileId() === null) return;
  setCompareFile(file);
}

/** Close comparison modal */
export function closeComparison(): void {
  setCompareFile(null);
}

/**
 * Invalidate the review cache (e.g. after a folder is deleted).
 * Clears cached groups, history, and reloads fresh data if a group is active.
 */
export function invalidateReviewCache(): void {
  setCachedGroups([]);
  setGroupHistory([]);
  setSkippedKeys(new Set());
  // If we're currently viewing a group, reload to get fresh data
  if (getCurrentGroup()) {
    setCurrentGroup(null);
    setGroupFiles([]);
    setSuggestion(null);
    setLocalDecisions(new Map());
    setCompareThisFileId(null);
    userModifiedDecisions = false;
    loadNextGroup();
  }
}

// ---------------------------------------------------------------------------
// Initialization (re-exported by ResultsView.ts)
// ---------------------------------------------------------------------------

export function initReviewServiceInternal(rpc: ReviewRPC): void {
  initReviewService(rpc);
  // Load persisted UI preferences
  loadSettings()
    .then((settings) => {
      const validGridSizes: GridSize[] = ["sm", "md", "lg", "xl"];
      if (validGridSizes.includes(settings.reviewGridSize as GridSize)) {
        _setGridSize(settings.reviewGridSize as GridSize);
      }
      const validViewModes: CompareViewMode[] = ["large", "balanced", "compact", "xl"];
      if (validViewModes.includes(settings.compareViewMode as CompareViewMode)) {
        _setCompareViewMode(settings.compareViewMode as CompareViewMode);
      }
      initTheme(settings.themeMode ?? "dark");
      if (settings.allowDeleteAll) {
        _setAllowDeleteAll(true);
      }
      log.debug("Loaded UI preferences", {
        gridSize: settings.reviewGridSize,
        compareViewMode: settings.compareViewMode,
        themeMode: settings.themeMode,
        allowDeleteAll: settings.allowDeleteAll,
      });
    })
    .catch((e) => log.warn("Failed to load UI preferences", e));
}
