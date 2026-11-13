/**
 * Review Duplicates screen: header (progress, conflicts, apply), stats, category tabs, grid size, the
 * one-group-at-a-time review, the comparison modal, and the dialogs.
 *
 * Loading: the first visit, and every review-data version change (e.g. a folder was removed), drops the
 * cached groups and history and reloads. Returning to the screen otherwise keeps where you were.
 */
import { Images, LoaderCircle, Trash2, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { useRead } from "../../external/use-read";
import { useReviewDataVersion } from "../../state/review-events";
import { ApplyConfirmDialog } from "./ApplyConfirmDialog";
import { openApplyDialog } from "./apply-actions";
import { ComparisonModal } from "./ComparisonModal";
import { ConflictsDialog } from "./ConflictsDialog";
import { referenceFile } from "./compare-meta";
import { GroupReview } from "./GroupReview";
import { useReviewPrefs } from "./prefs";
import { CategoryTabs, ErrorBanner, GridSizeSelector, SummaryCards } from "./ResultsToolbar";
import { DeleteAllDialog, UnsavedChangesDialog } from "./ReviewDialogs";
import { reloadForVersion } from "./review-actions";
import { patchReview, type ReviewState, totalPending, useReview } from "./review-store";

function ApplyButton({ s }: { s: ReviewState }): ReactNode {
  const deleteCount = s.summary.decidedDelete;
  if (deleteCount <= 0) return null;
  const pending = totalPending(s.summary);
  const conflicts = s.summary.conflictCount;
  const disabled = s.actionLoading || pending > 0 || conflicts > 0;
  let tooltip = "";
  if (pending > 0 && conflicts > 0)
    tooltip = `${pending} pending groups and ${conflicts} conflicts must be resolved first`;
  else if (pending > 0) tooltip = `${pending} pending groups must be reviewed first`;
  else if (conflicts > 0) tooltip = `${conflicts} conflicts must be resolved first`;
  return (
    <button
      type="button"
      className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${
        disabled ? "bg-red-600/30 text-red-300 cursor-not-allowed" : "bg-red-600 hover:bg-red-500 text-white"
      }`}
      onClick={disabled ? undefined : () => void openApplyDialog()}
      disabled={disabled}
      title={tooltip || undefined}
    >
      <Trash2 size="1em" />
      {`Apply Deletions (${deleteCount})`}
    </button>
  );
}

function Header({ s }: { s: ReviewState }): ReactNode {
  const conflicts = s.summary.conflictCount;
  return (
    <header className="flex-shrink-0 bg-surface border-b border-edge px-6 py-4 z-10">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div>
            <h2 className="text-xl font-semibold text-fg">Review Duplicates</h2>
            <p className="text-sm text-fg-muted mt-0.5">
              {s.totalGroups > 0
                ? `Group ${s.groupIndex} of ${s.totalGroups}`
                : "Review and decide which files to keep or delete"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {conflicts > 0 && (
            <button
              type="button"
              className="px-4 py-2 rounded-lg text-sm font-medium bg-amber-600/20 hover:bg-amber-600/30 text-accent-amber border border-amber-500/30 flex items-center gap-2"
              onClick={() => patchReview({ dialog: "conflicts" })}
            >
              <TriangleAlert size="1em" />
              {`Resolve Conflicts (${conflicts})`}
            </button>
          )}
          <ApplyButton s={s} />
        </div>
      </div>
    </header>
  );
}

function Content({ s }: { s: ReviewState }): ReactNode {
  const { gridSize } = useReviewPrefs();
  const hasAnyResults = totalPending(s.summary) > 0 || s.summary.decidedKeep + s.summary.decidedDelete > 0;
  if (!s.hasAttemptedLoad) {
    return (
      <div className="flex items-center justify-center h-full text-fg-muted">
        <LoaderCircle size="1em" className="animate-spin text-2xl mr-3" />
        Loading...
      </div>
    );
  }
  if (!hasAnyResults && !s.loading) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center px-6">
        <Images size="1em" className="text-6xl text-zinc-400 dark:text-zinc-600 mb-6" />
        <h3 className="text-xl font-semibold text-fg-2 mb-2">No Duplicates Found Yet</h3>
        <p className="text-fg-muted max-w-md">
          Run the processing pipeline to scan your files and detect duplicates. Once complete, duplicate groups will
          appear here for review.
        </p>
      </div>
    );
  }
  return (
    <div className="flex flex-col h-full">
      <div className="flex-shrink-0 p-4 bg-zinc-50/50 dark:bg-zinc-900/50">
        <ErrorBanner error={s.error} />
        <SummaryCards summary={s.summary} />
        <div className="flex items-center justify-between gap-4">
          <CategoryTabs active={s.category} summary={s.summary} />
          <GridSizeSelector current={gridSize} />
        </div>
      </div>
      <div className="flex-1 overflow-hidden">
        <GroupReview />
      </div>
    </div>
  );
}

function Overlays({ s }: { s: ReviewState }): ReactNode {
  const keepFile = s.compareFile ? referenceFile(s.files, s.compareThisId, s.suggestion) : null;
  return (
    <>
      {s.compareFile && keepFile && (
        <ComparisonModal
          key={`${keepFile.file.id}:${s.compareFile.file.id}`}
          keepFile={keepFile}
          compareFile={s.compareFile}
          decisions={s.decisions}
        />
      )}
      {s.dialog === "apply" && <ApplyConfirmDialog preview={s.applyPreview} useTrash={s.applyUseTrash} />}
      {s.dialog === "conflicts" && <ConflictsDialog />}
      {s.dialog === "deleteAll" && <DeleteAllDialog />}
      {s.dialog === "unsaved" && <UnsavedChangesDialog />}
    </>
  );
}

export function ResultsScreen(): ReactNode {
  const s = useReview();
  const version = useReviewDataVersion();
  useRead(`review-data:${version}`, () => reloadForVersion(version), { skip: s.loadedVersion === version });
  return (
    <div className="h-full flex flex-col">
      <Header s={s} />
      <div className="flex-1 overflow-hidden flex flex-col">
        <Content s={s} />
      </div>
      <Overlays s={s} />
    </div>
  );
}
