import { extname } from "node:path";
import exifr from "exifr";
import { DatabaseProvider } from "../db/database-provider";
import { getLogger } from "../logging/logger";
import type { StageTimer } from "../util/timing";

const log = getLogger("core:metadata-image");

import type { ExifOrientation, NewImageMetadata } from "../zod/image-metadata";
import type { MediaFile } from "../zod/media-file";

/**
 * Result of a batch metadata extraction operation
 */
export interface MetadataBatchResult {
  /** Number of files processed successfully */
  processed: number;
  /** Number of files that encountered errors */
  errors: number;
  /** Number of files skipped (already have metadata) */
  skipped: number;
  /** Error category -> count */
  errorBreakdown?: Record<string, number>;
}

/**
 * Options for batch metadata processing
 */
export interface MetadataBatchOptions {
  /** Maximum number of files to process (default: no limit) */
  limit?: number;
  /** Number of concurrent files to process (default: 4) */
  concurrency?: number;
  /** Progress callback */
  onProgress?: (completed: number, total: number, currentFile: string) => void;
  /** Optional timer for collecting per-file timing statistics */
  timer?: StageTimer;
}

/**
 * Extract GPS data from EXIF data.
 * exifr parses GPS coordinates as decimal degrees and altitude in meters.
 */
function extractGpsData(exifData: Record<string, unknown> | null | undefined): {
  latitude: number | null;
  longitude: number | null;
  altitude: number | null;
} {
  if (!exifData) {
    return { latitude: null, longitude: null, altitude: null };
  }

  // exifr parses GPS coordinates as decimal numbers directly
  const latitude = typeof exifData.latitude === "number" ? exifData.latitude : null;
  const longitude = typeof exifData.longitude === "number" ? exifData.longitude : null;
  const altitude = typeof exifData.GPSAltitude === "number" ? exifData.GPSAltitude : null;

  return { latitude, longitude, altitude };
}

/**
 * Extract date taken from EXIF data.
 * Returns null if no valid date is found.
 */
function extractDateTaken(exifData: Record<string, unknown> | null | undefined): Date | null {
  if (!exifData) {
    return null;
  }

  // Common EXIF date fields in order of preference
  const dateFields = ["DateTimeOriginal", "CreateDate", "ModifyDate", "DateTime"];

  for (const field of dateFields) {
    const value = exifData[field];
    if (value instanceof Date) {
      return value;
    }
    if (typeof value === "string") {
      const parsed = new Date(value);
      if (!Number.isNaN(parsed.getTime())) {
        return parsed;
      }
    }
  }

  return null;
}

/**
 * Extract a numeric value from EXIF data, returning null if not found.
 */
function extractExifNumber(exifData: Record<string, unknown> | null | undefined, field: string): number | null {
  if (!exifData) {
    return null;
  }

  const value = exifData[field];
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  return null;
}

/**
 * Extract a string value from EXIF data, returning null if not found.
 */
function extractExifString(exifData: Record<string, unknown> | null | undefined, field: string): string | null {
  if (!exifData) {
    return null;
  }

  const value = exifData[field];
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }

  return null;
}

/**
 * Extract metadata from a single image file and store it in the database.
 *
 * Uses exifr for all metadata (dimensions, camera info, GPS, date taken).
 * No Sharp dependency — avoids GLib ref-counting races with Chromium in Electrobun.
 *
 * @param mediaFileId - The ID of the MediaFile record
 * @param filePath - Absolute path to the image file
 */
export async function extractImageMetadata(mediaFileId: number, filePath: string): Promise<void> {
  const db = await DatabaseProvider.getInstance();
  const imageMetadataProvider = db.getImageMetadataProvider();

  try {
    // Use exifr for all metadata — no Sharp dependency needed here.
    // This avoids GLib ref-counting races with Chromium in Electrobun.
    // Do NOT use `pick` — it filters out GPS tags and other data that
    // exifr needs to compute latitude/longitude/altitude.
    let exifData: Record<string, unknown> | null = null;
    try {
      exifData = await exifr.parse(filePath, {
        gps: true,
        exif: true, // EXIF IFD (camera info, dates, dimensions)
        translateValues: false, // Keep raw numeric values (orientation 1-8, ColorSpace 1, etc.)
      });
      if (exifData) {
        log.debug(
          `EXIF data for ${filePath}: orientation=${exifData.Orientation}, lat=${exifData.latitude}, lon=${exifData.longitude}, alt=${exifData.GPSAltitude}`,
        );
      }
    } catch {
      log.debug(`No EXIF data found for ${filePath}`);
    }

    // Extract dimensions from EXIF (multiple possible tag names)
    const width = extractExifNumber(exifData, "ExifImageWidth") ?? extractExifNumber(exifData, "ImageWidth") ?? 0;
    const height = extractExifNumber(exifData, "ExifImageHeight") ?? extractExifNumber(exifData, "ImageHeight") ?? 0;

    // Derive format from file extension
    const ext = extname(filePath).toLowerCase().replace(".", "");
    const format = ext === "jpg" ? "jpeg" : ext || "unknown";

    // Map EXIF ColorSpace value (1 = sRGB, 65535 = uncalibrated)
    const colorSpaceVal = exifData ? exifData.ColorSpace : undefined;
    const colorSpace = colorSpaceVal === 1 ? "sRGB" : typeof colorSpaceVal === "string" ? colorSpaceVal : null;

    const gps = extractGpsData(exifData);

    const newMetadata: NewImageMetadata = {
      mediaFileId,
      width: width > 0 ? width : 1, // Schema requires positive int
      height: height > 0 ? height : 1,
      format,
      colorSpace,
      hasAlpha: false, // Cannot determine without Sharp; default to false
      orientation: extractExifNumber(exifData, "Orientation") as ExifOrientation | null,
      dateTaken: extractDateTaken(exifData),
      cameraMake: extractExifString(exifData, "Make"),
      cameraModel: extractExifString(exifData, "Model"),
      gpsLatitude: gps.latitude,
      gpsLongitude: gps.longitude,
      gpsAltitude: gps.altitude,
    };

    await imageMetadataProvider.insertImageMetadata(newMetadata);
  } catch (error) {
    log.warn(`Failed to extract metadata for ${filePath}:`, error);
    throw error;
  }
}

/**
 * Get image files that don't have ImageMetadata records yet.
 *
 * @param db - Database provider instance
 * @param limit - Maximum number of files to return
 * @returns Array of MediaFile records needing metadata extraction
 */
async function getImagesWithoutMetadata(
  db: Awaited<ReturnType<typeof DatabaseProvider.getInstance>>,
  limit?: number,
): Promise<MediaFile[]> {
  const dbClient = db.getClient().getDb();

  // Query media files where fileType = 'image' and no imageMetadata record exists
  let query = dbClient
    .selectFrom("mediaFiles")
    .leftJoin("imageMetadata", "mediaFiles.id", "imageMetadata.mediaFileId")
    .where("mediaFiles.fileType", "=", "image")
    .where("imageMetadata.id", "is", null)
    .selectAll("mediaFiles")
    .orderBy("mediaFiles.id", "asc");

  if (limit !== undefined) {
    query = query.limit(limit);
  }

  const results = await query.execute();

  // Parse through Zod for type safety (manually construct since we selected from mediaFiles)
  const { MediaFile } = await import("../zod/media-file");
  return results.map((row) => MediaFile.parse(row));
}

/**
 * Process a batch of images to extract their metadata.
 *
 * Queries image files that don't have ImageMetadata records yet,
 * extracts metadata using exifr, and stores the results.
 *
 * @param options - Batch processing options
 * @returns Statistics about the batch operation
 *
 * @example
 * const result = await processImageMetadataBatch({
 *   limit: 100,
 *   concurrency: 4,
 *   onProgress: (done, total, file) => console.log(`${done}/${total}: ${file}`)
 * });
 * // Returns: { processed: 95, errors: 3, skipped: 2 }
 */
/**
 * Categorize an error message into a short bucket name.
 */
function categorizeError(msg: string): string {
  const lower = msg.toLowerCase();
  if (lower.includes("enoent") || lower.includes("no such file")) return "file_not_found";
  if (lower.includes("eacces") || lower.includes("permission denied")) return "permission_denied";
  if (lower.includes("unsupported") || lower.includes("invalid image")) return "unsupported_format";
  if (lower.includes("timeout")) return "timeout";
  return "unknown";
}

export async function processImageMetadataBatch(options?: MetadataBatchOptions): Promise<MetadataBatchResult> {
  // No native dependencies here (exifr is pure JS), but keep concurrency
  // modest to avoid overwhelming the event loop with parallel file I/O.
  const { limit, concurrency: _concurrency = 4, onProgress, timer } = options ?? {};
  const concurrency = _concurrency;

  const result: MetadataBatchResult = {
    processed: 0,
    errors: 0,
    skipped: 0,
  };
  const errorBreakdown: Record<string, number> = {};

  const db = await DatabaseProvider.getInstance();
  const mediaFileProvider = db.getMediaFileProvider();

  // Get images that need metadata extraction
  const imagesToProcess = await getImagesWithoutMetadata(db, limit);

  if (imagesToProcess.length === 0) {
    log.info("No images found that need metadata extraction");
    return result;
  }

  const total = imagesToProcess.length;
  log.info(`Starting metadata extraction for ${total} images (concurrency: ${concurrency})`);

  // Process in batches with controlled concurrency
  let completed = 0;

  // Create a simple semaphore for concurrency control
  const processWithConcurrency = async (files: MediaFile[]): Promise<void> => {
    const queue = [...files];
    const workers: Promise<void>[] = [];

    const processNext = async (): Promise<void> => {
      while (queue.length > 0) {
        const file = queue.shift();
        if (!file) break;

        try {
          const stop = timer?.start("imageMetadata");
          await extractImageMetadata(file.id, file.path);
          stop?.();
          // Update status to 'metadata' after successful extraction
          await mediaFileProvider.updateMediaFile({
            id: file.id,
            status: "metadata",
          });
          result.processed++;
        } catch (error) {
          result.errors++;
          const msg = error instanceof Error ? error.message : String(error);
          const category = categorizeError(msg);
          errorBreakdown[category] = (errorBreakdown[category] ?? 0) + 1;
        }

        completed++;
        if (onProgress) {
          onProgress(completed, total, file.path);
        }
      }
    };

    // Start concurrent workers
    for (let i = 0; i < Math.min(concurrency, files.length); i++) {
      workers.push(processNext());
    }

    await Promise.all(workers);
  };

  await processWithConcurrency(imagesToProcess);

  log.info(
    `Metadata extraction complete: ${result.processed} processed, ${result.errors} errors, ${result.skipped} skipped`,
  );

  if (Object.keys(errorBreakdown).length > 0) {
    result.errorBreakdown = errorBreakdown;
  }

  return result;
}
