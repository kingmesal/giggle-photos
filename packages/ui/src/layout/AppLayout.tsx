import type { ComponentType } from "react";
import { ClipSetupScreen } from "../screens/setup/ClipSetupScreen";
import { useCurrentView, type ViewName } from "../state/navigation";
import { Sidebar } from "./Sidebar";

/**
 * Main application layout: sidebar plus the current screen (remounted when you navigate to it), and the
 * first-run CLIP setup screen over it while the model is being set up.
 */
export function AppLayout({ views }: { views: Record<ViewName, ComponentType> }) {
  const view = useCurrentView();
  const Screen = views[view];
  return (
    <div className="flex h-screen bg-surface text-fg">
      <Sidebar />
      <main className="flex-1 overflow-auto">
        <Screen key={view} />
      </main>
      <ClipSetupScreen />
    </div>
  );
}
