// ⚠️ FRAGILE: See _FRAGILE.md — writes into the user's original files, with no backup (maintainer's choice).
/**
 * Apply capture-date proposals (RFD-006): write the date into each file's metadata in place with
 * ExifTool (lossless: the image data is not re-encoded), then update the database: the new
 * SHA-256 and size (the bytes changed), and the metadata's dateTaken.
 *
 * Photos: EXIF DateTimeOriginal + CreateDate (+ OffsetTime* "+00:00" for exact UTC times from the
 * Google JSON). Videos: QuickTime CreateDate / MediaCreateDate / TrackCreateDate, which the
 * QuickTime spec stores in UTC; a wall time from a name or folder is written as given.
 */
import { stat } from "node:fs/promises";
import { ExifTool, type WriteTags } from "exiftool-vendored";
import type { DatabaseProvider } from "../db/database-provider";
import { getLogger } from "../logging/logger";
import { computeSha256 } from "../scan/hash-sha256";
import { type CaptureDateProposal, findCaptureDateProposals } from "./capture-dates";

const log = getLogger("core:capture-dates");

/** "2019-05-12T14:30:00[.000Z]" → "2019:05:12 14:30:00" */
const exifStamp = (iso: string) => iso.slice(0, 19).replace(/^(\d{4})-(\d{2})-(\d{2})T/, "$1:$2:$3 ");

/** The tags to write for one proposal. Pure. */
export function captureDateTags(p: CaptureDateProposal): Record<string, string> {
  const stamp = exifStamp(p.takenAt);
  if (p.fileType === "video") return { CreateDate: stamp, MediaCreateDate: stamp, TrackCreateDate: stamp };
  const tags: Record<string, string> = { DateTimeOriginal: stamp, CreateDate: stamp };
  if (p.precision === "exact") Object.assign(tags, { OffsetTimeOriginal: "+00:00", OffsetTimeDigitized: "+00:00" });
  return tags;
}

/** dateTaken for the database: the exact instant, or the wall time read in this machine's zone. */
export function takenDate(p: CaptureDateProposal): Date {
  return new Date(p.takenAt);
}

export interface ApplyCaptureDatesResult {
  written: number;
  failed: number;
  errors: { fileId: number; path: string; error: string }[];
}

type Db = Pick<
  DatabaseProvider,
  "getClient" | "getMediaFileProvider" | "getImageMetadataProvider" | "getVideoMetadataProvider"
>;

async function recordWrite(db: Db, p: CaptureDateProposal): Promise<void> {
  const [sha256Hash, info] = await Promise.all([computeSha256(p.path), stat(p.path)]);
  await db.getMediaFileProvider().updateMediaFile({ id: p.fileId, sha256Hash, size: info.size });
  const dateTaken = takenDate(p);
  if (p.fileType === "image") {
    const meta = await db.getImageMetadataProvider().getByMediaFileIds([p.fileId]);
    if (meta[0]) await db.getImageMetadataProvider().updateImageMetadata({ id: meta[0].id, dateTaken });
  } else {
    const meta = await db.getVideoMetadataProvider().getVideoMetadataByMediaFileIds([p.fileId]);
    if (meta[0]) await db.getVideoMetadataProvider().updateVideoMetadata({ id: meta[0].id, dateTaken });
  }
}

/**
 * Write every current proposal (or only `fileIds`). Each file is independent: a failure is
 * reported and the rest continue. Proposals are recomputed here, so a file dated since the review
 * is never overwritten.
 */
export async function applyCaptureDates(
  db: Db,
  options: { fileIds?: number[]; onProgress?: (done: number, total: number, path: string) => void } = {},
): Promise<ApplyCaptureDatesResult> {
  const { proposals } = await findCaptureDateProposals(db);
  const wanted = options.fileIds ? new Set(options.fileIds) : null;
  const todo = wanted ? proposals.filter((p) => wanted.has(p.fileId)) : proposals;
  const result: ApplyCaptureDatesResult = { written: 0, failed: 0, errors: [] };
  if (todo.length === 0) return result;
  log.info("Writing capture dates", { files: todo.length });

  const exiftool = new ExifTool({ maxProcs: 2, taskTimeoutMillis: 30_000 });
  try {
    for (const [i, p] of todo.entries()) {
      try {
        await exiftool.write(p.path, captureDateTags(p) as WriteTags, { writeArgs: ["-overwrite_original"] });
        await recordWrite(db, p);
        result.written++;
      } catch (error) {
        result.failed++;
        const message = error instanceof Error ? error.message : String(error);
        result.errors.push({ fileId: p.fileId, path: p.path, error: message });
        log.warn("Could not write capture date", { path: p.path, error: message });
      }
      options.onProgress?.(i + 1, todo.length, p.path);
    }
  } finally {
    await exiftool.end();
  }
  log.info("Capture dates written", { written: result.written, failed: result.failed });
  return result;
}
