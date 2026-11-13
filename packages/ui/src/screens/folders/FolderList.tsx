/** The folder list: loading, empty state, or sortable header plus rows. */
import { ArrowDown01, ArrowDownAZ, ArrowUp01, ArrowUpAZ, FolderOpen, LoaderCircle } from "lucide-react";
import type { ReactElement } from "react";
import type { ScanFolder } from "../../services/folders-service";
import { FolderRow, type FolderRowActions } from "./FolderRow";
import { ICON, type SortKey, type SortState } from "./format";

const COLUMN = "w-24 text-center text-xs font-medium text-fg-muted uppercase tracking-wide";

function SortableHeader({
  label,
  sortKey,
  sort,
  onSort,
}: {
  label: string;
  sortKey: SortKey;
  sort: SortState;
  onSort: (key: SortKey) => void;
}): ReactElement {
  const isActive = sort.by === sortKey;
  const asc = sort.direction === "asc";
  const Icon = sortKey === "name" ? (asc ? ArrowDownAZ : ArrowUpAZ) : asc ? ArrowDown01 : ArrowUp01;
  return (
    <button
      type="button"
      className={`flex items-center gap-2 text-xs font-medium uppercase tracking-wide transition-colors cursor-pointer ${
        isActive ? "text-fg-3" : "text-fg-muted hover:text-fg-3"
      }`}
      onClick={() => onSort(sortKey)}
      title={
        isActive
          ? `Click to sort ${asc ? "descending" : "ascending"}`
          : `Click to sort by ${sortKey === "name" ? "name" : "priority"}`
      }
    >
      <span>{label}</span>
      {isActive && <Icon size="1em" className={`${ICON} text-xs`} data-testid={`sort-${sortKey}-${sort.direction}`} />}
    </button>
  );
}

export function FolderList({
  folders,
  loading,
  sort,
  onSort,
  actions,
}: {
  folders: ScanFolder[];
  loading: boolean;
  sort: SortState;
  onSort: (key: SortKey) => void;
  actions: FolderRowActions;
}): ReactElement {
  // As before: a re-read with folders on screen shows the spinner; the first read shows the empty state.
  if (loading && folders.length > 0) {
    return (
      <div className="flex items-center justify-center py-12 text-fg-muted">
        <LoaderCircle size="1em" className={`${ICON} animate-spin text-2xl mr-3`} />
        Loading folders...
      </div>
    );
  }

  if (folders.length === 0) {
    return (
      <div className="bg-surface-card rounded-xl border border-edge p-12 text-center">
        <FolderOpen size="1em" className="block mx-auto text-4xl text-zinc-300 dark:text-zinc-600 mb-4" />
        <p className="text-fg-muted mb-2">No folders added yet</p>
        <p className="text-sm text-fg-faint">Click 'Add Folder' to get started</p>
      </div>
    );
  }

  return (
    <div className="bg-surface-card rounded-xl border border-edge overflow-hidden">
      <div className="px-5 py-3 border-b border-edge bg-zinc-200/30 dark:bg-zinc-700/30 flex items-center gap-4">
        <div className="flex-1">
          <SortableHeader label="Folder" sortKey="name" sort={sort} onSort={onSort} />
        </div>
        <div className={`${COLUMN} whitespace-nowrap`}>Scan All</div>
        <div className={`${COLUMN} whitespace-nowrap`}>Videos</div>
        <div className="w-32 text-center">
          <SortableHeader label="Priority" sortKey="priority" sort={sort} onSort={onSort} />
        </div>
        <div className={COLUMN}>Status</div>
        <div className="w-20" />
      </div>
      <div className="divide-y divide-zinc-200 dark:divide-zinc-700">
        {folders.map((folder) => (
          <FolderRow key={folder.id} folder={folder} actions={actions} />
        ))}
      </div>
    </div>
  );
}
