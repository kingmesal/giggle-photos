import { BrowserView } from "electrobun/main";
import { getFileServerPort } from "./file-server";
import { getAppInfo } from "./handlers/app-info";
import { getDatabaseInfo, openDatabaseFolder, resetApplication } from "./handlers/database";
import {
  addFolder,
  getFolderStats,
  listFolders,
  removeFolder,
  scanFolderQuick,
  showFolderPicker,
  updateFolder,
} from "./handlers/folders";
import { log } from "./handlers/log";
import { getLogsPathHandler, selectLogsFolder } from "./handlers/logs";
import {
  cancelProcessing,
  getProcessingState,
  getProcessingStatus,
  pauseProcessing,
  resumeProcessing,
  startProcessing,
} from "./handlers/processing";
import {
  applyDeletionsHandler,
  getConflictsHandler,
  getLogicalGroupFilesHandler,
  getPendingGroupsHandler,
  getReviewSummaryHandler,
  resolveConflictHandler,
  submitReviewDecisions,
  undoDecision,
} from "./handlers/review";
import { checkTrashAvailable, getSettings, saveSettings, saveWindowBounds } from "./handlers/settings";
import { getSystemHealth } from "./handlers/system-health";
import type { GigglePhotosRPC } from "./rpc-types";

/** RPC instance for webview-to-main communication. 30s timeout for native dialogs and DB ops. */
export const appRPC = BrowserView.defineRPC<GigglePhotosRPC>({
  maxRequestTime: 30000,
  handlers: {
    requests: {
      log,
      getSettings,
      saveSettings,
      checkTrashAvailable,
      saveWindowBounds,
      getAppInfo,
      getSystemHealth,
      listFolders,
      getFolderStats,
      addFolder,
      updateFolder,
      removeFolder,
      showFolderPicker,
      scanFolderQuick,
      getDatabaseInfo,
      openDatabaseFolder,
      resetApplication,
      getLogsPath: getLogsPathHandler,
      selectLogsFolder,
      // Processing handlers
      startProcessing,
      getProcessingStatus,
      pauseProcessing,
      resumeProcessing,
      cancelProcessing,
      getProcessingState,
      // Review endpoints
      getPendingGroups: getPendingGroupsHandler,
      getLogicalGroupFiles: getLogicalGroupFilesHandler,
      submitReviewDecisions,
      getReviewSummary: getReviewSummaryHandler,
      getConflicts: getConflictsHandler,
      resolveConflict: resolveConflictHandler,
      applyDeletions: applyDeletionsHandler,
      undoDecision,
      getFileServerPort: async () => {
        const port = getFileServerPort();
        return { port: port ?? 0 };
      },
    },
    messages: {},
  },
});
