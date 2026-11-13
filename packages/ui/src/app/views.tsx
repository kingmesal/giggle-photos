/** Screen registry: which component renders each sidebar destination. */
import type { ComponentType } from "react";
import { FoldersScreen } from "../screens/folders/FoldersScreen";
import { ProcessingScreen } from "../screens/processing/ProcessingScreen";
import { ResultsScreen } from "../screens/results/ResultsScreen";
import { SettingsScreen } from "../screens/settings/SettingsScreen";
import { LibraryToolsScreen } from "../screens/tools/LibraryToolsScreen";
import type { ViewName } from "../state/navigation";

export const VIEWS: Record<ViewName, ComponentType> = {
  folders: FoldersScreen,
  processing: ProcessingScreen,
  duplicates: ResultsScreen,
  tools: LibraryToolsScreen,
  settings: SettingsScreen,
};
