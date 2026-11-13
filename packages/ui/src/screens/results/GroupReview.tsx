/** One-group-at-a-time review: group action bar, file grid, and the Save & Next bar. */
import {
  Check,
  CircleAlert,
  Crosshair,
  Info,
  LoaderCircle,
  MousePointer2,
  PartyPopper,
  RefreshCw,
  SkipBack,
  SkipForward,
  Trash2,
} from "lucide-react";
import type { ReactNode } from "react";
import { categoryLabel } from "./categories";
import { useReviewPrefs } from "./prefs";
import { loadNextGroup, previousGroup, saveAndNext, skipGroup } from "./review-actions";
import { hasMoreGroups, keepCount, markAll, type ReviewState, setError, useReview } from "./review-store";
import { ThumbnailGrid } from "./ThumbnailGrid";

const DISABLED = "bg-surface-inset text-fg-faint cursor-not-allowed";
const NAV = "bg-surface-inset hover:bg-surface-active text-fg-3";

function EmptyState({ s }: { s: ReviewState }): ReactNode {
  if (s.loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <LoaderCircle size="1em" className="animate-spin text-5xl text-fg-muted mb-4" />
        <h3 className="text-xl font-semibold text-fg-2 mb-2">Loading next group...</h3>
      </div>
    );
  }
  if (s.error) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <CircleAlert size="1em" className="text-5xl text-accent-red mb-4" />
        <h3 className="text-xl font-semibold text-fg-2 mb-2">Failed to Load</h3>
        <p className="text-accent-red text-sm max-w-md">{s.error}</p>
        <button
          type="button"
          className="mt-4 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium flex items-center"
          onClick={() => {
            setError(null);
            void loadNextGroup();
          }}
        >
          <RefreshCw size="1em" className="mr-2" />
          Retry
        </button>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <PartyPopper size="1em" className="text-5xl text-accent-green mb-4" />
      <h3 className="text-xl font-semibold text-fg-2 mb-2">All Done!</h3>
      <p className="text-fg-muted">{`No pending groups for ${categoryLabel(s.category)}.`}</p>
      <p className="text-fg-faint text-sm mt-1">Switch to another category or refresh to check for new duplicates.</p>
    </div>
  );
}

function Instruction({ keeps, compareThisId }: { keeps: number; compareThisId: number | null }): ReactNode {
  const amber = "text-sm text-amber-700 dark:text-amber-400 flex items-center gap-1.5";
  if (keeps === 1 || (keeps > 1 && compareThisId !== null)) {
    return (
      <span className={amber}>
        <MousePointer2 size="1em" />
        Click an image to compare side-by-side
      </span>
    );
  }
  if (keeps === 0) {
    return (
      <span className="text-sm text-fg-muted flex items-center gap-1.5">
        <Info size="1em" />
        Mark a file as Keep to enable comparison
      </span>
    );
  }
  return (
    <span className={amber}>
      <Crosshair size="1em" />
      Set a Compare Reference to enable comparison
    </span>
  );
}

function SaveBar({ s, allDecided }: { s: ReviewState; allDecided: boolean }): ReactNode {
  let keeps = 0;
  let deletes = 0;
  for (const a of s.decisions.values()) {
    if (a === "keep") keeps++;
    else if (a === "delete") deletes++;
  }
  const parts = [keeps > 0 ? `${keeps} keep` : "", deletes > 0 ? `${deletes} delete` : ""].filter(Boolean);
  const noHistory = s.history.length === 0;
  const noMore = !hasMoreGroups(s);
  const busy = s.actionLoading;
  const canSubmit = allDecided && !busy;
  return (
    <div className="flex-shrink-0 border-t border-edge px-4 py-3 bg-surface">
      <div className="flex items-center justify-between">
        <span className="text-sm text-fg-muted">{parts.length > 0 ? parts.join(", ") : "No decisions yet"}</span>
        <div className="flex items-center gap-3">
          {!allDecided && <span className="text-xs text-fg-faint mr-2">Set an action for each file.</span>}
          <button
            type="button"
            className={`px-3 py-2 rounded-lg text-sm font-medium flex items-center gap-2 ${busy || noHistory ? DISABLED : NAV}`}
            onClick={() => void previousGroup()}
            disabled={busy || noHistory}
            title={noHistory ? "No previous group" : "Go back to previous group"}
          >
            <SkipBack size="1em" />
            Prev Group
          </button>
          <button
            type="button"
            className={`px-3 py-2 rounded-lg text-sm font-medium flex items-center gap-2 ${busy || noMore ? DISABLED : NAV}`}
            onClick={() => void skipGroup()}
            disabled={busy || noMore}
            title={noMore ? "No more groups in this category" : "Skip to next group"}
          >
            <SkipForward size="1em" />
            Next Group
          </button>
          <button
            type="button"
            className={`px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 ${
              canSubmit
                ? "bg-emerald-600 hover:bg-emerald-500 text-white"
                : "bg-emerald-600/50 text-emerald-800 dark:text-emerald-300 cursor-not-allowed"
            }`}
            onClick={() => void saveAndNext()}
            disabled={!canSubmit}
          >
            {busy ? <LoaderCircle size="1em" className="animate-spin" /> : <Check size="1em" />}
            Save &amp; Next
          </button>
        </div>
      </div>
    </div>
  );
}

function BulkButton({ kind, busy }: { kind: "keep" | "delete"; busy: boolean }): ReactNode {
  const active =
    kind === "keep"
      ? "bg-emerald-600/20 hover:bg-emerald-600/30 text-accent-green border border-emerald-500/30"
      : "bg-red-600/20 hover:bg-red-600/30 text-accent-red border border-red-500/30";
  return (
    <button
      type="button"
      className={`px-3 py-1.5 rounded text-sm font-medium flex items-center gap-1.5 ${busy ? DISABLED : active}`}
      onClick={() => markAll(kind)}
      disabled={busy}
    >
      {kind === "keep" ? <Check size="1em" /> : <Trash2 size="1em" />}
      {kind === "keep" ? "Keep All" : "Delete All"}
    </button>
  );
}

export function GroupReview(): ReactNode {
  const s = useReview();
  const { gridSize } = useReviewPrefs();
  const { group, files, decisions } = s;
  if (!group) return files.length === 0 ? <EmptyState s={s} /> : null;

  const keeps = keepCount(decisions);
  const allDecided = files.every((f) => decisions.has(f.file.id));
  return (
    <div className="flex flex-col h-full">
      <div className="flex-shrink-0 px-4 py-3 bg-zinc-100/50 dark:bg-zinc-800/50 border-b border-edge">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="px-2 py-0.5 rounded text-sm font-medium bg-surface-inset text-fg-3">{`${files.length} files`}</span>
            {group.minPhashDistance !== undefined && (
              <span className="text-sm text-orange-700 dark:text-orange-400">{`Min distance: ${group.minPhashDistance}`}</span>
            )}
            {group.method === "clip" && (
              <span className="text-sm text-teal-700 dark:text-teal-400" data-testid="clip-review-note">
                {`Closest: ${group.minClipDistance?.toFixed(3) ?? "—"} · nothing preselected: bursts and edits look alike`}
              </span>
            )}
          </div>
          <Instruction keeps={keeps} compareThisId={s.compareThisId} />
          <div className="flex items-center gap-2">
            <BulkButton kind="keep" busy={s.actionLoading} />
            <BulkButton kind="delete" busy={s.actionLoading} />
          </div>
        </div>
      </div>
      <ThumbnailGrid
        files={files}
        decisions={decisions}
        suggestedKeepId={s.suggestion?.fileId || null}
        compareThisId={s.compareThisId}
        keepCount={keeps}
        gridSize={gridSize}
      />
      <SaveBar s={s} allDecided={allDecided} />
    </div>
  );
}
