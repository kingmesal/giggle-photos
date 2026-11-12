import { homedir } from "node:os";
import { join } from "node:path";
import { DatabaseProvider } from "@giggle-photos/core/db/database-provider";
import { getLogger } from "@giggle-photos/core/logging/logger";
import { quickScan } from "@giggle-photos/core/scan/quick-scan";
import type {
  NewScanFolder,
  ScanFolder as ScanFolderType,
  UpdateScanFolder,
} from "@giggle-photos/core/zod/scan-folder";
import { Utils } from "electrobun/main";
import { getProcessingStatus, pauseProcessing } from "./processing";

const log = getLogger("rpc:folders");

export async function listFolders(): Promise<ScanFolderType[]> {
  log.debug("listFolders called");
  try {
    const scanFolders = (await DatabaseProvider.getInstance()).getScanFolderProvider();
    return await scanFolders.getAllScanFolders();
  } catch (error) {
    log.error("Failed to list folders", error);
    throw error;
  }
}

export async function getFolderStats(): Promise<{
  folderCount: number;
  totalImages: number;
  totalVideos: number;
  totalSize: number;
}> {
  log.debug("getFolderStats called");
  try {
    const settings = (await DatabaseProvider.getInstance()).getSettingsProvider();
    return await settings.getFolderStats();
  } catch (error) {
    log.error("Failed to get folder stats", error);
    throw error;
  }
}

export async function addFolder(params: {
  path: string;
  priority?: number;
  scanSubdirectories?: boolean;
  includeVideos?: boolean;
}): Promise<{ success: boolean; folder: ScanFolderType; processingPaused?: boolean }> {
  log.debug("addFolder called", params);
  try {
    // Check if processing is running and pause it
    let processingPaused = false;
    const status = await getProcessingStatus();
    if (status.isRunning && !status.isPaused) {
      log.info("Processing is running, pausing due to new folder being added");
      await pauseProcessing();
      processingPaused = true;
    }

    const folderData: NewScanFolder = {
      path: params.path,
      priority: params.priority ?? 3,
      status: "added",
      scanSubdirectories: params.scanSubdirectories ?? true,
      includeVideos: params.includeVideos ?? true,
      imageCount: 0,
      videoCount: 0,
      totalSize: 0,
    };
    const scanFolders = (await DatabaseProvider.getInstance()).getScanFolderProvider();
    const existing = await scanFolders.getScanFolderByPath(params.path);
    if (existing) {
      throw new Error(`Folder already exists: ${params.path}`);
    }
    const folder = await scanFolders.insertScanFolder(folderData);
    log.info("Folder added successfully", { id: folder.id, path: folder.path, processingPaused });
    return { success: true, folder, processingPaused };
  } catch (error) {
    log.error("Failed to add folder", error);
    throw error;
  }
}

export async function updateFolder(params: UpdateScanFolder): Promise<{
  success: boolean;
  folder: ScanFolderType;
}> {
  log.debug("updateFolder called", params);
  try {
    const db = await DatabaseProvider.getInstance();
    const scanFolders = db.getScanFolderProvider();
    await scanFolders.updateScanFolder(params);

    // When includeVideos is toggled off, delete existing video records for this folder
    if (params.includeVideos === false) {
      const mediaFiles = db.getMediaFileProvider();
      const deletedCount = await mediaFiles.deleteVideosByFolderId(params.id);
      if (deletedCount > 0) {
        log.info("Deleted video records after disabling includeVideos", { folderId: params.id, deletedCount });
      }
      // Update folder counts to reflect video removal
      await scanFolders.updateScanFolder({ id: params.id, videoCount: 0 });
    }

    const folder = await scanFolders.getScanFolderById(params.id);
    if (!folder) throw new Error("No result");
    log.info("Folder updated successfully", { id: folder.id });
    return { success: true, folder };
  } catch (error) {
    log.error("Failed to update folder", error);
    throw error;
  }
}

export async function removeFolder(params: { id: number }): Promise<{ success: boolean }> {
  log.debug("removeFolder called", params);
  try {
    const scanFolders = (await DatabaseProvider.getInstance()).getScanFolderProvider();
    await scanFolders.deleteScanFolder(params.id);
    log.info("Folder removed successfully", { id: params.id });
    return { success: true };
  } catch (error) {
    log.error("Failed to remove folder", error);
    throw error;
  }
}

export async function showFolderPicker(): Promise<{
  success: boolean;
  path: string | null;
}> {
  log.debug("showFolderPicker called");
  try {
    const chosenPaths = await Utils.openFileDialog({
      startingFolder: join(homedir(), "Desktop"),
      allowedFileTypes: "*",
      canChooseFiles: false,
      canChooseDirectory: true,
      allowsMultipleSelection: false,
    });

    if (chosenPaths && chosenPaths.length > 0) {
      const path = chosenPaths[0] ?? null;
      log.info("Folder selected", { path });
      return { success: true, path };
    }

    return { success: true, path: null };
  } catch (error) {
    log.error("Failed to show folder picker", error);
    throw error;
  }
}

export async function scanFolderQuick(params: { id: number }): Promise<{
  success: boolean;
  folder: ScanFolderType;
}> {
  log.debug("scanFolderQuick called", params);
  try {
    const scanFolders = (await DatabaseProvider.getInstance()).getScanFolderProvider();
    const folder = await scanFolders.getScanFolderById(params.id);

    if (!folder) {
      throw new Error(`Folder not found: ${params.id}`);
    }

    // Set status to scanning
    await scanFolders.updateScanFolder({ id: params.id, status: "scanning" });

    // Perform the quick scan
    const scanResult = await quickScan(folder.path, {
      scanSubdirectories: folder.scanSubdirectories,
      includeVideos: folder.includeVideos,
    });

    // Update folder with results
    await scanFolders.updateScanFolder({
      id: params.id,
      status: "ready",
      imageCount: scanResult.imageCount,
      videoCount: scanResult.videoCount,
      totalSize: scanResult.totalSize,
    });

    const updatedFolder = await scanFolders.getScanFolderById(params.id);
    if (!updatedFolder) {
      throw new Error("Failed to get updated folder");
    }

    log.info("Folder quick scan completed", {
      id: params.id,
      imageCount: scanResult.imageCount,
      videoCount: scanResult.videoCount,
      totalSize: scanResult.totalSize,
    });

    return { success: true, folder: updatedFolder };
  } catch (error) {
    log.error("Failed to quick scan folder", error);
    // Try to set status back to error
    try {
      const scanFolders = (await DatabaseProvider.getInstance()).getScanFolderProvider();
      await scanFolders.updateScanFolder({ id: params.id, status: "error" });
    } catch {
      // Ignore error while setting error status
    }
    throw error;
  }
}
