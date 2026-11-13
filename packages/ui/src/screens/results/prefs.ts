/** Persisted review preferences: grid size, compare view mode, allowDeleteAll (saved via saveSettings). */
import { createStore, useStore } from "../../external/store";
import { getLogger } from "../../services/logger-service";
import { type Settings, saveSettings } from "../../services/settings-service";

const log = getLogger("ui:review-prefs");

export type GridSize = "sm" | "md" | "lg" | "xl";
export type CompareViewMode = "large" | "balanced" | "compact" | "xl";

export interface ReviewPrefs {
  gridSize: GridSize;
  compareViewMode: CompareViewMode;
  allowDeleteAll: boolean;
}

const DEFAULT_PREFS: ReviewPrefs = { gridSize: "md", compareViewMode: "balanced", allowDeleteAll: false };
const GRID_SIZES: readonly string[] = ["sm", "md", "lg", "xl"];
const VIEW_MODES: readonly string[] = ["large", "balanced", "compact", "xl"];

export const prefsStore = createStore<ReviewPrefs>(DEFAULT_PREFS);

export function useReviewPrefs(): ReviewPrefs {
  return useStore(prefsStore);
}

/** Take the review preferences from loaded settings (invalid values keep the current ones). */
export function applyLoadedPrefs(settings: Settings): void {
  prefsStore.set((p) => ({
    gridSize: GRID_SIZES.includes(settings.reviewGridSize) ? (settings.reviewGridSize as GridSize) : p.gridSize,
    compareViewMode: VIEW_MODES.includes(settings.compareViewMode)
      ? (settings.compareViewMode as CompareViewMode)
      : p.compareViewMode,
    allowDeleteAll: settings.allowDeleteAll ? true : p.allowDeleteAll,
  }));
  log.debug("Loaded UI preferences", {
    gridSize: settings.reviewGridSize,
    compareViewMode: settings.compareViewMode,
    allowDeleteAll: settings.allowDeleteAll,
  });
}

export function setGridSize(gridSize: GridSize): void {
  prefsStore.set((p) => ({ ...p, gridSize }));
  saveSettings({ reviewGridSize: gridSize }).catch((e) => log.warn("Failed to save grid size", e));
}

export function setCompareViewMode(compareViewMode: CompareViewMode): void {
  prefsStore.set((p) => ({ ...p, compareViewMode }));
  saveSettings({ compareViewMode }).catch((e) => log.warn("Failed to save compare view mode", e));
}

/** Stop asking before a group is saved with every file marked delete. */
export function allowDeleteAll(): void {
  prefsStore.set((p) => ({ ...p, allowDeleteAll: true }));
  saveSettings({ allowDeleteAll: true }).catch((e) => log.warn("Failed to save allowDeleteAll", e));
}

/** Tailwind grid-cols class for a grid size. */
export function gridColumns(size: GridSize): number {
  return { sm: 6, md: 4, lg: 3, xl: 2 }[size];
}

export function gridColsClass(size: GridSize): string {
  return { sm: "grid-cols-6", md: "grid-cols-4", lg: "grid-cols-3", xl: "grid-cols-2" }[size];
}

/** Test helper: back to defaults. */
export function resetReviewPrefs(): void {
  prefsStore.set(DEFAULT_PREFS);
}
