import type { ApplyDecisionResult } from "@giggle-photos/core/actions/applyDecisions";
import type { getClipModelStatus } from "@giggle-photos/core/clip/model-service";
import type { SystemHealth } from "@giggle-photos/core/config/system-health";
import type { AppSettings } from "@giggle-photos/core/config/user-config";
import type { FolderDevice } from "@giggle-photos/core/db/folder-owner-device-provider";
import type {
  AutoSelection,
  FileWithReviewContext,
  LogicalGroupSummary,
  ReviewSummary,
} from "@giggle-photos/core/review/review-queries";
import type { PipelineProgress, PipelineState } from "@giggle-photos/core/scan/processing-pipeline";
import type { ImportCheckResult } from "@giggle-photos/core/takeout/import-check";
import type { TakeoutReport } from "@giggle-photos/core/takeout/takeout-report";
import type { FileDecisionMethod } from "@giggle-photos/core/zod/file-decision";
import type { DeviceKey } from "@giggle-photos/core/zod/folder-owner-device";
import type { ScanFolder as ScanFolderType, UpdateScanFolder } from "@giggle-photos/core/zod/scan-folder";
import type { RPCSchema } from "electrobun/main";
import type { AppInfo } from "./app-info";
import type { QuarantineStatusResponse } from "./handlers/quarantine";

type ClipModelStatus = ReturnType<typeof getClipModelStatus>;

export type GigglePhotosRPC = {
  bun: RPCSchema<{
    requests: {
      log: {
        params: {
          level: "trace" | "debug" | "info" | "warn" | "error";
          message: string;
          data?: unknown;
        };
        response: {
          success: boolean;
        };
      };
      getSettings: {
        params: Record<string, never>;
        response: AppSettings;
      };
      saveSettings: {
        params: Partial<AppSettings>;
        response: {
          success: boolean;
          settings: AppSettings;
        };
      };
      checkTrashAvailable: {
        params: Record<string, never>;
        response: {
          available: boolean;
          command: string | null;
          installHint: string;
        };
      };
      saveWindowBounds: {
        params: {
          width: number;
          height: number;
          x: number;
          y: number;
        };
        response: {
          success: boolean;
        };
      };
      getAppInfo: {
        params: Record<string, never>;
        response: AppInfo;
      };
      getSystemHealth: {
        params: Record<string, never>;
        response: SystemHealth;
      };
      getTakeoutReport: {
        params: Record<string, never>;
        response: TakeoutReport;
      };
      compareImmichGoReport: {
        params: { report: string };
        response: ImportCheckResult;
      };
      listFolderDevices: {
        params: { scanFolderId: number };
        response: FolderDevice[];
      };
      setFolderOwnerDevices: {
        params: { scanFolderId: number; devices: DeviceKey[] };
        response: { success: boolean };
      };
      getQuarantineStatus: {
        params: Record<string, never>;
        response: QuarantineStatusResponse;
      };
      restoreQuarantinedFiles: {
        params: Record<string, never>;
        response: { restored: number; problems: string[] };
      };
      getClipModelStatus: {
        params: Record<string, never>;
        response: ClipModelStatus;
      };
      retryClipModelSetup: {
        params: Record<string, never>;
        response: ClipModelStatus;
      };
      importClipModelFile: {
        params: Record<string, never>;
        response: { status: ClipModelStatus; error: string | null };
      };
      listFolders: {
        params: Record<string, never>;
        response: ScanFolderType[];
      };
      getFolderStats: {
        params: Record<string, never>;
        response: {
          folderCount: number;
          totalImages: number;
          totalVideos: number;
          totalSize: number;
        };
      };
      addFolder: {
        params: {
          path: string;
          priority?: number;
          scanSubdirectories?: boolean;
          includeVideos?: boolean;
        };
        response: {
          success: boolean;
          folder: ScanFolderType;
          processingPaused?: boolean;
        };
      };
      scanFolderQuick: {
        params: {
          id: number;
        };
        response: {
          success: boolean;
          folder: ScanFolderType;
        };
      };
      updateFolder: {
        params: UpdateScanFolder;
        response: {
          success: boolean;
          folder: ScanFolderType;
        };
      };
      removeFolder: {
        params: {
          id: number;
        };
        response: {
          success: boolean;
        };
      };
      showFolderPicker: {
        params: Record<string, never>;
        response: {
          success: boolean;
          path: string | null;
        };
      };
      getDatabaseInfo: {
        params: Record<string, never>;
        response: {
          path: string;
          size: number;
          sizeFormatted: string;
        };
      };
      openDatabaseFolder: {
        params: Record<string, never>;
        response: {
          success: boolean;
        };
      };
      resetApplication: {
        params: Record<string, never>;
        response: {
          success: boolean;
        };
      };
      getLogsPath: {
        params: Record<string, never>;
        response: {
          path: string;
        };
      };
      selectLogsFolder: {
        params: Record<string, never>;
        response: {
          success: boolean;
          path: string | null;
        };
      };
      // Processing handlers
      startProcessing: {
        params: {
          pauseAfterSegment?: boolean;
        };
        response: {
          started: boolean;
          error?: string;
        };
      };
      getProcessingStatus: {
        params: Record<string, never>;
        response: {
          isRunning: boolean;
          isPaused: boolean;
          progress: PipelineProgress | null;
        };
      };
      pauseProcessing: {
        params: Record<string, never>;
        response: {
          paused: boolean;
        };
      };
      resumeProcessing: {
        params: Record<string, never>;
        response: {
          resumed: boolean;
        };
      };
      cancelProcessing: {
        params: Record<string, never>;
        response: {
          cancelled: boolean;
        };
      };
      getProcessingState: {
        params: Record<string, never>;
        response: PipelineState;
      };
      // Review endpoints (query-based logical groups)
      getPendingGroups: {
        params: {
          method: FileDecisionMethod;
          page?: number;
          pageSize?: number;
          phashThreshold?: number;
          phashCategory?: "identical" | "similar";
        };
        response: {
          groups: LogicalGroupSummary[];
          total: number;
          page: number;
          pageSize: number;
        };
      };
      getLogicalGroupFiles: {
        params: {
          method: FileDecisionMethod;
          groupKey: string;
          phashThreshold?: number;
        };
        response: {
          files: FileWithReviewContext[];
          suggestion: AutoSelection;
        };
      };
      submitReviewDecisions: {
        params: {
          decisions: Array<{ mediaFileId: number; action: "keep" | "delete" }>;
          method: FileDecisionMethod;
          reviewGroupKey: string;
        };
        response: {
          success: boolean;
          decisionsStored: number;
        };
      };
      getReviewSummary: {
        params: Record<string, never>;
        response: ReviewSummary;
      };
      getConflicts: {
        params: Record<string, never>;
        response: {
          conflicts: Array<{
            mediaFileId: number;
            fileName: string;
            filePath: string;
            decisions: Array<{ reviewGroupKey: string; action: "keep" | "delete" }>;
          }>;
        };
      };
      resolveConflict: {
        params: {
          mediaFileId: number;
          action: "keep" | "delete";
        };
        response: {
          success: boolean;
        };
      };
      applyDeletions: {
        params: {
          dryRun?: boolean;
          moveToTrash?: boolean;
        };
        response: ApplyDecisionResult;
      };
      undoDecision: {
        params: {
          mediaFileId: number;
          reviewGroupKey: string;
        };
        response: {
          success: boolean;
        };
      };
      getFileServerPort: {
        params: Record<string, never>;
        response: {
          port: number;
        };
      };
    };
    messages: Record<string, never>;
  }>;
  webview: RPCSchema<{
    requests: Record<string, never>;
    messages: Record<string, never>;
  }>;
};
