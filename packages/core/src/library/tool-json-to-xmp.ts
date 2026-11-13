/**
 * Library tool 2 (RFD-007): convert Google Takeout JSON sidecars to standard XMP next to each photo
 * or video: capture time, GPS (Google's 0,0 means none), description, favourite (5 stars), people.
 * Files that inherit their original's JSON (edited copies, the video of a motion photo) get the
 * same fields. Google JSON is the most trusted source, so it wins over a file's own metadata.
 * The JSON files are left in place (tool 3 removes them).
 */
import type { DatabaseProvider } from "../db/database-provider";
import { emptyRunResult, type ToolRunResult, writeAndCount } from "./sidecar-file";
import { usableGps, utcIso, type XmpFields } from "./xmp-fields";

type Db = Pick<DatabaseProvider, "getClient">;

interface JsonRow {
  mediaFileId: number;
  mediaPath: string;
  photoTakenTime: number | null;
  geoLat: number | null;
  geoLon: number | null;
  geoAlt: number | null;
  description: string | null;
  favorited: number | null;
  people: string;
}

/** XMP fields from one Google JSON. Pure. */
export function fieldsFromJson(row: Omit<JsonRow, "mediaFileId" | "mediaPath">): XmpFields {
  const fields: XmpFields = {};
  if (row.photoTakenTime !== null) fields.dateTaken = { value: utcIso(new Date(row.photoTakenTime)), source: "json" };
  if (usableGps(row.geoLat, row.geoLon)) {
    const alt = row.geoAlt !== null && row.geoAlt !== 0 ? { alt: row.geoAlt } : {};
    fields.gps = { value: { lat: row.geoLat as number, lon: row.geoLon as number, ...alt }, source: "json" };
  }
  const description = row.description?.trim();
  if (description) fields.description = { value: description, source: "json" };
  if (row.favorited) fields.rating = { value: 5, source: "json" };
  const people = (JSON.parse(row.people || "[]") as unknown[]).filter(
    (p): p is string => typeof p === "string" && p !== "",
  );
  if (people.length > 0) fields.people = { value: [...new Set(people)], source: "json" };
  return fields;
}

/** Every media file with Google JSON fields: its own JSON, or inherited through a pair. */
async function jsonTargets(db: Db): Promise<{ path: string; fields: XmpFields; inherited: boolean }[]> {
  const k = db.getClient().getDb();
  const rows = (await k
    .selectFrom("sidecars as s")
    .innerJoin("mediaFiles as m", "m.id", "s.mediaFileId")
    .select([
      "s.mediaFileId",
      "m.path as mediaPath",
      "s.photoTakenTime",
      "s.geoLat",
      "s.geoLon",
      "s.geoAlt",
      "s.description",
      "s.favorited",
      "s.people",
    ])
    .where("s.kind", "=", "media")
    .where("s.matchMethod", "!=", "album_reference")
    .orderBy("m.path")
    .execute()) as unknown as JsonRow[];
  const byFile = new Map<number, { path: string; fields: XmpFields; inherited: boolean }>();
  for (const r of rows) {
    if (!byFile.has(Number(r.mediaFileId))) {
      byFile.set(Number(r.mediaFileId), { path: r.mediaPath, fields: fieldsFromJson(r), inherited: false });
    }
  }
  const pairs = await k
    .selectFrom("mediaPairs as p")
    .innerJoin("mediaFiles as m", "m.id", "p.secondaryFileId")
    .select(["p.primaryFileId", "p.secondaryFileId", "m.path"])
    .execute();
  for (const p of pairs) {
    const primary = byFile.get(Number(p.primaryFileId));
    if (primary && !byFile.has(Number(p.secondaryFileId))) {
      byFile.set(Number(p.secondaryFileId), { path: p.path, fields: primary.fields, inherited: true });
    }
  }
  return [...byFile.values()];
}

export interface JsonToXmpPreview {
  /** Photos and videos that will get Google's metadata (own JSON or inherited). */
  files: number;
  inherited: number;
  withDate: number;
  withGps: number;
  withDescription: number;
  withPeople: number;
  favorites: number;
}

export async function previewJsonToXmp(db: Db): Promise<JsonToXmpPreview> {
  const targets = await jsonTargets(db);
  const count = (pick: (f: XmpFields) => unknown) => targets.filter((t) => pick(t.fields)).length;
  return {
    files: targets.length,
    inherited: targets.filter((t) => t.inherited).length,
    withDate: count((f) => f.dateTaken),
    withGps: count((f) => f.gps),
    withDescription: count((f) => f.description),
    withPeople: count((f) => f.people),
    favorites: count((f) => f.rating),
  };
}

export async function runJsonToXmp(db: Db, onProgress?: (done: number, total: number) => void): Promise<ToolRunResult> {
  const targets = await jsonTargets(db);
  const result = emptyRunResult();
  for (const [i, t] of targets.entries()) {
    await writeAndCount(result, t.path, t.fields);
    onProgress?.(i + 1, targets.length);
  }
  return result;
}
