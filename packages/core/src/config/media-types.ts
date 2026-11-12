/**
 * Centralized media type configuration.
 *
 * This module defines all supported image and video file extensions
 * and provides utilities for checking file types.
 *
 * All extension checks are case-insensitive.
 */

/**
 * Supported image file extensions (lowercase, without leading dot)
 *
 * Includes common formats:
 * - Standard: jpg, jpeg, png, gif, webp, bmp, tiff
 * - Modern: heic, heif, avif
 * - RAW: raw, cr2, nef, arw, dng, orf, rw2
 */
export const IMAGE_EXTENSIONS = new Set([
  // Standard formats
  "jpg",
  "jpeg",
  "png",
  "gif",
  "webp",
  // Modern formats
  "heic",
  "heif",
  "avif",
  // RAW camera formats
  "raw",
  "cr2", // Canon
  "nef", // Nikon
  "arw", // Sony
  "dng", // Adobe Digital Negative
  "orf", // Olympus
  "rw2", // Panasonic
]);

/**
 * Supported video file extensions (lowercase, without leading dot)
 *
 * Includes common formats:
 * - Standard: mp4, mov, avi, mkv, webm
 * - Legacy: wmv, flv, 3gp
 * - Professional: mts, m2ts, ts
 */
export const VIDEO_EXTENSIONS = new Set([
  // Common formats
  "mp4",
  "mov",
  "avi",
  "mkv",
  "webm",
  "m4v",
  // Professional/broadcast formats
  "mts",
  "m2ts",
  "ts",
]);

/**
 * All supported media file extensions (images + videos)
 */
export const ALL_MEDIA_EXTENSIONS = new Set([...IMAGE_EXTENSIONS, ...VIDEO_EXTENSIONS]);

/**
 * Extract file extension from a filename or path (case-insensitive)
 *
 * @param filename - The filename or path to extract extension from
 * @returns Lowercase extension without leading dot, or empty string if none
 *
 * @example
 * getExtension("photo.JPG") // returns "jpg"
 * getExtension("/path/to/video.MP4") // returns "mp4"
 * getExtension("noextension") // returns ""
 */
export function getExtension(filename: string): string {
  const lastDot = filename.lastIndexOf(".");
  if (lastDot === -1 || lastDot === filename.length - 1) {
    return "";
  }
  return filename.slice(lastDot + 1).toLowerCase();
}

/**
 * Check if a file is a supported image based on its extension
 *
 * @param filename - The filename or path to check
 * @returns true if the file has a supported image extension
 *
 * @example
 * isImageFile("photo.JPG") // returns true
 * isImageFile("video.mp4") // returns false
 */
export function isImageFile(filename: string): boolean {
  return IMAGE_EXTENSIONS.has(getExtension(filename));
}

/**
 * Check if a file is a supported video based on its extension
 *
 * @param filename - The filename or path to check
 * @returns true if the file has a supported video extension
 *
 * @example
 * isVideoFile("video.MP4") // returns true
 * isVideoFile("photo.jpg") // returns false
 */
export function isVideoFile(filename: string): boolean {
  return VIDEO_EXTENSIONS.has(getExtension(filename));
}

/**
 * Check if a file is a supported media file (image or video)
 *
 * @param filename - The filename or path to check
 * @returns true if the file has a supported media extension
 *
 * @example
 * isMediaFile("photo.JPG") // returns true
 * isMediaFile("video.mp4") // returns true
 * isMediaFile("document.pdf") // returns false
 */
export function isMediaFile(filename: string): boolean {
  return ALL_MEDIA_EXTENSIONS.has(getExtension(filename));
}

/**
 * Get the media type for a file based on its extension
 *
 * @param filename - The filename or path to check
 * @returns "image", "video", or null if not a supported media type
 *
 * @example
 * getMediaType("photo.JPG") // returns "image"
 * getMediaType("video.mp4") // returns "video"
 * getMediaType("document.pdf") // returns null
 */
export function getMediaType(filename: string): "image" | "video" | null {
  const ext = getExtension(filename);
  if (IMAGE_EXTENSIONS.has(ext)) {
    return "image";
  }
  if (VIDEO_EXTENSIONS.has(ext)) {
    return "video";
  }
  return null;
}
