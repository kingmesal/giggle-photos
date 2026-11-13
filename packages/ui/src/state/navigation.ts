/**
 * Navigation state: which screen is shown. An external store, so any module can navigate and React
 * components re-render through useCurrentView().
 */
import { createStore, useStore } from "../external/store";

/** Available views in the application */
export type ViewName = "processing" | "duplicates" | "tools" | "folders" | "settings";

const view = createStore<ViewName>("folders");

/** Get the current view (non-reactive read). */
export function currentView(): ViewName {
  return view.get();
}

/** Current view, re-rendering on change. */
export function useCurrentView(): ViewName {
  return useStore(view);
}

/** Navigate to a specific view */
export function navigateTo(next: ViewName): void {
  view.set(next);
}

export interface NavItem {
  id: ViewName;
  label: string;
}

export const navItems: NavItem[] = [
  { id: "folders", label: "Folders" },
  { id: "processing", label: "Processing" },
  { id: "duplicates", label: "Duplicates" },
  { id: "tools", label: "Library Tools" },
];
export const settingsNavItem: NavItem = { id: "settings", label: "Settings" };
