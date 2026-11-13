/**
 * Capture-date proposals (RFD-006): photos and videos with no capture date in their metadata get one
 * from the best source available, in this order:
 *   1. the Google Takeout JSON sidecar's photoTakenTime (an exact instant, UTC);
 *   2. a date in the file name (often with a time);
 *   3. a dated folder (day, month or year; year-only → July 1, month-only → the 15th).
 * Computed at query time; nothing is stored until the person applies them (capture-date-writer.ts).
 */
import { basename, dirname } from "node:path";
import type { DatabaseProvider } from "../db/database-provider";
import { type DatePrecision, parseFilenameDate, parseFolderDate, wallTime } from "./date-parse";

const CHUNK = 500;

export type DateSource = "sidecar" | "filename" | "folder";

export interface CaptureDateProposal {
  fileId: number;
  path: string;
  fileType: "image" | "video";
  /**
   * The date to write: an ISO instant ending in "Z" for sidecar times (exact, UTC), otherwise a
   * local wall time "YYYY-MM-DDTHH:mm:ss" with no zone.
   */
  takenAt: string;
  precision: DatePrecision | "exact";
  source: DateSource;
  /** What the date was read from (the folder or file name text, or "Google JSON"). */
  detail: string;
}

/** Choose the best date for one file. Pure. */
export function proposeDate(
  file: { id: number; path: string; fileType: "image" | "video" },
  sidecarTime: Date | null,
): CaptureDateProposal | null {
  const base = { fileId: file.id, path: file.path, fileType: file.fileType };
  if (sidecarTime) {
    return {
      ...base,
      takenAt: sidecarTime.toISOString(),
      precision: "exact",
      source: "sidecar",
      detail: "Google JSON",
    };
  }
  const fromName = parseFilenameDate(basename(file.path));
  if (fromName) {
    return {
      ...base,
      takenAt: wallTime(fromName),
      precision: fromName.precision,
      source: "filename",
      detail: fromName.matched,
    };
  }
  const fromFolder = parseFolderDate(dirname(file.path));
  if (fromFolder) {
    return {
      ...base,
      takenAt: wallTime(fromFolder),
      precision: fromFolder.precision,
      source: "folder",
      detail: fromFolder.matched,
    };
  }
  return null;
}

type Db = Pick<DatabaseProvider, "getClient">;

/** Photos and videos whose metadata has no capture date (files without metadata are skipped). */
async function undatedFiles(db: Db): Promise<{ id: number; path: string; fileType: "image" | "video" }[]> {
  const k = db.getClient().getDb();
  const [images, videos] = await Promise.all([
    k
      .selectFrom("mediaFiles as m")
      .innerJoin("imageMetadata as i", "i.mediaFileId", "m.id")
      .select(["m.id", "m.path"])
      .where("m.fileType", "=", "image")
      .where("i.dateTaken", "is", null)
      .orderBy("m.path")
      .execute(),
    k
      .selectFrom("mediaFiles as m")
      .innerJoin("videoMetadata as v", "v.mediaFileId", "m.id")
      .select(["m.id", "m.path"])
      .where("m.fileType", "=", "video")
      .where("v.dateTaken", "is", null)
      .orderBy("m.path")
      .execute(),
  ]);
  return [
    ...images.map((r) => ({ id: Number(r.id), path: r.path, fileType: "image" as const })),
    ...videos.map((r) => ({ id: Number(r.id), path: r.path, fileType: "video" as const })),
  ];
}

/** photoTakenTime from each file's own JSON sidecar (album references excluded). */
async function sidecarTimes(db: Db, ids: number[]): Promise<Map<number, Date>> {
  const k = db.getClient().getDb();
  const times = new Map<number, Date>();
  for (let i = 0; i < ids.length; i += CHUNK) {
    const rows = await k
      .selectFrom("sidecars")
      .select(["mediaFileId", "photoTakenTime"])
      .where("mediaFileId", "in", ids.slice(i, i + CHUNK))
      .where("photoTakenTime", "is not", null)
      .where("matchMethod", "!=", "album_reference")
      .execute();
    for (const r of rows) {
      if (r.mediaFileId !== null && r.photoTakenTime !== null && !times.has(Number(r.mediaFileId))) {
        times.set(Number(r.mediaFileId), new Date(Number(r.photoTakenTime)));
      }
    }
  }
  return times;
}

export interface CaptureDateReport {
  proposals: CaptureDateProposal[];
  /** Undated files no source could date. */
  undatable: { fileId: number; path: string }[];
}

/** Every proposal, plus the undated files nothing could date. */
export async function findCaptureDateProposals(db: Db): Promise<CaptureDateReport> {
  const files = await undatedFiles(db);
  const times = await sidecarTimes(
    db,
    files.map((f) => f.id),
  );
  const proposals: CaptureDateProposal[] = [];
  const undatable: CaptureDateReport["undatable"] = [];
  for (const file of files) {
    const p = proposeDate(file, times.get(file.id) ?? null);
    if (p) proposals.push(p);
    else undatable.push({ fileId: file.id, path: file.path });
  }
  return { proposals, undatable };
}
