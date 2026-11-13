/**
 * Browser-safe exports for webview/browser code
 * Does NOT include any Node.js dependencies
 */

export { mountApp } from "./app/mount";
export { FoldersScreen } from "./screens/folders/FoldersScreen";
// Views
export { ProcessingScreen } from "./screens/processing/ProcessingScreen";
// App root (React)
export { ResultsScreen } from "./screens/results/ResultsScreen";
export { SettingsScreen } from "./screens/settings/SettingsScreen";
export {
  type AppInfo,
  type AppInfoRPC,
  getAppInfo,
  initAppInfoService,
} from "./services/app-info-service";
export { type ClipModelStatus, type ClipRPC, initClipService } from "./services/clip-service";
export {
  type DatabaseInfo,
  type DatabaseRPC,
  getDatabaseInfo,
  initDatabaseService,
  openDatabaseFolder,
  resetApplication,
} from "./services/database-service";
export { initFoldersService } from "./services/folders-service";
export {
  getLogger,
  initLoggerService,
  type Logger,
  type LoggerRPC,
} from "./services/logger-service";
export {
  getLogsPath,
  initLogsService,
  type LogsRPC,
  selectLogsFolder,
} from "./services/logs-service";
export { initProcessingService } from "./services/processing-view-service";
export { formatGpsCoords, initResultsService, setFileServerPort } from "./services/review-service";
// Services
export {
  checkTrashAvailable,
  initSettingsService,
  loadSettings,
  type Settings,
  type SettingsRPC,
  saveSettings,
} from "./services/settings-service";
export {
  getCachedSystemHealth,
  getSystemHealth,
  initSystemHealthService,
  type SystemHealth,
  type SystemHealthRPC,
} from "./services/system-health-service";
export {
  initTakeoutService,
  type TakeoutReport,
  type TakeoutRPC,
} from "./services/takeout-service";
// State
export { currentView, type NavItem, navItems, navigateTo, settingsNavItem, type ViewName } from "./state/navigation";
