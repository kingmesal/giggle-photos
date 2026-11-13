import { extname } from "node:path";
import exifr from "exifr";
import { DatabaseProvider } from "../db/database-provider";
import { getLogger } from "../logging/logger";
import type { DecodedInfo, ExifFields } from "./analysis-protocol";
import { isTooSmallForExif } from "./exif-guard";

const log = getLogger("core:metadata-image");

import type { ExifOrientation, NewImageMetadata } from "../zod/image-metadata";

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

/** EXIF fields and decoded info already produced by the image-analysis worker (single pass). */
export interface PrefetchedImageInfo {
  exif: ExifFields | null | undefined;
  decoded?: DecodedInfo;
}

/**
 * Build and store the metadata row for one image.
 *
 * The pipeline passes `prefetched` from the worker's single pass (RFD-002), so the file is not
 * read again here and decoded dimensions/format/alpha replace EXIF guesses. Without it, EXIF is
 * parsed from the file with exifr (no Sharp: keeps GLib away from Chromium). An existing row for
 * the file is kept (resumed runs).
 *
 * @param mediaFileId - The ID of the MediaFile record
 * @param filePath - Absolute path to the image file
 * @param prefetched - Worker results; when given, the file is not read
 */
export async function extractImageMetadata(
  mediaFileId: number,
  filePath: string,
  prefetched?: PrefetchedImageInfo,
): Promise<void> {
  const db = await DatabaseProvider.getInstance();
  const imageMetadataProvider = db.getImageMetadataProvider();

  if (prefetched && (await imageMetadataProvider.existsForMediaFile(mediaFileId))) return;

  try {
    // Use exifr for all metadata — no Sharp dependency needed here.
    // This avoids GLib ref-counting races with Chromium in Electrobun.
    // Do NOT use `pick` — it filters out GPS tags and other data that
    // exifr needs to compute latitude/longitude/altitude.
    let exifData: Record<string, unknown> | null = prefetched ? (prefetched.exif ?? null) : null;
    if (!prefetched) {
      try {
        // Tiny files go down the same no-EXIF path as an exifr failure (see exif-guard.ts).
        if (await isTooSmallForExif(filePath)) throw new Error("file too small for EXIF");
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
    }

    // Extract dimensions from EXIF (multiple possible tag names)
    const decoded = prefetched?.decoded;
    const width =
      decoded?.width ?? extractExifNumber(exifData, "ExifImageWidth") ?? extractExifNumber(exifData, "ImageWidth") ?? 0;
    const height =
      decoded?.height ??
      extractExifNumber(exifData, "ExifImageHeight") ??
      extractExifNumber(exifData, "ImageHeight") ??
      0;

    // Derive format from file extension
    const ext = extname(filePath).toLowerCase().replace(".", "");
    const format = decoded?.format ?? (ext === "jpg" ? "jpeg" : ext || "unknown");

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
      hasAlpha: decoded?.hasAlpha ?? false, // only known from a decode
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
