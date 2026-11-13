import type { ComponentType } from "react";
import { useCurrentView, type ViewName } from "../state/navigation";
import { Sidebar } from "./Sidebar";

/** Main application layout: sidebar plus the current screen. Remounts a screen when you navigate to it. */
export function AppLayout({ views }: { views: Record<ViewName, ComponentType> }) {
  const view = useCurrentView();
  const Screen = views[view];
  return (
    <div className="flex h-screen bg-surface text-fg">
      <Sidebar />
      <main className="flex-1 overflow-auto">
        <Screen key={view} />
      </main>
    </div>
  );
}
