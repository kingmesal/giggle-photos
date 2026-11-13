/** Screen registry: which component renders each sidebar destination. */
import type { ComponentType } from "react";
import { CaptureDatesScreen } from "../screens/dates/CaptureDatesScreen";
import { FoldersScreen } from "../screens/folders/FoldersScreen";
import { ProcessingScreen } from "../screens/processing/ProcessingScreen";
import { ResultsScreen } from "../screens/results/ResultsScreen";
import { SettingsScreen } from "../screens/settings/SettingsScreen";
import type { ViewName } from "../state/navigation";

export const VIEWS: Record<ViewName, ComponentType> = {
  folders: FoldersScreen,
  processing: ProcessingScreen,
  duplicates: ResultsScreen,
  dates: CaptureDatesScreen,
  settings: SettingsScreen,
};
