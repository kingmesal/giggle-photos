/**
 * Main application layout component
 * Note: HTML element functions (div, main) are globals provided by Sigment
 */

import { currentView, type ViewName } from "../state/navigation";
import { Sidebar } from "./Sidebar";

/** Props for view components */
export type ViewProps = Record<string, never>;

/** View registry type */
type ViewRegistry = Record<ViewName, () => HTMLElement>;

/** Placeholder view for unimplemented views */
function PlaceholderView(name: string) {
  return div(
    { class: "flex items-center justify-center h-full text-fg-muted" },
    div(
      { class: "text-center" },
      div({ class: "text-4xl mb-4" }, "🚧"),
      div({ class: "text-lg" }, `${name} view coming soon`),
    ),
  );
}

/** Main application layout with sidebar and content area */
export function AppLayout(views: Partial<ViewRegistry>) {
  // Content area that switches based on current view
  const ContentArea = () => {
    const view = currentView();
    const ViewComponent = views[view];

    if (ViewComponent) {
      return ViewComponent();
    }

    // Fallback to placeholder
    const viewLabels: Record<ViewName, string> = {
      processing: "Processing Pipeline",
      duplicates: "Duplicate Groups",
      folders: "Source Folders",
      settings: "Settings",
    };
    return PlaceholderView(viewLabels[view]);
  };

  return div(
    { class: "flex h-screen bg-surface text-fg" },
    Sidebar(),
    main({ class: "flex-1 overflow-auto" }, ContentArea),
  );
}
