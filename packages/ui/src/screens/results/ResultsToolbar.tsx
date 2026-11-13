/** Above the group review: error banner, summary stat cards, category tabs, and the grid-size selector. */
import { CircleAlert, CircleCheck, Clock, Eye, Fingerprint, Image, ListChecks, Trash2, X } from "lucide-react";
import type { ReactNode } from "react";
import type { ReviewSummary } from "../../services/processing";
import {
  CATEGORIES,
  categoryActiveColor,
  categoryBadgeActiveColor,
  categoryLabel,
  type ReviewCategory,
} from "./categories";
import { type GridSize, setGridSize } from "./prefs";
import { changeCategory } from "./review-actions";
import { setError, totalPending } from "./review-store";

export function ErrorBanner({ error }: { error: string | null }): ReactNode {
  if (!error) return null;
  return (
    <div className="mb-4 p-3 rounded-lg bg-red-500/20 border border-red-500/30 text-accent-red text-sm flex items-center gap-2">
      <CircleAlert size="1em" />
      {error}
      <button
        type="button"
        aria-label="Dismiss"
        className="ml-auto text-accent-red hover:text-red-300"
        onClick={() => setError(null)}
      >
        <X size="1em" />
      </button>
    </div>
  );
}

export function SummaryCards({ summary }: { summary: ReviewSummary }): ReactNode {
  const cards = [
    {
      label: "Pending Groups",
      value: totalPending(summary),
      icon: <Clock size="1em" />,
      color: "bg-amber-500/20 text-accent-amber",
    },
    {
      label: "Files to Keep",
      value: summary.decidedKeep,
      icon: <CircleCheck size="1em" />,
      color: "bg-emerald-500/20 text-accent-green",
    },
    {
      label: "Files to Delete",
      value: summary.decidedDelete,
      icon: <Trash2 size="1em" />,
      color: "bg-red-500/20 text-accent-red",
    },
    {
      label: "Total Decisions",
      value: summary.decidedKeep + summary.decidedDelete,
      icon: <ListChecks size="1em" />,
      color: "bg-blue-500/20 text-accent-blue",
    },
  ];
  return (
    <div className="grid grid-cols-4 gap-4 mb-4">
      {cards.map((c) => (
        <div key={c.label} className="bg-surface-card rounded-lg border border-edge p-3">
          <div className="flex items-center gap-2">
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${c.color}`}>{c.icon}</div>
            <div>
              <p className="text-lg font-semibold">{String(c.value)}</p>
              <p className="text-xs text-fg-muted">{c.label}</p>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function countFor(cat: ReviewCategory, summary: ReviewSummary): number {
  if (cat === "sha256") return summary.pendingSha256;
  if (cat === "content_hash") return summary.pendingContentHash;
  if (cat === "phash_identical") return summary.phashIdenticalPairs;
  return summary.phashSimilarPairs;
}

export function CategoryTabs({ active, summary }: { active: ReviewCategory; summary: ReviewSummary }): ReactNode {
  return (
    <div className="flex items-center gap-1">
      {CATEGORIES.map((cat) => {
        const isActive = active === cat;
        const count = countFor(cat, summary);
        return (
          <button
            key={cat}
            type="button"
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${
              isActive ? categoryActiveColor(cat) : "bg-surface-inset text-fg-3 hover:bg-surface-active"
            }`}
            onClick={() => changeCategory(cat)}
          >
            {cat === "sha256" ? (
              <Fingerprint size="1em" />
            ) : cat === "content_hash" ? (
              <Image size="1em" />
            ) : (
              <Eye size="1em" />
            )}
            {categoryLabel(cat)}
            {count > 0 && (
              <span
                className={`px-1.5 py-0.5 rounded-full text-xs ${
                  isActive ? categoryBadgeActiveColor(cat) : "bg-zinc-300 dark:bg-zinc-600 text-fg-3"
                }`}
              >
                {String(count)}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

const SIZES: Array<{ id: GridSize; label: string; iconSize: string }> = [
  { id: "sm", label: "Small", iconSize: "text-xs" },
  { id: "md", label: "Medium", iconSize: "text-sm" },
  { id: "lg", label: "Large", iconSize: "text-base" },
  { id: "xl", label: "Extra Large", iconSize: "text-xl" },
];

/** Graduated image icons, small → large. */
export function GridSizeSelector({ current }: { current: GridSize }): ReactNode {
  return (
    <div className="flex items-center gap-1">
      {SIZES.map(({ id, label, iconSize }) => (
        <button
          key={id}
          type="button"
          className={`w-8 h-7 rounded flex items-center justify-center ${
            current === id
              ? "bg-blue-600 text-white"
              : "bg-surface-inset text-fg-muted hover:bg-surface-active hover:text-fg-2"
          }`}
          title={label}
          onClick={() => setGridSize(id)}
        >
          <Image size="1em" className={iconSize} />
        </button>
      ))}
    </div>
  );
}
