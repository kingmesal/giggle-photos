import type { Dirent, Stats } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { getExtension, getMediaType, isMediaFile } from "../config/media-types";
import { DatabaseProvider } from "../db/database-provider";
import type { MediaFileProvider } from "../db/media-file-provider";
import type { ScanFolderProvider } from "../db/scan-folder-provider";
import { getLogger } from "../logging/logger";

const log = getLogger("core:scan");

import type { FileType, NewMediaFile } from "../zod/media-file";
import type { ScanFolder } from "../zod/scan-folder";

/**
 * Result of a folder scan operation
 */
export interface ScanResult {
  /** Total number of media files found */
  totalFiles: number;
  /** Number of new files added to the database */
  newFiles: number;
  /** Number of files skipped (already in database) */
  skipped: number;
}

/**
 * Progress callback for scan operations
 */
export type ProgressCallback = (current: number, total: number, currentPath: string) => void;

/**
 * Options for the file scanner
 */
interface ScanOptions {
  /** Whether to follow symbolic links (default: false) */
  followSymlinks?: boolean;
  /** Batch size for database inserts (default: 100) */
  batchSize?: number;
}

/**
 * Internal state for tracking scan progress
 */
interface ScanState {
  /** All discovered file paths */
  discoveredFiles: DiscoveredFile[];
  /** Paths that already exist in the database */
  existingPaths: Set<string>;
  /** Number of files processed */
  processedCount: number;
}

/**
 * Information about a discovered file before database insertion
 */
interface DiscoveredFile {
  path: string;
  filename: string;
  extension: string;
  fileType: FileType;
  size: number;
}

/**
 * Scans a folder and records all media files to the database.
 *
 * This function:
 * 1. Gets the ScanFolder from the database by ID
 * 2. Updates the folder status to 'scanning'
 * 3. Recursively finds all image/video files
 * 4. Skips files that already exist in the database (by path)
 * 5. Batch inserts new MediaFile records
 * 6. Updates the folder status to 'ready' on success, or 'error' on failure
 *
 * @param folderId - The ID of the ScanFolder in the database
 * @param onProgress - Optional callback for progress reporting
 * @returns Object containing totalFiles, newFiles, and skipped counts
 *
 * @example
 * const result = await scanFolder(1, (current, total, path) => {
 *   console.log(`Processing ${current}/${total}: ${path}`);
 * });
 * // Returns: { totalFiles: 150, newFiles: 140, skipped: 10 }
 */
export async function scanFolder(folderId: number, onProgress?: ProgressCallback): Promise<ScanResult> {
  const db = await DatabaseProvider.getInstance();
  const scanFolders = db.getScanFolderProvider();
  const mediaFiles = db.getMediaFileProvider();

  // Get the scan folder from the database
  const folder = await scanFolders.getScanFolderById(folderId);
  if (!folder) {
    throw new Error(`ScanFolder with id ${folderId} not found`);
  }

  try {
    // Update status to scanning
    await scanFolders.updateScanFolder({ id: folderId, status: "scanning" });

    // Perform the scan
    const result = await performScan(folder, mediaFiles, scanFolders, onProgress);

    // Update status to ready on success
    await scanFolders.updateScanFolder({ id: folderId, status: "ready" });

    return result;
  } catch (error) {
    // Update status to error on failure
    await scanFolders.updateScanFolder({ id: folderId, status: "error" });

    const err = error as Error;
    log.error(`Error scanning folder ${folder.path}: ${err.message}`);
    throw error;
  }
}

/**
 * Performs the actual scan operation.
 */
async function performScan(
  folder: ScanFolder,
  mediaFiles: MediaFileProvider,
  scanFolders: ScanFolderProvider,
  onProgress?: ProgressCallback,
  options: ScanOptions = {},
): Promise<ScanResult> {
  const { followSymlinks = false, batchSize = 100 } = options;

  // Get existing file paths for this folder to avoid duplicates
  const existingFiles = await mediaFiles.getMediaFilesByFolderId(folder.id);
  const existingPaths = new Set(existingFiles.map((f) => f.path));

  const state: ScanState = {
    discoveredFiles: [],
    existingPaths,
    processedCount: 0,
  };

  // Phase 1: Discover all files
  log.info(`Starting file discovery in: ${folder.path}`);
  await discoverFiles(folder.path, folder.scanSubdirectories, followSymlinks, state, folder.includeVideos);

  // Sort by path for consistent insertion order (and deterministic id assignment)
  state.discoveredFiles.sort((a, b) => a.path.localeCompare(b.path));

  const totalFiles = state.discoveredFiles.length;
  log.info(`Discovered ${totalFiles} media files in ${folder.path}`);

  // Phase 2: Filter out existing files
  const newFilesToInsert = state.discoveredFiles.filter((f) => !state.existingPaths.has(f.path));
  const skipped = totalFiles - newFilesToInsert.length;

  log.info(`New files to insert: ${newFilesToInsert.length}, skipped: ${skipped}`);

  // Phase 3: Batch insert new files
  let newFiles = 0;
  for (let i = 0; i < newFilesToInsert.length; i += batchSize) {
    const batch = newFilesToInsert.slice(i, i + batchSize);
    const records: NewMediaFile[] = batch.map((file) => ({
      scanFolderId: folder.id,
      path: file.path,
      filename: file.filename,
      extension: file.extension,
      fileType: file.fileType,
      size: file.size,
      status: "pending" as const,
      sha256Hash: null,
      contentHash: null,
      perceptualHash: null,
    }));

    try {
      const inserted = await mediaFiles.insertMediaFiles(records);
      newFiles += inserted;

      // Report progress
      if (onProgress && batch.length > 0) {
        const current = Math.min(i + batchSize, newFilesToInsert.length);
        const lastFile = batch[batch.length - 1];
        if (lastFile) {
          onProgress(current, newFilesToInsert.length, lastFile.path);
        }
      }
    } catch (error) {
      const err = error as Error;
      log.error(`Error inserting batch starting at index ${i}: ${err.message}`);
      // Continue with next batch instead of failing completely
    }
  }

  // Update folder counts
  const imageCount = state.discoveredFiles.filter((f) => f.fileType === "image").length;
  const videoCount = state.discoveredFiles.filter((f) => f.fileType === "video").length;
  const totalSize = state.discoveredFiles.reduce((sum, f) => sum + f.size, 0);

  await scanFolders.updateScanFolder({
    id: folder.id,
    imageCount,
    videoCount,
    totalSize,
  });

  return {
    totalFiles,
    newFiles,
    skipped,
  };
}

/**
 * Recursively discovers all media files in a directory.
 */
async function discoverFiles(
  dirPath: string,
  scanSubdirectories: boolean,
  followSymlinks: boolean,
  state: ScanState,
  includeVideos: boolean,
): Promise<void> {
  let entries: Dirent[];

  try {
    entries = await readdir(dirPath, { withFileTypes: true });
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    log.warn(`Permission denied or error accessing directory: ${dirPath} (${err.code ?? err.message})`);
    return;
  }

  const promises: Promise<void>[] = [];

  for (const entry of entries) {
    const fullPath = join(dirPath, entry.name);

    // Handle symlinks
    if (entry.isSymbolicLink()) {
      if (!followSymlinks) {
        continue;
      }

      promises.push(processSymlink(fullPath, scanSubdirectories, followSymlinks, state, includeVideos));
      continue;
    }

    if (entry.isDirectory()) {
      if (scanSubdirectories) {
        promises.push(discoverFiles(fullPath, scanSubdirectories, followSymlinks, state, includeVideos));
      }
      continue;
    }

    if (entry.isFile()) {
      promises.push(processFile(fullPath, entry.name, state, includeVideos));
    }
  }

  await Promise.all(promises);
}

/**
 * Processes a symbolic link, following it if configured.
 */
async function processSymlink(
  fullPath: string,
  scanSubdirectories: boolean,
  followSymlinks: boolean,
  state: ScanState,
  includeVideos: boolean,
): Promise<void> {
  try {
    // Use stat (not lstat) to follow the symlink
    const targetStat = await stat(fullPath);

    if (targetStat.isDirectory() && scanSubdirectories) {
      await discoverFiles(fullPath, scanSubdirectories, followSymlinks, state, includeVideos);
    } else if (targetStat.isFile()) {
      const filename = basename(fullPath);
      processFileWithStat(fullPath, filename, targetStat, state, includeVideos);
    }
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    log.warn(`Error following symlink: ${fullPath} (${err.code ?? err.message})`);
  }
}

/**
 * Processes a single file, checking its extension and adding to discovered files.
 */
async function processFile(
  fullPath: string,
  filename: string,
  state: ScanState,
  includeVideos: boolean,
): Promise<void> {
  if (!isMediaFile(filename)) {
    return;
  }

  try {
    const fileStat = await stat(fullPath);
    processFileWithStat(fullPath, filename, fileStat, state, includeVideos);
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    log.warn(`Error accessing file: ${fullPath} (${err.code ?? err.message})`);
  }
}

/**
 * Adds a file to the discovered files list.
 */
function processFileWithStat(
  fullPath: string,
  filename: string,
  fileStat: Stats,
  state: ScanState,
  includeVideos: boolean,
): void {
  const ext = getExtension(filename);
  const fileType = getMediaType(filename);

  if (!fileType) {
    return;
  }

  if (fileType === "video" && !includeVideos) {
    return;
  }

  state.discoveredFiles.push({
    path: fullPath,
    filename,
    extension: ext,
    fileType,
    size: Number(fileStat.size),
  });
}
