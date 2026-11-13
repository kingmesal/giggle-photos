/**
 * ResultsView — orchestrator for the duplicate review screen.
 * Mounts the header, summary cards, category tabs, grid-size selector,
 * DuplicateGroupReview (one-group-at-a-time), and ComparisonModal.
 *
 * Note: HTML element functions are globals provided by Sigment.
 */

import { createSignal, signal } from "sigment";
import { getLogger } from "../services/logger-service";
import { type ReviewRPC, reviewService } from "../services/processing";
import { ApplyPlanSummary } from "./ApplyPlanSummary";
import { ComparisonModal } from "./ComparisonModal";
import { DuplicateGroupReview } from "./DuplicateGroupReview";
import {
  cancelApplyDeletions,
  categoryActiveColor,
  categoryBadgeActiveColor,
  categoryIcon,
  categoryLabel,
  confirmApplyDeletions,
  type GridSize,
  getActionLoading,
  getActiveCategory,
  getApplyPreview,
  getApplyUseTrash,
  getCurrentGroupIndex,
  getError,
  getGridSize,
  getHasAttemptedLoad,
  getLoading,
  getPhashIdenticalCount,
  getPhashSimilarCount,
  getShowApplyConfirm,
  getSummary,
  getTotalGroups,
  handleApplyDeletions,
  handleCategoryChange,
  initReviewServiceInternal,
  loadNextGroup,
  type ReviewCategory,
  setError,
  setGridSize,
} from "./ReviewSignals";

const log = getLogger("ui:results-view");

// ---------------------------------------------------------------------------
// Initialization (same signature — browser.ts needs no changes)
// ---------------------------------------------------------------------------

export function initResultsService(rpc: ReviewRPC): void {
  initReviewServiceInternal(rpc);
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/** 4 stat cards: Pending, Keep, Delete, Total */
function SummaryHeader() {
  return () => {
    const summary = getSummary();
    const totalPending = summary.pendingSha256 + summary.pendingContentHash + summary.pendingPhash;
    const totalDecisions = summary.decidedKeep + summary.decidedDelete;

    const cards: { label: string; value: number; icon: string; color: string }[] = [
      { label: "Pending Groups", value: totalPending, icon: "fa-clock", color: "bg-amber-500/20 text-accent-amber" },
      {
        label: "Files to Keep",
        value: summary.decidedKeep,
        icon: "fa-check-circle",
        color: "bg-emerald-500/20 text-accent-green",
      },
      {
        label: "Files to Delete",
        value: summary.decidedDelete,
        icon: "fa-trash",
        color: "bg-red-500/20 text-accent-red",
      },
      {
        label: "Total Decisions",
        value: totalDecisions,
        icon: "fa-list-check",
        color: "bg-blue-500/20 text-accent-blue",
      },
    ];

    return div(
      { class: "grid grid-cols-4 gap-4 mb-4" },
      ...cards.map((c) =>
        div(
          { class: "bg-surface-card rounded-lg border border-edge p-3" },
          div(
            { class: "flex items-center gap-2" },
            div(
              { class: `w-8 h-8 rounded-lg flex items-center justify-center ${c.color}` },
              i({ class: `fadr ${c.icon}` }),
            ),
            div(
              {},
              p({ class: "text-lg font-semibold" }, String(c.value)),
              p({ class: "text-xs text-fg-muted" }, c.label),
            ),
          ),
        ),
      ),
    );
  };
}

/** Category tab bar */
function CategoryTabs() {
  return () => {
    const active = getActiveCategory();
    const summary = getSummary();

    const categories: { id: ReviewCategory; count: number }[] = [
      { id: "sha256", count: summary.pendingSha256 },
      { id: "content_hash", count: summary.pendingContentHash },
      { id: "phash_identical", count: getPhashIdenticalCount() },
      { id: "phash_similar", count: getPhashSimilarCount() },
    ];

    return div(
      { class: "flex items-center gap-1" },
      ...categories.map((cat) => {
        const isActive = active === cat.id;
        return button(
          {
            class: `px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${
              isActive ? categoryActiveColor(cat.id) : "bg-surface-inset text-fg-3 hover:bg-surface-active"
            }`,
            onclick: () => handleCategoryChange(cat.id),
          },
          i({ class: `fadr ${categoryIcon(cat.id)}` }),
          categoryLabel(cat.id),
          cat.count > 0
            ? span(
                {
                  class: `px-1.5 py-0.5 rounded-full text-xs ${
                    isActive ? categoryBadgeActiveColor(cat.id) : "bg-zinc-300 dark:bg-zinc-600 text-fg-3"
                  }`,
                },
                String(cat.count),
              )
            : null,
        );
      }),
    );
  };
}

/** Grid size selector — graduated fa-image icons (small → large) */
function GridSizeSelector() {
  return () => {
    const current = getGridSize();
    const sizes: Array<{ id: GridSize; label: string; iconSize: string }> = [
      { id: "sm", label: "Small", iconSize: "text-xs" },
      { id: "md", label: "Medium", iconSize: "text-sm" },
      { id: "lg", label: "Large", iconSize: "text-base" },
      { id: "xl", label: "Extra Large", iconSize: "text-xl" },
    ];

    return div(
      { class: "flex items-center gap-1" },
      ...sizes.map(({ id, label, iconSize }) => {
        const isActive = current === id;
        return button(
          {
            class: `w-8 h-7 rounded flex items-center justify-center ${
              isActive
                ? "bg-blue-600 text-white"
                : "bg-surface-inset text-fg-muted hover:bg-surface-active hover:text-fg-2"
            }`,
            title: label,
            onclick: () => setGridSize(id),
          },
          i({ class: `fadr fa-image ${iconSize}` }),
        );
      }),
    );
  };
}

/** Error banner (dismissible) */
function ErrorBanner() {
  return () => {
    const error = getError();
    if (!error) return null;

    return div(
      {
        class:
          "mb-4 p-3 rounded-lg bg-red-500/20 border border-red-500/30 text-accent-red text-sm flex items-center gap-2",
      },
      i({ class: "fadr fa-circle-exclamation" }),
      error,
      button(
        {
          class: "ml-auto text-accent-red hover:text-red-300",
          onclick: () => setError(null),
        },
        i({ class: "fadr fa-xmark" }),
      ),
    );
  };
}

// ---------------------------------------------------------------------------
// Conflicts resolution
// ---------------------------------------------------------------------------

type ConflictFile = {
  mediaFileId: number;
  fileName: string;
  filePath: string;
  decisions: Array<{ reviewGroupKey: string; action: "keep" | "delete" }>;
};

const [getShowConflicts, setShowConflicts] = signal<boolean>(false);
const [getConflicts, setConflicts] = createSignal<ConflictFile[]>([]);
const [getConflictsLoading, setConflictsLoading] = signal<boolean>(false);

async function handleOpenConflicts(): Promise<void> {
  setShowConflicts(true);
  setConflictsLoading(true);
  try {
    const result = await reviewService.getConflicts();
    setConflicts(result.conflicts);
  } catch (error) {
    log.error("Failed to load conflicts", error);
  } finally {
    setConflictsLoading(false);
  }
}

async function handleResolveConflict(mediaFileId: number, action: "keep" | "delete"): Promise<void> {
  try {
    await reviewService.resolveConflict({ mediaFileId, action });
    // Remove from local list
    const updated = getConflicts().filter((c) => c.mediaFileId !== mediaFileId);
    setConflicts(updated);
    // Refresh summary to update conflict count
    await loadNextGroup();
    // Close dialog if no more conflicts
    if (updated.length === 0) {
      setShowConflicts(false);
    }
  } catch (error) {
    log.error("Failed to resolve conflict", error);
  }
}

/** Apply-deletions confirmation dialog */
function ApplyConfirmDialog() {
  return () => {
    if (!getShowApplyConfirm()) return div();

    const preview = getApplyPreview();
    const mode = preview?.mode ?? (getApplyUseTrash() ? "trash" : "delete");
    const useTrash = mode !== "delete"; // quarantine and trash are both recoverable
    const title = { quarantine: "Move to quarantine?", trash: "Move to Trash?", delete: "Permanently Delete?" }[mode];
    const subtitle = {
      quarantine: "Files can be restored from the quarantine folder",
      trash: "Files can be restored from your trash",
      delete: "This action cannot be undone",
    }[mode];
    const canConfirm = preview !== null && preview.success > 0;

    return div(
      {
        class: "fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4",
        onclick: (e: MouseEvent) => {
          if (e.target === e.currentTarget) {
            cancelApplyDeletions();
          }
        },
      },
      div(
        {
          class: "bg-surface-card rounded-xl border border-edge shadow-2xl max-w-md w-full",
          onclick: (e: MouseEvent) => e.stopPropagation(),
        },
        // Header
        div(
          { class: "px-6 py-4 border-b border-edge" },
          div(
            { class: "flex items-center gap-3" },
            div(
              {
                class: `w-10 h-10 rounded-lg flex items-center justify-center ${
                  useTrash ? "bg-amber-500/20 text-accent-amber" : "bg-red-500/20 text-accent-red"
                }`,
              },
              i({ class: `fadr ${useTrash ? "fa-trash-undo" : "fa-triangle-exclamation"} text-xl` }),
            ),
            div(
              {},
              h3({ class: "text-lg font-semibold text-fg" }, title),
              p({ class: "text-sm text-fg-muted mt-0.5" }, subtitle),
            ),
          ),
        ),
        // Content
        div({ class: "px-6 py-4" }, ApplyPlanSummary(preview)),
        // Footer
        div(
          { class: "px-6 py-4 border-t border-edge flex justify-end gap-3" },
          button(
            {
              class: "px-4 py-2 rounded-lg text-sm font-medium bg-surface-inset hover:bg-surface-active text-fg-3",
              onclick: () => cancelApplyDeletions(),
            },
            "Cancel",
          ),
          button(
            {
              class: `px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-50 ${
                useTrash ? "bg-amber-600 hover:bg-amber-500" : "bg-red-600 hover:bg-red-500"
              }`,
              disabled: !canConfirm,
              onclick: () => {
                if (canConfirm) void confirmApplyDeletions();
              },
            },
            i({ class: "fadr fa-trash mr-2" }),
            { quarantine: "Move to Quarantine", trash: "Move to Trash", delete: "Delete Files" }[mode],
          ),
        ),
      ),
    );
  };
}

function ConflictsDialog() {
  return () => {
    if (!getShowConflicts()) return div();

    const conflicts = getConflicts();
    const loading = getConflictsLoading();

    return div(
      {
        class: "fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4",
        onclick: (e: MouseEvent) => {
          if (e.target === e.currentTarget) setShowConflicts(false);
        },
      },
      div(
        {
          class: "bg-surface-card rounded-xl border border-edge shadow-2xl max-w-2xl w-full max-h-[80vh] flex flex-col",
          onclick: (e: MouseEvent) => e.stopPropagation(),
        },
        // Header
        div(
          { class: "px-6 py-4 border-b border-edge flex-shrink-0" },
          div(
            { class: "flex items-center gap-3" },
            div(
              { class: "w-10 h-10 rounded-lg bg-amber-500/20 text-accent-amber flex items-center justify-center" },
              i({ class: "fadr fa-triangle-exclamation text-xl" }),
            ),
            div(
              {},
              h3({ class: "text-lg font-semibold text-fg" }, "Resolve Conflicts"),
              p(
                { class: "text-sm text-fg-muted mt-0.5" },
                "These files have both 'keep' and 'delete' decisions in different groups",
              ),
            ),
          ),
        ),
        // Content
        div(
          { class: "flex-1 overflow-auto px-6 py-4" },
          loading
            ? div(
                { class: "flex items-center justify-center py-8 text-fg-muted" },
                i({ class: "fadr fa-spinner animate-spin text-xl mr-3" }),
                "Loading conflicts...",
              )
            : conflicts.length === 0
              ? div(
                  { class: "flex items-center justify-center py-8 text-fg-muted" },
                  i({ class: "fadr fa-check-circle text-accent-green text-xl mr-3" }),
                  "No conflicts remaining!",
                )
              : div(
                  { class: "space-y-3" },
                  ...conflicts.map((conflict) =>
                    div(
                      { class: "bg-surface-inset rounded-lg border border-edge p-4" },
                      // File info
                      div(
                        { class: "flex items-center gap-2 mb-3" },
                        i({ class: "fadr fa-file text-fg-muted" }),
                        div(
                          { class: "flex-1 min-w-0" },
                          p({ class: "text-sm font-medium text-fg truncate" }, conflict.fileName),
                          p({ class: "text-xs text-fg-faint truncate" }, conflict.filePath),
                        ),
                      ),
                      // Decisions breakdown
                      div(
                        { class: "flex items-center gap-2 mb-3 text-xs text-fg-muted flex-wrap" },
                        ...conflict.decisions.map((d) =>
                          span(
                            {
                              class: `px-2 py-0.5 rounded-full ${
                                d.action === "keep"
                                  ? "bg-emerald-500/20 text-accent-green"
                                  : "bg-red-500/20 text-accent-red"
                              }`,
                            },
                            `${d.action} in ${d.reviewGroupKey.length > 20 ? `${d.reviewGroupKey.slice(0, 20)}...` : d.reviewGroupKey}`,
                          ),
                        ),
                      ),
                      // Action buttons
                      div(
                        { class: "flex items-center gap-2" },
                        button(
                          {
                            class:
                              "px-3 py-1.5 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 text-accent-green text-sm font-medium border border-emerald-500/30 flex items-center gap-2",
                            onclick: () => handleResolveConflict(conflict.mediaFileId, "keep"),
                          },
                          i({ class: "fadr fa-check" }),
                          "Keep Everywhere",
                        ),
                        button(
                          {
                            class:
                              "px-3 py-1.5 rounded-lg bg-red-600/20 hover:bg-red-600/30 text-accent-red text-sm font-medium border border-red-500/30 flex items-center gap-2",
                            onclick: () => handleResolveConflict(conflict.mediaFileId, "delete"),
                          },
                          i({ class: "fadr fa-trash" }),
                          "Delete Everywhere",
                        ),
                      ),
                    ),
                  ),
                ),
        ),
        // Footer
        div(
          { class: "px-6 py-4 border-t border-edge flex-shrink-0 flex justify-end" },
          button(
            {
              class: "px-4 py-2 rounded-lg bg-surface-inset hover:bg-surface-active text-fg-3 text-sm font-medium",
              onclick: () => setShowConflicts(false),
            },
            "Close",
          ),
        ),
      ),
    );
  };
}

// ---------------------------------------------------------------------------
// Main view
// ---------------------------------------------------------------------------

export function ResultsView() {
  // Load on first mount
  if (!getHasAttemptedLoad() && !getLoading()) {
    loadNextGroup();
  }

  // Create sub-components ONCE — never re-created on signal changes.
  // This prevents Sigment subscription leaks from nested reactive closures.
  const normalView = div(
    { class: "flex flex-col h-full" },
    // Stats, tabs, grid size
    div(
      { class: "flex-shrink-0 p-4 bg-zinc-50/50 dark:bg-zinc-900/50" },
      ErrorBanner(),
      SummaryHeader(),
      // Tabs row with grid-size selector
      div({ class: "flex items-center justify-between gap-4" }, CategoryTabs(), GridSizeSelector()),
    ),
    // Main review area
    div({ class: "flex-1 overflow-hidden" }, DuplicateGroupReview()),
  );

  return div(
    { class: "h-full flex flex-col" },
    // Header bar
    header(
      { class: "flex-shrink-0 bg-surface border-b border-edge px-6 py-4 z-10" },
      div(
        { class: "flex items-center justify-between" },
        div(
          { class: "flex items-center gap-4" },
          div(
            {},
            h2({ class: "text-xl font-semibold text-fg" }, "Review Duplicates"),
            // Progress indicator
            () => {
              const idx = getCurrentGroupIndex();
              const total = getTotalGroups();
              if (total > 0) {
                return p({ class: "text-sm text-fg-muted mt-0.5" }, `Group ${idx} of ${total}`);
              }
              return p({ class: "text-sm text-fg-muted mt-0.5" }, "Review and decide which files to keep or delete");
            },
          ),
        ),
        div(
          { class: "flex items-center gap-3" },
          // Resolve Conflicts button
          () => {
            const summary = getSummary();
            const conflictCount = summary.conflictCount;
            if (conflictCount <= 0) return null;

            return button(
              {
                class:
                  "px-4 py-2 rounded-lg text-sm font-medium bg-amber-600/20 hover:bg-amber-600/30 text-accent-amber border border-amber-500/30 flex items-center gap-2",
                onclick: () => handleOpenConflicts(),
              },
              i({ class: "fadr fa-triangle-exclamation" }),
              `Resolve Conflicts (${conflictCount})`,
            );
          },
          // Apply deletions button
          () => {
            const summary = getSummary();
            const actionLoading = getActionLoading();
            const deleteCount = summary.decidedDelete;
            const totalPending = summary.pendingSha256 + summary.pendingContentHash + summary.pendingPhash;
            const conflictCount = summary.conflictCount;

            if (deleteCount <= 0) return null;

            const isBlocked = totalPending > 0 || conflictCount > 0;
            const isDisabled = actionLoading || isBlocked;

            let tooltip = "";
            if (totalPending > 0 && conflictCount > 0) {
              tooltip = `${totalPending} pending groups and ${conflictCount} conflicts must be resolved first`;
            } else if (totalPending > 0) {
              tooltip = `${totalPending} pending groups must be reviewed first`;
            } else if (conflictCount > 0) {
              tooltip = `${conflictCount} conflicts must be resolved first`;
            }

            return button(
              {
                class: `px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${
                  isDisabled
                    ? "bg-red-600/30 text-red-300 cursor-not-allowed"
                    : "bg-red-600 hover:bg-red-500 text-white"
                }`,
                onclick: isDisabled ? undefined : () => handleApplyDeletions(),
                disabled: isDisabled,
                title: tooltip || undefined,
              },
              i({ class: "fadr fa-trash" }),
              `Apply Deletions (${deleteCount})`,
            );
          },
        ),
      ),
    ),
    // Content
    div({ class: "flex-1 overflow-hidden flex flex-col" }, () => {
      const loading = getLoading();
      const summary = getSummary();
      const totalPending = summary.pendingSha256 + summary.pendingContentHash + summary.pendingPhash;
      const totalDecisions = summary.decidedKeep + summary.decidedDelete;
      const hasAnyResults = totalPending > 0 || totalDecisions > 0;

      // Loading state (only on very first load)
      if (loading && !getHasAttemptedLoad()) {
        return div(
          { class: "flex items-center justify-center h-full text-fg-muted" },
          i({ class: "fadr fa-spinner animate-spin text-2xl mr-3" }),
          "Loading...",
        );
      }

      // Full-page empty state when there are no results at all
      if (!hasAnyResults && !loading) {
        return div(
          { class: "flex flex-col items-center justify-center h-full text-center px-6" },
          i({ class: "fadr fa-images text-6xl text-zinc-400 dark:text-zinc-600 mb-6" }),
          h3({ class: "text-xl font-semibold text-fg-2 mb-2" }, "No Duplicates Found Yet"),
          p(
            { class: "text-fg-muted max-w-md" },
            "Run the processing pipeline to scan your files and detect duplicates. Once complete, duplicate groups will appear here for review.",
          ),
        );
      }

      // Return the pre-created normal view (same DOM node — no new subscriptions)
      return normalView;
    }),
    // Comparison modal (conditionally rendered via signal)
    ComparisonModal(),
    // Apply deletions confirmation dialog (conditionally rendered via signal)
    ApplyConfirmDialog(),
    // Conflicts dialog (conditionally rendered via signal)
    ConflictsDialog(),
  );
}
