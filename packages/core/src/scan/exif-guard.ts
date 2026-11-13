import { stat } from "node:fs/promises";

/**
 * exifr leaves a FileHandle open when it cannot read a file's header (0- and 1-byte files).
 * Bun 1.4+ raises a FileHandle collected during GC as an uncaught error in the calling
 * process, so such files must never reach exifr. Two bytes is the smallest file where exifr
 * fails cleanly ("Unknown file format") instead of leaking.
 */
export const MIN_EXIF_PARSE_BYTES = 2;

/**
 * True when the file is too small to hand to exifr. A file that cannot be stat'ed returns
 * false so the caller's existing error handling (exifr throwing) still applies.
 */
export async function isTooSmallForExif(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).size < MIN_EXIF_PARSE_BYTES;
  } catch {
    return false;
  }
}
