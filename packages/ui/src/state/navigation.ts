/**
 * Navigation state management using Sigment signals
 */
import { signal } from "sigment";

/** Available views in the application */
export type ViewName = "processing" | "duplicates" | "folders" | "settings";

/** Navigation state - returns [getter, setter] tuple */
const [getView, setView] = signal<ViewName>("folders");

/** Get the current view */
export function currentView(): ViewName {
  return getView();
}

/** Navigation items configuration */
export interface NavItem {
  id: ViewName;
  label: string;
  icon: string;
}

export const navItems: NavItem[] = [
  { id: "folders", label: "Folders", icon: "fa-folders" },
  { id: "processing", label: "Processing", icon: "fa-list-check" },
  { id: "duplicates", label: "Duplicates", icon: "fa-clone" },
];

export const settingsNavItem: NavItem = { id: "settings", label: "Settings", icon: "fa-gear" };

/** Navigate to a specific view */
export function navigateTo(view: ViewName): void {
  setView(view);
}
