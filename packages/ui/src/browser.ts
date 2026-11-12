/**
 * Browser-safe exports for webview/browser code
 * Does NOT include any Node.js dependencies
 */

// Interim Lucide renderer for legacy icon markup (removed with Sigment, RFD-004)
export { startIconShim } from "./icons/icon-shim";
// Layout components
export { AppLayout } from "./layout/AppLayout";
export { Sidebar } from "./layout/Sidebar";
export {
  type AppInfo,
  type AppInfoRPC,
  getAppInfo,
  initAppInfoService,
} from "./services/app-info-service";
export {
  type DatabaseInfo,
  type DatabaseRPC,
  getDatabaseInfo,
  initDatabaseService,
  openDatabaseFolder,
  resetApplication,
} from "./services/database-service";
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
// State
export { currentView, type NavItem, navItems, navigateTo, settingsNavItem, type ViewName } from "./state/navigation";
export { FoldersView, initFoldersService } from "./views/FoldersView";
// Views
export { initProcessingService, ProcessingView } from "./views/ProcessingView";
export { initResultsService, ResultsView } from "./views/ResultsView";
export { formatGpsCoords, setFileServerPort } from "./views/ReviewSignals";
export { SettingsView } from "./views/SettingsView";
