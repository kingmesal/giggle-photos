/**
 * Library tool 1 (RFD-007): an XMP sidecar for every photo and video from its own metadata (date,
 * GPS, camera), with the date guessed from the file name or folder when the file has none.
 * Runs any time; originals are never changed.
 */

import { type DateGuess, guessDate } from "../dates/date-guess";
import type { DatabaseProvider } from "../db/database-provider";
import { emptyRunResult, type ToolRunResult, writeAndCount } from "./sidecar-file";
import { type Sourced, usableGps, utcIso, wallIso, type XmpFields } from "./xmp-fields";

type Db = Pick<DatabaseProvider, "getClient">;

interface LibraryFile {
  id: number;
  path: string;
  fileType: "image" | "video";
  dateTaken: Date | null;
  lat: number | null;
  lon: number | null;
  alt: number | null;
  make: string | null;
  model: string | null;
}

async function libraryFiles(db: Db): Promise<LibraryFile[]> {
  const k = db.getClient().getDb();
  const date = (v: unknown) => (v === null || v === undefined ? null : new Date(Number(v)));
  const [images, videos] = await Promise.all([
    k
      .selectFrom("mediaFiles as m")
      .innerJoin("imageMetadata as i", "i.mediaFileId", "m.id")
      .select([
        "m.id",
        "m.path",
        "i.dateTaken",
        "i.gpsLatitude",
        "i.gpsLongitude",
        "i.gpsAltitude",
        "i.cameraMake",
        "i.cameraModel",
      ])
      .where("m.fileType", "=", "image")
      .orderBy("m.path")
      .execute(),
    k
      .selectFrom("mediaFiles as m")
      .innerJoin("videoMetadata as v", "v.mediaFileId", "m.id")
      .select(["m.id", "m.path", "v.dateTaken"])
      .where("m.fileType", "=", "video")
      .orderBy("m.path")
      .execute(),
  ]);
  return [
    ...images.map((r) => ({
      id: Number(r.id),
      path: r.path,
      fileType: "image" as const,
      dateTaken: date(r.dateTaken),
      lat: r.gpsLatitude ?? null,
      lon: r.gpsLongitude ?? null,
      alt: r.gpsAltitude ?? null,
      make: r.cameraMake ?? null,
      model: r.cameraModel ?? null,
    })),
    ...videos.map((r) => ({
      id: Number(r.id),
      path: r.path,
      fileType: "video" as const,
      dateTaken: date(r.dateTaken),
      lat: null,
      lon: null,
      alt: null,
      make: null,
      model: null,
    })),
  ];
}

/** Fields for one file: its own metadata, plus a guessed date when it has none. Pure. */
export function fieldsFromFile(f: LibraryFile): { fields: XmpFields; guess: DateGuess | null } {
  const fields: XmpFields = {};
  let guess: DateGuess | null = null;
  if (f.dateTaken) {
    // EXIF dates are wall times (read in this machine's zone); video creation_time is UTC.
    fields.dateTaken = {
      value: f.fileType === "image" ? wallIso(f.dateTaken) : utcIso(f.dateTaken),
      source: "embedded",
    };
  } else {
    guess = guessDate(f.path);
    if (guess) fields.dateTaken = { value: guess.takenAt, source: guess.source };
  }
  if (usableGps(f.lat, f.lon)) {
    fields.gps = {
      value: { lat: f.lat as number, lon: f.lon as number, ...(f.alt !== null ? { alt: f.alt } : {}) },
      source: "embedded",
    };
  }
  const own = (v: string | null): Sourced<string> | undefined => (v ? { value: v, source: "embedded" } : undefined);
  if (own(f.make)) fields.cameraMake = own(f.make);
  if (own(f.model)) fields.cameraModel = own(f.model);
  return { fields, guess };
}

export interface GuessedDate extends DateGuess {
  fileId: number;
  path: string;
  fileType: "image" | "video";
}

export interface XmpFromFilesPreview {
  files: number;
  embeddedDate: number;
  filenameDate: number;
  folderDate: number;
  noDate: number;
  withGps: number;
  /** Files whose date is guessed (first `listLimit`; the counts cover all). */
  guessed: GuessedDate[];
  listLimit: number;
}

export async function previewXmpFromFiles(db: Db, listLimit = 500): Promise<XmpFromFilesPreview> {
  const files = await libraryFiles(db);
  const p: XmpFromFilesPreview = {
    files: files.length,
    embeddedDate: 0,
    filenameDate: 0,
    folderDate: 0,
    noDate: 0,
    withGps: 0,
    guessed: [],
    listLimit,
  };
  for (const f of files) {
    const { fields, guess } = fieldsFromFile(f);
    if (f.dateTaken) p.embeddedDate++;
    else if (guess?.source === "filename") p.filenameDate++;
    else if (guess?.source === "folder") p.folderDate++;
    else p.noDate++;
    if (fields.gps) p.withGps++;
    if (guess && p.guessed.length < listLimit)
      p.guessed.push({ ...guess, fileId: f.id, path: f.path, fileType: f.fileType });
  }
  return p;
}

export async function runXmpFromFiles(
  db: Db,
  onProgress?: (done: number, total: number) => void,
): Promise<ToolRunResult> {
  const files = await libraryFiles(db);
  const result = emptyRunResult();
  for (const [i, f] of files.entries()) {
    await writeAndCount(result, f.path, fieldsFromFile(f).fields);
    onProgress?.(i + 1, files.length);
  }
  return result;
}
