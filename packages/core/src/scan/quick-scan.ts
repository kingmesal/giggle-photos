import type { Dirent, Stats } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { getMediaType, isMediaFile } from "../config/media-types";
import { getLogger } from "../logging/logger";

const log = getLogger("core:quick-scan");

// Re-export for backward compatibility
export { IMAGE_EXTENSIONS, VIDEO_EXTENSIONS } from "../config/media-types";

/**
 * Result of a quick scan operation
 */
export interface QuickScanResult {
  /** Number of image files found */
  imageCount: number;
  /** Number of video files found */
  videoCount: number;
  /** Total size of all media files in bytes */
  totalSize: number;
}

/**
 * Options for the quick scan operation
 */
export interface QuickScanOptions {
  /** Whether to scan subdirectories recursively (default: true) */
  scanSubdirectories?: boolean;
  /** Whether to follow symbolic links (default: false - skip symlinks) */
  followSymlinks?: boolean;
  /** Whether to include video files in the scan (default: true) */
  includeVideos?: boolean;
}

/**
 * Performs a quick scan of a folder to count media files and their total size.
 *
 * This function only stats files (doesn't read content) for performance.
 * It handles permission errors gracefully by logging a warning and continuing.
 *
 * @param folderPath - Absolute path to the folder to scan
 * @param options - Scan options (subdirectories, symlinks)
 * @returns Object containing imageCount, videoCount, and totalSize
 *
 * @example
 * const stats = await quickScan('/path/to/folder', { scanSubdirectories: true });
 * // Returns: { imageCount: 150, videoCount: 20, totalSize: 1234567890 }
 */
export async function quickScan(folderPath: string, options: QuickScanOptions = {}): Promise<QuickScanResult> {
  const { scanSubdirectories = true, followSymlinks = false, includeVideos = true } = options;

  const result: QuickScanResult = {
    imageCount: 0,
    videoCount: 0,
    totalSize: 0,
  };

  await scanDirectory(folderPath, result, scanSubdirectories, followSymlinks, includeVideos);

  return result;
}

/**
 * Recursively scans a directory and updates the result object.
 */
async function scanDirectory(
  dirPath: string,
  result: QuickScanResult,
  scanSubdirectories: boolean,
  followSymlinks: boolean,
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

      // When following symlinks, we need to stat the target
      promises.push(processSymlink(fullPath, result, scanSubdirectories, followSymlinks, includeVideos));
      continue;
    }

    if (entry.isDirectory()) {
      if (scanSubdirectories) {
        promises.push(scanDirectory(fullPath, result, scanSubdirectories, followSymlinks, includeVideos));
      }
      continue;
    }

    if (entry.isFile()) {
      promises.push(processFile(fullPath, entry.name, result, includeVideos));
    }
  }

  await Promise.all(promises);
}

/**
 * Processes a symbolic link, following it if configured.
 */
async function processSymlink(
  fullPath: string,
  result: QuickScanResult,
  scanSubdirectories: boolean,
  followSymlinks: boolean,
  includeVideos: boolean,
): Promise<void> {
  try {
    // Use stat (not lstat) to follow the symlink
    const targetStat = await stat(fullPath);

    if (targetStat.isDirectory() && scanSubdirectories) {
      await scanDirectory(fullPath, result, scanSubdirectories, followSymlinks, includeVideos);
    } else if (targetStat.isFile()) {
      const filename = fullPath.split("/").pop() ?? "";
      processFileWithStat(filename, targetStat, result, includeVideos);
    }
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    log.warn(`Error following symlink: ${fullPath} (${err.code ?? err.message})`);
  }
}

/**
 * Processes a single file, checking its extension and adding to counts.
 */
async function processFile(
  fullPath: string,
  filename: string,
  result: QuickScanResult,
  includeVideos: boolean,
): Promise<void> {
  if (!isMediaFile(filename)) {
    return;
  }

  try {
    const fileStat = await stat(fullPath);
    processFileWithStat(filename, fileStat, result, includeVideos);
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    log.warn(`Error accessing file: ${fullPath} (${err.code ?? err.message})`);
  }
}

/**
 * Updates result counts based on file extension and size.
 */
function processFileWithStat(filename: string, fileStat: Stats, result: QuickScanResult, includeVideos: boolean): void {
  const mediaType = getMediaType(filename);
  const size = Number(fileStat.size);

  if (mediaType === "image") {
    result.imageCount++;
    result.totalSize += size;
  } else if (mediaType === "video" && includeVideos) {
    result.videoCount++;
    result.totalSize += size;
  }
}
