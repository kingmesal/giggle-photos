/**
 * DuplicateGroupReview — one-group-at-a-time review panel.
 * Shows all files (including the suggested keep) in a uniform grid,
 * with action buttons (Mark All Delete, Keep All, Save & Next).
 *
 * Performance: All rendering is done in a single flat reactive closure
 * (`reviewContent`). No nested reactive closures — this prevents
 * Sigment subscription leaks that cause progressive slowdown.
 *
 * Note: HTML element functions are globals provided by Sigment.
 */

import { signal } from "sigment";
import { ImageCard } from "./ImageCard";
import {
  cancelDeleteAll,
  cancelUnsavedChanges,
  categoryLabel,
  computeTimeDiff,
  confirmDeleteAll,
  confirmUnsavedChanges,
  getActionLoading,
  getActiveCategory,
  getCompareThisFileId,
  getCurrentGroup,
  getError,
  getGridColsClass,
  getGridSize,
  getGroupFiles,
  getGroupHistory,
  getKeepCount,
  getLoading,
  getLocalDecisions,
  getShowDeleteAllConfirm,
  getShowUnsavedChangesConfirm,
  getSuggestion,
  handleKeepAll,
  handleMarkAllDelete,
  handlePreviousGroup,
  handleSaveAndNext,
  handleSkip,
  hasMoreGroups,
  loadNextGroup,
  openComparison,
  setCompareThisFileId,
  setError,
  toggleFileAction,
} from "./ReviewSignals";

// ---------------------------------------------------------------------------
// Sub-components (standalone — not nested inside reviewContent)
// ---------------------------------------------------------------------------

/** Delete-all confirmation dialog */
function DeleteAllConfirmDialog() {
  const [getRemember, setRemember] = signal(false);

  return () => {
    if (!getShowDeleteAllConfirm()) {
      return div();
    }

    const remember = getRemember();

    return div(
      {
        class: "fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4",
        onclick: (e: MouseEvent) => {
          if (e.target === e.currentTarget) {
            cancelDeleteAll();
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
              { class: "w-10 h-10 rounded-lg bg-amber-500/20 text-amber-400 flex items-center justify-center" },
              i({ class: "fadr fa-triangle-exclamation text-xl" }),
            ),
            div(
              {},
              h3({ class: "text-lg font-semibold text-fg" }, "Delete All Files?"),
              p({ class: "text-sm text-fg-muted mt-0.5" }, "No file will be kept in this group"),
            ),
          ),
        ),
        // Content
        div(
          { class: "px-6 py-4" },
          p(
            { class: "text-sm text-fg-3" },
            "All files in this group will be marked for deletion. No file will be kept.",
          ),
          // Remember checkbox
          label(
            {
              class: "flex items-center gap-2 mt-4 cursor-pointer select-none",
            },
            input({
              type: "checkbox",
              class: "w-4 h-4 rounded border-edge accent-amber-500",
              checked: remember,
              onchange: (e: Event) => {
                setRemember((e.target as HTMLInputElement).checked);
              },
            }),
            span({ class: "text-sm text-fg-muted" }, "Don't ask again for future groups"),
          ),
        ),
        // Footer
        div(
          { class: "px-6 py-4 border-t border-edge flex justify-end gap-3" },
          button(
            {
              class: "px-4 py-2 rounded-lg text-sm font-medium bg-surface-inset hover:bg-surface-active text-fg-3",
              onclick: () => cancelDeleteAll(),
            },
            "Cancel",
          ),
          button(
            {
              class: "px-4 py-2 rounded-lg text-sm font-medium bg-amber-600 hover:bg-amber-500 text-white",
              onclick: () => confirmDeleteAll(getRemember()),
            },
            i({ class: "fadr fa-trash mr-2" }),
            "Delete All",
          ),
        ),
      ),
    );
  };
}

/** Unsaved-changes confirmation dialog */
function UnsavedChangesDialog() {
  return () => {
    if (!getShowUnsavedChangesConfirm()) {
      return div();
    }

    return div(
      {
        class: "fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4",
        onclick: (e: MouseEvent) => {
          if (e.target === e.currentTarget) {
            cancelUnsavedChanges();
          }
        },
      },
      div(
        { class: "bg-surface-card rounded-xl shadow-2xl max-w-md w-full p-6 space-y-4" },
        div(
          { class: "flex items-center gap-3" },
          i({ class: "fadr fa-triangle-exclamation text-amber-500 text-2xl" }),
          h3({ class: "text-lg font-semibold text-fg-1" }, "Unsaved Changes"),
        ),
        p(
          { class: "text-sm text-fg-3" },
          "You have unsaved review decisions for the current group. Switching tabs will discard them.",
        ),
        div(
          { class: "flex justify-end gap-3 pt-2" },
          button(
            {
              class: "px-4 py-2 rounded-lg text-sm font-medium bg-surface-inset hover:bg-surface-active text-fg-3",
              onclick: () => cancelUnsavedChanges(),
            },
            "Stay Here",
          ),
          button(
            {
              class: "px-4 py-2 rounded-lg text-sm font-medium bg-amber-600 hover:bg-amber-500 text-white",
              onclick: () => confirmUnsavedChanges(),
            },
            i({ class: "fadr fa-arrow-right mr-2" }),
            "Discard & Switch",
          ),
        ),
      ),
    );
  };
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function DuplicateGroupReview() {
  // Dialogs are mounted outside reviewContent so they don't get
  // torn down / re-created on every signal change.
  const dialogEl = DeleteAllConfirmDialog();
  const unsavedDialogEl = UnsavedChangesDialog();

  // Single flat reactive closure — reads ALL signals and renders everything.
  // No nested reactive closures to prevent Sigment subscription leaks.
  const reviewContent = () => {
    const group = getCurrentGroup();
    const files = getGroupFiles();
    const suggestion = getSuggestion();
    const actionLoading = getActionLoading();
    const gridSize = getGridSize();
    const loading = getLoading();
    const decisions = getLocalDecisions();
    const compareThisId = getCompareThisFileId();
    const keepCount = getKeepCount();
    const history = getGroupHistory();
    const noMoreGroups = !hasMoreGroups();

    // Empty state — loading spinner or "All Done!"
    if (!group && files.length === 0) {
      if (loading) {
        return div(
          { class: "flex flex-col items-center justify-center py-20 text-center" },
          i({ class: "fadr fa-spinner animate-spin text-5xl text-fg-muted mb-4" }),
          h3({ class: "text-xl font-semibold text-fg-2 mb-2" }, "Loading next group..."),
        );
      }

      const error = getError();
      if (error) {
        return div(
          { class: "flex flex-col items-center justify-center py-20 text-center" },
          i({ class: "fadr fa-circle-exclamation text-5xl text-accent-red mb-4" }),
          h3({ class: "text-xl font-semibold text-fg-2 mb-2" }, "Failed to Load"),
          p({ class: "text-accent-red text-sm max-w-md" }, error),
          button(
            {
              class: "mt-4 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium",
              onclick: () => {
                setError(null);
                loadNextGroup();
              },
            },
            i({ class: "fadr fa-arrows-rotate mr-2" }),
            "Retry",
          ),
        );
      }
      return div(
        { class: "flex flex-col items-center justify-center py-20 text-center" },
        i({ class: "fadr fa-party-horn text-5xl text-accent-green mb-4" }),
        h3({ class: "text-xl font-semibold text-fg-2 mb-2" }, "All Done!"),
        p({ class: "text-fg-muted" }, `No pending groups for ${categoryLabel(getActiveCategory())}.`),
        p(
          { class: "text-fg-faint text-sm mt-1" },
          "Switch to another category or refresh to check for new duplicates.",
        ),
      );
    }

    if (!group) return null;

    // Sort files: keep file first, then the rest by id
    const keepFileId = suggestion?.fileId ?? null;
    const keepFile = keepFileId ? (files.find((f) => f.file.id === keepFileId) ?? null) : null;
    const sortedFiles = [...files].sort((a, b) => {
      if (a.file.id === keepFileId) return -1;
      if (b.file.id === keepFileId) return 1;
      return a.file.id - b.file.id;
    });

    // -- Decision summary (was DecisionSummaryText sub-closure) --
    let dKeepCount = 0;
    let dDeleteCount = 0;
    for (const a of decisions.values()) {
      if (a === "keep") dKeepCount++;
      else if (a === "delete") dDeleteCount++;
    }
    const summaryParts: string[] = [];
    if (dKeepCount > 0) summaryParts.push(`${dKeepCount} keep`);
    if (dDeleteCount > 0) summaryParts.push(`${dDeleteCount} delete`);

    // -- Save bar validation (was SaveBarButtons sub-closure) --
    const allDecided = files.every((f) => decisions.has(f.file.id));
    const canSubmit = allDecided;

    // -- Instructional label (was nested reactive closure) --
    let instructionEl: ReturnType<typeof span>;
    if (keepCount === 1 || (keepCount > 1 && compareThisId !== null)) {
      instructionEl = span(
        { class: "text-sm text-amber-700 dark:text-amber-400 flex items-center gap-1.5" },
        i({ class: "fadr fa-arrow-pointer" }),
        "Click an image to compare side-by-side",
      );
    } else if (keepCount === 0) {
      instructionEl = span(
        { class: "text-sm text-fg-muted flex items-center gap-1.5" },
        i({ class: "fadr fa-circle-info" }),
        "Mark a file as Keep to enable comparison",
      );
    } else {
      // keepCount >= 2 && compareThisId === null
      instructionEl = span(
        { class: "text-sm text-amber-700 dark:text-amber-400 flex items-center gap-1.5" },
        i({ class: "fadr fa-crosshairs" }),
        "Set a Compare Reference to enable comparison",
      );
    }

    return div(
      { class: "flex flex-col h-full" },
      // Group action bar
      div(
        { class: "flex-shrink-0 px-4 py-3 bg-zinc-100/50 dark:bg-zinc-800/50 border-b border-edge" },
        div(
          { class: "flex items-center justify-between flex-wrap gap-3" },
          // Left: group info
          div(
            { class: "flex items-center gap-3 flex-wrap" },
            span(
              { class: "px-2 py-0.5 rounded text-sm font-medium bg-surface-inset text-fg-3" },
              `${files.length} files`,
            ),
            group.minPhashDistance !== undefined
              ? span({ class: "text-sm text-orange-400" }, `Min distance: ${group.minPhashDistance}`)
              : null,
          ),
          // Center: instructional label
          instructionEl,
          // Right: bulk actions
          div(
            { class: "flex items-center gap-2" },
            button(
              {
                class: `px-3 py-1.5 rounded text-sm font-medium flex items-center gap-1.5 ${
                  actionLoading
                    ? "bg-surface-inset text-fg-faint cursor-not-allowed"
                    : "bg-emerald-600/20 hover:bg-emerald-600/30 text-accent-green border border-emerald-500/30"
                }`,
                onclick: () => handleKeepAll(),
                disabled: actionLoading,
              },
              i({ class: "fadr fa-check" }),
              "Keep All",
            ),
            button(
              {
                class: `px-3 py-1.5 rounded text-sm font-medium flex items-center gap-1.5 ${
                  actionLoading
                    ? "bg-surface-inset text-fg-faint cursor-not-allowed"
                    : "bg-red-600/20 hover:bg-red-600/30 text-accent-red border border-red-500/30"
                }`,
                onclick: () => handleMarkAllDelete(),
                disabled: actionLoading,
              },
              i({ class: "fadr fa-trash" }),
              "Delete All",
            ),
          ),
        ),
      ),
      // Scrollable content — uniform grid with inline ImageCards (no wrapper closures)
      div(
        { class: "flex-1 overflow-auto p-4" },
        div(
          { class: `grid gap-4 ${getGridColsClass(gridSize)}` },
          ...sortedFiles.map((fileCtx) => {
            const isSuggestedKeep = fileCtx.file.id === keepFileId;
            const timeDiff = !isSuggestedKeep && keepFile ? computeTimeDiff(fileCtx, keepFile) : null;
            const action = decisions.get(fileCtx.file.id);
            const isCompareThis = fileCtx.file.id === compareThisId;
            const disableCompare = isCompareThis || compareThisId === null;

            return ImageCard({
              fileCtx,
              action,
              onToggle: () => toggleFileAction(fileCtx.file.id),
              onCompare: () => openComparison(fileCtx),
              isKeep: isSuggestedKeep,
              disableCompare,
              timeDiff,
              isCompareThis,
              keepCount,
              onSetCompareThis: action === "keep" ? () => setCompareThisFileId(fileCtx.file.id) : undefined,
            });
          }),
        ),
      ),
      // Save & Next bar (sticky bottom)
      div(
        { class: "flex-shrink-0 border-t border-edge px-4 py-3 bg-surface" },
        div(
          { class: "flex items-center justify-between" },
          // Left: decision summary
          span(
            { class: "text-sm text-fg-muted" },
            summaryParts.length > 0 ? summaryParts.join(", ") : "No decisions yet",
          ),
          // Right: action buttons
          div(
            { class: "flex items-center gap-3" },
            !allDecided ? span({ class: "text-xs text-fg-faint mr-2" }, "Set an action for each file.") : null,
            // Prev Group
            button(
              {
                class: `px-3 py-2 rounded-lg text-sm font-medium flex items-center gap-2 ${
                  actionLoading || history.length === 0
                    ? "bg-surface-inset text-fg-faint cursor-not-allowed"
                    : "bg-surface-inset hover:bg-surface-active text-fg-3"
                }`,
                onclick: () => handlePreviousGroup(),
                disabled: actionLoading || history.length === 0,
                title: history.length === 0 ? "No previous group" : "Go back to previous group",
              },
              i({ class: "fadr fa-backward-step" }),
              "Prev Group",
            ),
            // Next Group
            button(
              {
                class: `px-3 py-2 rounded-lg text-sm font-medium flex items-center gap-2 ${
                  actionLoading || noMoreGroups
                    ? "bg-surface-inset text-fg-faint cursor-not-allowed"
                    : "bg-surface-inset hover:bg-surface-active text-fg-3"
                }`,
                onclick: () => handleSkip(),
                disabled: actionLoading || noMoreGroups,
                title: noMoreGroups ? "No more groups in this category" : "Skip to next group",
              },
              i({ class: "fadr fa-forward-step" }),
              "Next Group",
            ),
            // Save & Next
            button(
              {
                class: `px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 ${
                  !canSubmit || actionLoading
                    ? "bg-emerald-600/50 text-emerald-300 cursor-not-allowed"
                    : "bg-emerald-600 hover:bg-emerald-500 text-white"
                }`,
                onclick: () => handleSaveAndNext(),
                disabled: !canSubmit || actionLoading,
              },
              actionLoading ? i({ class: "fadr fa-spinner animate-spin" }) : i({ class: "fadr fa-check" }),
              "Save & Next",
            ),
          ),
        ),
      ),
    );
  };

  return div({ class: "h-full" }, reviewContent, dialogEl, unsavedDialogEl);
}
