/**
 * Main view entry point for the Giggle Photos app
 * This file runs in the webview context (browser)
 */

import type { ReviewSummary } from "@giggle-photos/core/review/review-queries";
// Use browser entry point to avoid Node.js dependencies
import {
  getLogger,
  initAppInfoService,
  initClipService,
  initDatabaseService,
  initFoldersService,
  initLoggerService,
  initLogsService,
  initProcessingService,
  initQuarantineService,
  initResultsService,
  initSettingsService,
  initSystemHealthService,
  initTakeoutService,
  mountApp,
  setFileServerPort,
} from "@giggle-photos/ui/browser";
import Electrobun, { Electroview } from "electrobun/view";
import type { GigglePhotosRPC } from "../bun/rpc-types";

// Create RPC client for communicating with main process
// Increased timeout to 30 seconds to handle native dialogs (folder picker) and database operations
const rpc = Electroview.defineRPC<GigglePhotosRPC>({
  maxRequestTime: 30000,
  handlers: {
    requests: {},
    messages: {},
  },
});

// Initialize Electrobun with RPC
const electrobun = new Electrobun.Electroview({ rpc });

// Initialize logger service with RPC immediately
const logRpc = electrobun.rpc?.request?.log;
if (logRpc) {
  initLoggerService({
    log: async (params) => {
      const result = await logRpc(params);
      return result as { success: boolean };
    },
  });
}

// Get logger for this module
const log = getLogger("ui:main");

// Initialize the application when DOM is ready
document.addEventListener("DOMContentLoaded", () => {
  log.info("Giggle Photos app loaded");

  // Initialize settings service with RPC
  const getSettingsRpc = electrobun.rpc?.request?.getSettings;
  const saveSettingsRpc = electrobun.rpc?.request?.saveSettings;
  const checkTrashRpc = electrobun.rpc?.request?.checkTrashAvailable;
  if (getSettingsRpc && saveSettingsRpc) {
    initSettingsService({
      getSettings: async () => {
        try {
          // Core AppSettings: every field passes through (no hand-maintained field list).
          return await getSettingsRpc({});
        } catch (error) {
          log.error("Failed to get settings", error);
          throw error;
        }
      },
      saveSettings: async (settings) => {
        try {
          return await saveSettingsRpc(settings as Parameters<typeof saveSettingsRpc>[0]);
        } catch (error) {
          log.error("Failed to save settings", error);
          throw error;
        }
      },
      checkTrashAvailable: async () => {
        if (!checkTrashRpc) return { available: false, command: null, installHint: "" };
        try {
          return await checkTrashRpc({});
        } catch (error) {
          log.error("Failed to check trash availability", error);
          return { available: false, command: null, installHint: "" };
        }
      },
    });
    log.debug("Settings service initialized with RPC");
  } else {
    log.warn("Settings RPC methods not available - settings functionality will be limited");
  }

  // Initialize app info service with RPC
  const getAppInfoRpc = electrobun.rpc?.request?.getAppInfo;
  if (getAppInfoRpc) {
    initAppInfoService({
      getAppInfo: async () => {
        const result = await getAppInfoRpc({});
        return result as {
          appVersion: string;
          bunVersion: string;
          electrobunVersion: string;
          platform: string;
          arch: string;
        };
      },
    });
    log.debug("App info service initialized with RPC");
  }

  // Initialize system health service with RPC
  const clipRequests = electrobun.rpc?.request;
  if (clipRequests?.getClipModelStatus && clipRequests.retryClipModelSetup && clipRequests.importClipModelFile) {
    initClipService({
      getClipModelStatus: () => clipRequests.getClipModelStatus({}),
      retryClipModelSetup: () => clipRequests.retryClipModelSetup({}),
      importClipModelFile: () => clipRequests.importClipModelFile({}),
    });
  }

  const takeoutRequests = electrobun.rpc?.request;
  if (takeoutRequests?.getTakeoutReport && takeoutRequests.compareImmichGoReport) {
    initTakeoutService({
      getTakeoutReport: () => takeoutRequests.getTakeoutReport({}),
      compareImmichGoReport: (report) => takeoutRequests.compareImmichGoReport({ report }),
    });
  }

  const quarantineRequests = electrobun.rpc?.request;
  if (quarantineRequests?.getQuarantineStatus && quarantineRequests.restoreQuarantinedFiles) {
    initQuarantineService({
      getQuarantineStatus: () => quarantineRequests.getQuarantineStatus({}),
      restoreQuarantinedFiles: () => quarantineRequests.restoreQuarantinedFiles({}),
    });
  }

  const getSystemHealthRpc = electrobun.rpc?.request?.getSystemHealth;
  if (getSystemHealthRpc) {
    initSystemHealthService({
      getSystemHealth: async () => {
        const result = await getSystemHealthRpc({});
        return result as {
          ffprobe: {
            available: boolean;
            path: string | null;
          };
          platform: "win32" | "darwin" | "linux" | string;
        };
      },
    });
    log.debug("System health service initialized with RPC");
  }

  // Initialize folders service with RPC
  const listFoldersRpc = electrobun.rpc?.request?.listFolders;
  const getFolderStatsRpc = electrobun.rpc?.request?.getFolderStats;
  const addFolderRpc = electrobun.rpc?.request?.addFolder;
  const updateFolderRpc = electrobun.rpc?.request?.updateFolder;
  const removeFolderRpc = electrobun.rpc?.request?.removeFolder;
  const showFolderPickerRpc = electrobun.rpc?.request?.showFolderPicker;
  const scanFolderQuickRpc = electrobun.rpc?.request?.scanFolderQuick;

  if (
    listFoldersRpc &&
    getFolderStatsRpc &&
    addFolderRpc &&
    updateFolderRpc &&
    removeFolderRpc &&
    showFolderPickerRpc &&
    scanFolderQuickRpc
  ) {
    initFoldersService({
      listFolders: async () => {
        try {
          const result = await listFoldersRpc({});
          return result as unknown as Array<{
            id: number;
            path: string;
            priority: number;
            status: "added" | "scanning" | "ready" | "error";
            scanSubdirectories: boolean;
            includeVideos: boolean;
            imageCount: number;
            videoCount: number;
            totalSize: number;
            createdAt: string;
            updatedAt: string;
          }>;
        } catch (error) {
          log.error("Failed to list folders", error);
          throw error;
        }
      },
      getFolderStats: async () => {
        try {
          const result = await getFolderStatsRpc({});
          return result as {
            folderCount: number;
            totalImages: number;
            totalVideos: number;
            totalSize: number;
          };
        } catch (error) {
          log.error("Failed to get folder stats", error);
          throw error;
        }
      },
      addFolder: async (params: {
        path: string;
        priority?: number;
        scanSubdirectories?: boolean;
        includeVideos?: boolean;
      }) => {
        try {
          const result = await addFolderRpc(params);
          return result as unknown as {
            success: boolean;
            folder: {
              id: number;
              path: string;
              priority: number;
              status: "added" | "scanning" | "ready" | "error";
              scanSubdirectories: boolean;
              includeVideos: boolean;
              imageCount: number;
              videoCount: number;
              totalSize: number;
              createdAt: string;
              updatedAt: string;
            };
          };
        } catch (error) {
          log.error("Failed to add folder", error);
          throw error;
        }
      },
      updateFolder: async (params: {
        id: number;
        priority?: number;
        status?: "added" | "scanning" | "ready" | "error";
        scanSubdirectories?: boolean;
        includeVideos?: boolean;
      }) => {
        try {
          const result = await updateFolderRpc(params);
          return result as unknown as {
            success: boolean;
            folder: {
              id: number;
              path: string;
              priority: number;
              status: "added" | "scanning" | "ready" | "error";
              scanSubdirectories: boolean;
              includeVideos: boolean;
              imageCount: number;
              videoCount: number;
              totalSize: number;
              createdAt: string;
              updatedAt: string;
            };
          };
        } catch (error) {
          log.error("Failed to update folder", error);
          throw error;
        }
      },
      removeFolder: async (params: { id: number }) => {
        try {
          const result = await removeFolderRpc(params);
          return result as { success: boolean };
        } catch (error) {
          log.error("Failed to remove folder", error);
          throw error;
        }
      },
      showFolderPicker: async () => {
        try {
          const result = await showFolderPickerRpc({});
          return result as { success: boolean; path: string | null };
        } catch (error) {
          log.error("Failed to show folder picker", error);
          throw error;
        }
      },
      scanFolderQuick: async (params: { id: number }) => {
        try {
          const result = await scanFolderQuickRpc(params);
          return result as unknown as {
            success: boolean;
            folder: {
              id: number;
              path: string;
              priority: number;
              status: "added" | "scanning" | "ready" | "error";
              scanSubdirectories: boolean;
              includeVideos: boolean;
              imageCount: number;
              videoCount: number;
              totalSize: number;
              createdAt: string;
              updatedAt: string;
            };
          };
        } catch (error) {
          log.error("Failed to quick scan folder", error);
          throw error;
        }
      },
    });
    log.debug("Folders service initialized with RPC");
  } else {
    log.warn("Folders RPC methods not available - folder management functionality will be limited");
  }

  // Initialize database service with RPC
  const getDatabaseInfoRpc = electrobun.rpc?.request?.getDatabaseInfo;
  const openDatabaseFolderRpc = electrobun.rpc?.request?.openDatabaseFolder;
  const resetApplicationRpc = electrobun.rpc?.request?.resetApplication;

  if (getDatabaseInfoRpc && openDatabaseFolderRpc && resetApplicationRpc) {
    initDatabaseService({
      getDatabaseInfo: async () => {
        try {
          const result = await getDatabaseInfoRpc({});
          return result as {
            path: string;
            size: number;
            sizeFormatted: string;
          };
        } catch (error) {
          log.error("Failed to get database info", error);
          throw error;
        }
      },
      openDatabaseFolder: async () => {
        try {
          const result = await openDatabaseFolderRpc({});
          return result as { success: boolean };
        } catch (error) {
          log.error("Failed to open database folder", error);
          throw error;
        }
      },
      resetApplication: async () => {
        try {
          const result = await resetApplicationRpc({});
          return result as { success: boolean };
        } catch (error) {
          log.error("Failed to reset application", error);
          throw error;
        }
      },
    });
    log.debug("Database service initialized with RPC");
  } else {
    log.warn("Database RPC methods not available - database functionality will be limited");
  }

  // Initialize logs service with RPC
  const getLogsPathRpc = electrobun.rpc?.request?.getLogsPath;
  const selectLogsFolderRpc = electrobun.rpc?.request?.selectLogsFolder;

  if (getLogsPathRpc && selectLogsFolderRpc) {
    initLogsService({
      getLogsPath: async () => {
        try {
          const result = await getLogsPathRpc({});
          return result as { path: string };
        } catch (error) {
          log.error("Failed to get logs path", error);
          throw error;
        }
      },
      selectLogsFolder: async () => {
        try {
          const result = await selectLogsFolderRpc({});
          return result as { success: boolean; path: string | null };
        } catch (error) {
          log.error("Failed to select logs folder", error);
          throw error;
        }
      },
    });
    log.debug("Logs service initialized with RPC");
  } else {
    log.warn("Logs RPC methods not available - logs functionality will be limited");
  }

  // Initialize processing service with RPC
  const startProcessingRpc = electrobun.rpc?.request?.startProcessing;
  const getProcessingStatusRpc = electrobun.rpc?.request?.getProcessingStatus;
  const pauseProcessingRpc = electrobun.rpc?.request?.pauseProcessing;
  const resumeProcessingRpc = electrobun.rpc?.request?.resumeProcessing;
  const cancelProcessingRpc = electrobun.rpc?.request?.cancelProcessing;
  const getProcessingStateRpc = electrobun.rpc?.request?.getProcessingState;
  const getReviewSummaryRpc = electrobun.rpc?.request?.getReviewSummary;

  if (
    startProcessingRpc &&
    getProcessingStatusRpc &&
    pauseProcessingRpc &&
    resumeProcessingRpc &&
    cancelProcessingRpc &&
    getProcessingStateRpc &&
    getReviewSummaryRpc
  ) {
    initProcessingService({
      startProcessing: async (params?: { pauseAfterSegment?: boolean }) => {
        try {
          const result = await startProcessingRpc(params ?? {});
          return result as { started: boolean; error?: string };
        } catch (error) {
          log.error("Failed to start processing", error);
          throw error;
        }
      },
      getProcessingStatus: async () => {
        try {
          const result = await getProcessingStatusRpc({});
          return result as {
            isRunning: boolean;
            isPaused: boolean;
            progress: {
              stage: "idle" | "scanning" | "metadata" | "hashing" | "detecting" | "complete" | "error";
              stageProgress: number;
              currentOperation: string;
              filesProcessed: number;
              totalFiles: number;
              duplicatesFound: number;
              errors: number;
              stageStats?: Record<string, { processed: number; errors: number; skipped: number }>;
            } | null;
          };
        } catch (error) {
          log.error("Failed to get processing status", error);
          throw error;
        }
      },
      pauseProcessing: async () => {
        try {
          const result = await pauseProcessingRpc({});
          return result as { paused: boolean };
        } catch (error) {
          log.error("Failed to pause processing", error);
          throw error;
        }
      },
      resumeProcessing: async () => {
        try {
          const result = await resumeProcessingRpc({});
          return result as { resumed: boolean };
        } catch (error) {
          log.error("Failed to resume processing", error);
          throw error;
        }
      },
      cancelProcessing: async () => {
        try {
          const result = await cancelProcessingRpc({});
          return result as { cancelled: boolean };
        } catch (error) {
          log.error("Failed to cancel processing", error);
          throw error;
        }
      },
      getProcessingState: async () => {
        try {
          const result = await getProcessingStateRpc({});
          return result as {
            hasFolders: boolean;
            hasUnscannedFolders: boolean;
            hasFilesNeedingMetadata: boolean;
            hasUnhashedFiles: boolean;
            hasUndetectedDuplicates: boolean;
            totalFiles: number;
            statusCounts: {
              pending: number;
              metadata: number;
              hashed: number;
              processed: number;
              error: number;
            };
          };
        } catch (error) {
          log.error("Failed to get processing state", error);
          throw error;
        }
      },
      getReviewSummary: async () => {
        try {
          const result = await getReviewSummaryRpc({});
          return result as ReviewSummary;
        } catch (error) {
          log.error("Failed to get review summary", error);
          throw error;
        }
      },
    });
    log.debug("Processing service initialized with RPC");
  } else {
    log.warn("Processing RPC methods not available - processing functionality will be limited");
  }

  // Initialize review/results service with RPC
  const getPendingGroupsRpc = electrobun.rpc?.request?.getPendingGroups;
  const getLogicalGroupFilesRpc = electrobun.rpc?.request?.getLogicalGroupFiles;
  const submitReviewDecisionsRpc = electrobun.rpc?.request?.submitReviewDecisions;
  const getReviewSummaryForResultsRpc = electrobun.rpc?.request?.getReviewSummary;
  const applyDeletionsRpc = electrobun.rpc?.request?.applyDeletions;
  const undoDecisionRpc = electrobun.rpc?.request?.undoDecision;
  const getConflictsRpc = electrobun.rpc?.request?.getConflicts;
  const resolveConflictRpc = electrobun.rpc?.request?.resolveConflict;

  if (
    getPendingGroupsRpc &&
    getLogicalGroupFilesRpc &&
    submitReviewDecisionsRpc &&
    getReviewSummaryForResultsRpc &&
    applyDeletionsRpc &&
    undoDecisionRpc
  ) {
    initResultsService({
      getPendingGroups: async (params) => {
        try {
          const result = await getPendingGroupsRpc(params);
          return result as {
            groups: Array<{
              groupKey: string;
              method: "sha256" | "content_hash" | "phash";
              fileCount: number;
              totalSize: number;
              suggestedKeepFileId: number;
              suggestedKeepReason: string;
              hasDecisions: boolean;
              allDecided: boolean;
              minPhashDistance?: number;
            }>;
            total: number;
            page: number;
            pageSize: number;
          };
        } catch (error) {
          log.error("Failed to get pending groups", error);
          throw error;
        }
      },
      getLogicalGroupFiles: async (params) => {
        try {
          // RPC serialization preserves the shape; cast to satisfy ReviewRPC interface
          // biome-ignore lint/suspicious/noExplicitAny: RPC boundary type cast
          const result = (await getLogicalGroupFilesRpc(params)) as any;
          return result;
        } catch (error) {
          log.error("Failed to get logical group files", error);
          throw error;
        }
      },
      submitReviewDecisions: async (params) => {
        try {
          const result = await submitReviewDecisionsRpc(params);
          return result as { success: boolean; decisionsStored: number };
        } catch (error) {
          log.error("Failed to submit review decisions", error);
          throw error;
        }
      },
      getReviewSummary: async () => {
        try {
          const result = await getReviewSummaryForResultsRpc({});
          return result as ReviewSummary;
        } catch (error) {
          log.error("Failed to get review summary", error);
          throw error;
        }
      },
      applyDeletions: async (params) => {
        try {
          return await applyDeletionsRpc(params ?? {});
        } catch (error) {
          log.error("Failed to apply deletions", error);
          throw error;
        }
      },
      undoDecision: async (params) => {
        try {
          const result = await undoDecisionRpc(params);
          return result as { success: boolean };
        } catch (error) {
          log.error("Failed to undo decision", error);
          throw error;
        }
      },
      getConflicts: async () => {
        if (!getConflictsRpc) return { conflicts: [] };
        try {
          // biome-ignore lint/suspicious/noExplicitAny: RPC boundary type cast
          const result = (await getConflictsRpc({})) as any;
          return result;
        } catch (error) {
          log.error("Failed to get conflicts", error);
          throw error;
        }
      },
      resolveConflict: async (params) => {
        if (!resolveConflictRpc) return { success: false };
        try {
          const result = await resolveConflictRpc(params);
          return result as { success: boolean };
        } catch (error) {
          log.error("Failed to resolve conflict", error);
          throw error;
        }
      },
    });
    log.debug("Review service initialized with RPC");
  } else {
    log.warn("Review RPC methods not available - review functionality will be limited");
  }

  // Fetch file server port for loading local images
  const getFileServerPortRpc = electrobun.rpc?.request?.getFileServerPort;
  if (getFileServerPortRpc) {
    getFileServerPortRpc({})
      .then((result) => {
        const r = result as { port: number };
        if (r.port > 0) {
          setFileServerPort(r.port);
          log.debug("File server port set", { port: r.port });
        }
      })
      .catch((error) => {
        log.warn("Failed to get file server port", error);
      });
  }

  const container = document.getElementById("app");
  if (container) {
    mountApp(container);
    log.debug("App rendered successfully");
  } else {
    log.error("App container not found");
  }
});

// Listen for window resize/move events and save bounds
let boundsTimeout: ReturnType<typeof setTimeout> | null = null;

async function saveWindowBounds(): Promise<void> {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const x = window.screenX;
  const y = window.screenY;

  log.debug("Saving window bounds", { width, height, x, y });

  // Call RPC to save bounds
  const saveWindowBoundsRpc = electrobun.rpc?.request?.saveWindowBounds;
  if (saveWindowBoundsRpc) {
    try {
      await saveWindowBoundsRpc({ width, height, x, y });
    } catch (error) {
      log.error("Failed to save window bounds", error);
    }
  }
}

// Debounced handler for resize/move events
function debouncedSaveBounds(): void {
  if (boundsTimeout) {
    clearTimeout(boundsTimeout);
  }
  boundsTimeout = setTimeout(() => {
    saveWindowBounds();
  }, 500); // Save 500ms after resize/move stops
}

// Listen for resize events
window.addEventListener("resize", debouncedSaveBounds);

// Listen for move events (fires when window position changes)
// Note: This may not fire on all platforms, but resize usually accompanies moves
window.addEventListener("focus", () => {
  // Save on focus as fallback for detecting moves
  debouncedSaveBounds();
});
