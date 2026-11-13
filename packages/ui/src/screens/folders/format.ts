/** Pure helpers for the Folders screen: number formatting and sorting. */
import type { ScanFolder } from "../../services/folders-service";

export type SortKey = "priority" | "name";
export type SortDirection = "asc" | "desc";
export interface SortState {
  by: SortKey;
  direction: SortDirection;
}

/** Shared class for inline Lucide icons sized by the surrounding font size (like the old FA icons). */
export const ICON = "inline-block align-[-0.125em]";

/** Bytes to a human-readable size ("0 B", "1.5 MB"). */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / k ** i).toFixed(1)} ${sizes[i]}`;
}

/** Counts of 1000+ shown approximately ("~1.2k"). */
export function formatApprox(value: number): string {
  if (value === 0) return "0";
  if (value < 1000) return String(value);
  return `~${(value / 1000).toFixed(1)}k`;
}

/** Sort by priority (then path) or by path, in the given direction. Returns a new array. */
export function sortFolders(folders: readonly ScanFolder[], sort: SortState): ScanFolder[] {
  const sorted = [...folders];
  const multiplier = sort.direction === "asc" ? 1 : -1;
  if (sort.by === "priority") {
    sorted.sort((a, b) =>
      a.priority !== b.priority ? (a.priority - b.priority) * multiplier : a.path.localeCompare(b.path),
    );
  } else {
    sorted.sort((a, b) => a.path.localeCompare(b.path) * multiplier);
  }
  return sorted;
}

/** Clicking a column: toggle direction if it is already the sort key, else sort by it ascending. */
export function nextSort(current: SortState, key: SortKey): SortState {
  if (current.by === key) return { by: key, direction: current.direction === "asc" ? "desc" : "asc" };
  return { by: key, direction: "asc" };
}
