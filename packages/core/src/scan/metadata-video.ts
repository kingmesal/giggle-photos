import { $ } from "bun";
import { DatabaseProvider } from "../db/database-provider";
import { getLogger } from "../logging/logger";
import type { StageTimer } from "../util/timing";

const log = getLogger("core:metadata-video");

import type { NewVideoMetadata } from "../zod/video-metadata";

/**
 * Raw ffprobe JSON output structure
 */
interface FFProbeOutput {
  streams?: FFProbeStream[];
  format?: FFProbeFormat;
}

interface FFProbeStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  r_frame_rate?: string;
  avg_frame_rate?: string;
}

interface FFProbeFormat {
  duration?: string;
  bit_rate?: string;
  tags?: Record<string, string>;
}

/**
 * Check if ffprobe is available on the system.
 * Returns the path to ffprobe if found, null otherwise.
 */
let ffprobeChecked = false;
let ffprobeAvailable: string | null = null;

async function checkFfprobeAvailable(): Promise<string | null> {
  if (ffprobeChecked) {
    return ffprobeAvailable;
  }

  ffprobeChecked = true;

  try {
    const result = await $`which ffprobe`.text();
    ffprobeAvailable = result.trim() || null;
    if (ffprobeAvailable) {
      log.debug(`ffprobe found at: ${ffprobeAvailable}`);
    }
  } catch {
    ffprobeAvailable = null;
    log.warn("ffprobe not found on system - video metadata extraction will be skipped");
  }

  return ffprobeAvailable;
}

/**
 * Get raw video metadata from a file using ffprobe.
 *
 * @param filePath - Absolute path to the video file
 * @returns FFProbe output or null if extraction fails
 */
export async function getVideoMetadata(filePath: string): Promise<FFProbeOutput | null> {
  const ffprobe = await checkFfprobeAvailable();
  if (!ffprobe) {
    return null;
  }

  try {
    // Use quiet mode, output JSON, show format and streams
    const result = await $`ffprobe -v quiet -print_format json -show_format -show_streams ${filePath}`.json();
    return result as FFProbeOutput;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.debug(`Failed to extract video metadata from ${filePath}: ${errorMessage}`);
    return null;
  }
}

/**
 * Parse frame rate string (e.g., "30/1", "24000/1001") to a number.
 *
 * @param frameRateStr - Frame rate as a fraction string
 * @returns Frame rate as a number, or null if invalid
 */
function parseFrameRate(frameRateStr?: string): number | null {
  if (!frameRateStr) {
    return null;
  }

  const parts = frameRateStr.split("/");
  const [numeratorStr, denominatorStr] = parts;
  if (parts.length === 2 && numeratorStr && denominatorStr) {
    const numerator = Number.parseFloat(numeratorStr);
    const denominator = Number.parseFloat(denominatorStr);
    if (denominator > 0 && !Number.isNaN(numerator) && !Number.isNaN(denominator)) {
      const rate = numerator / denominator;
      // Round to 3 decimal places for clean display
      return Math.round(rate * 1000) / 1000;
    }
  }

  // Try parsing as a simple number
  const rate = Number.parseFloat(frameRateStr);
  if (!Number.isNaN(rate) && rate > 0) {
    return rate;
  }

  return null;
}

/**
 * Parse creation time from ffprobe format tags.
 * Looks for common creation time tags.
 *
 * @param tags - Format tags from ffprobe
 * @returns Date object or null if not found/invalid
 */
function parseCreationTime(tags?: Record<string, string>): Date | null {
  if (!tags) {
    return null;
  }

  // Common creation time tag names
  const timeKeys = ["creation_time", "date", "DATE", "com.apple.quicktime.creationdate"];

  for (const key of timeKeys) {
    const value = tags[key];
    if (value) {
      const date = new Date(value);
      if (!Number.isNaN(date.getTime())) {
        return date;
      }
    }
  }

  return null;
}

/**
 * Extract and store video metadata for a media file.
 *
 * @param mediaFileId - ID of the media file in the database
 * @param filePath - Absolute path to the video file
 * @returns true if metadata was extracted and stored, false otherwise
 */
export async function extractVideoMetadata(mediaFileId: number, filePath: string): Promise<boolean> {
  const db = await DatabaseProvider.getInstance();
  const videoMetadataProvider = db.getVideoMetadataProvider();

  // Check if metadata already exists
  const existing = await videoMetadataProvider.hasMetadataForMediaFile(mediaFileId);
  if (existing) {
    log.debug(`Video metadata already exists for mediaFileId ${mediaFileId}`);
    return true;
  }

  const info = await getVideoMetadata(filePath);
  if (!info) {
    return false;
  }

  const videoStream = info.streams?.find((s) => s.codec_type === "video");
  const audioStream = info.streams?.find((s) => s.codec_type === "audio");

  // Require at least a video stream with dimensions
  if (!videoStream || !videoStream.width || !videoStream.height) {
    log.debug(`No valid video stream found in ${filePath}`);
    return false;
  }

  const metadata: NewVideoMetadata = {
    mediaFileId,
    width: videoStream.width,
    height: videoStream.height,
    duration: Number.parseFloat(info.format?.duration ?? "0") || 0,
    frameRate: parseFrameRate(videoStream.r_frame_rate) ?? parseFrameRate(videoStream.avg_frame_rate),
    codec: videoStream.codec_name ?? null,
    audioCodec: audioStream?.codec_name ?? null,
    bitrate: Number.parseInt(info.format?.bit_rate ?? "0", 10) || null,
    dateTaken: parseCreationTime(info.format?.tags),
  };

  await videoMetadataProvider.insertVideoMetadata(metadata);
  return true;
}

/**
 * Options for batch video metadata processing.
 */
export interface VideoMetadataBatchOptions {
  /** Maximum files to process. Defaults to all video files needing metadata. */
  limit?: number;
  /** Number of parallel workers. Defaults to 2 (lower than file I/O due to process spawning). */
  concurrency?: number;
  /** Progress callback invoked after each file is processed. */
  onProgress?: (completed: number, total: number, currentFile: string) => void;
  /** Optional timer for collecting per-file timing statistics */
  timer?: StageTimer;
}

/**
 * Result of batch video metadata processing.
 */
export interface VideoMetadataBatchResult {
  /** Number of files successfully processed. */
  processed: number;
  /** Number of files that encountered errors. */
  errors: number;
  /** Number of files skipped (already have metadata or ffprobe unavailable). */
  skipped: number;
  /** Error category -> count */
  errorBreakdown?: Record<string, number>;
}

/**
 * Process a batch of video files that need metadata extraction.
 *
 * Queries video files from the database, extracts metadata using ffprobe,
 * and stores the results. If ffprobe is not available, the function returns
 * immediately with all files marked as skipped.
 *
 * @param options - Optional batch processing configuration
 * @returns Count of processed files, errors, and skipped files
 */
/**
 * Categorize an error message into a short bucket name.
 */
function categorizeError(msg: string): string {
  const lower = msg.toLowerCase();
  if (lower.includes("enoent") || lower.includes("no such file")) return "file_not_found";
  if (lower.includes("eacces") || lower.includes("permission denied")) return "permission_denied";
  if (lower.includes("unsupported") || lower.includes("invalid")) return "unsupported_format";
  if (lower.includes("timeout")) return "timeout";
  return "unknown";
}

export async function processVideoMetadataBatch(
  options?: VideoMetadataBatchOptions,
): Promise<VideoMetadataBatchResult> {
  const { limit, concurrency = 2, onProgress, timer } = options ?? {};

  // Check if ffprobe is available before proceeding
  const ffprobe = await checkFfprobeAvailable();
  if (!ffprobe) {
    log.warn("Skipping video metadata extraction - ffprobe not available");
    return { processed: 0, errors: 0, skipped: 0 };
  }

  const db = await DatabaseProvider.getInstance();
  const mediaFiles = db.getMediaFileProvider();
  const videoMetadataProvider = db.getVideoMetadataProvider();

  // Get video files that don't have metadata yet
  // Query "pending" status since metadata extraction runs before hashing in the pipeline
  const allVideoFiles = await mediaFiles.getMediaFilesByTypeAndStatus("video", "pending", limit);

  // Filter out files that already have metadata
  const filesNeedingMetadata: { id: number; path: string }[] = [];
  for (const file of allVideoFiles) {
    const hasMetadata = await videoMetadataProvider.hasMetadataForMediaFile(file.id);
    if (!hasMetadata) {
      filesNeedingMetadata.push({ id: file.id, path: file.path });
    }
    // Apply limit after filtering
    if (limit && filesNeedingMetadata.length >= limit) {
      break;
    }
  }

  const total = filesNeedingMetadata.length;

  if (total === 0) {
    log.info("No video files need metadata extraction");
    return { processed: 0, errors: 0, skipped: 0 };
  }

  log.info(`Processing video metadata for ${total} files with concurrency ${concurrency}`);

  let processed = 0;
  let errors = 0;
  let skipped = 0;
  let completed = 0;
  const errorBreakdown: Record<string, number> = {};

  /**
   * Process a single file: extract metadata and store in database.
   */
  async function processFile(fileId: number, filePath: string): Promise<void> {
    try {
      const stop = timer?.start("videoMetadata");
      const success = await extractVideoMetadata(fileId, filePath);
      stop?.();

      if (success) {
        // Update status to 'metadata' after successful extraction
        await mediaFiles.updateMediaFile({
          id: fileId,
          status: "metadata",
        });
        processed++;
        log.debug(`Extracted video metadata for ${filePath}`);
      } else {
        skipped++;
        log.debug(`Skipped video metadata extraction for ${filePath}`);
      }
    } catch (error) {
      errors++;
      const errorMessage = error instanceof Error ? error.message : String(error);
      const category = categorizeError(errorMessage);
      errorBreakdown[category] = (errorBreakdown[category] ?? 0) + 1;
      log.error(`Failed to extract video metadata for ${filePath}: ${errorMessage}`);
    } finally {
      completed++;
      if (onProgress) {
        onProgress(completed, total, filePath);
      }
    }
  }

  // Process files with controlled concurrency
  const fileQueue = [...filesNeedingMetadata];
  const workers: Promise<void>[] = [];

  async function worker(): Promise<void> {
    while (fileQueue.length > 0) {
      const file = fileQueue.shift();
      if (file) {
        await processFile(file.id, file.path);
      }
    }
  }

  // Start concurrent workers
  for (let i = 0; i < Math.min(concurrency, total); i++) {
    workers.push(worker());
  }

  // Wait for all workers to complete
  await Promise.all(workers);

  log.info(`Video metadata batch complete: ${processed} processed, ${errors} errors, ${skipped} skipped`);
  const result: VideoMetadataBatchResult = { processed, errors, skipped };
  if (Object.keys(errorBreakdown).length > 0) {
    result.errorBreakdown = errorBreakdown;
  }
  return result;
}
