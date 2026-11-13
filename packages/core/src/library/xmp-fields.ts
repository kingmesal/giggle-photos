/**
 * Fields a Giggle Photos XMP sidecar can carry (Library Tools, RFD-007), each with where it came
 * from. Tools merge into one `<file>.xmp`: a field is replaced only by an equal or more trusted
 * source, so running the tools in any order gives the same sidecar. Pure.
 */

/** Most trusted first: Google's JSON (your edits in Google Photos), the file's own metadata, then guesses. */
export type FieldSource = "json" | "embedded" | "filename" | "folder";

const RANK: Record<FieldSource, number> = { json: 3, embedded: 2, filename: 1, folder: 0 };

export interface Sourced<T> {
  value: T;
  source: FieldSource;
}

export interface Gps {
  lat: number;
  lon: number;
  alt?: number;
}

export interface XmpFields {
  /** ISO date: with "+00:00" when it is an exact instant, without a zone for a wall time. */
  dateTaken?: Sourced<string>;
  gps?: Sourced<Gps>;
  description?: Sourced<string>;
  /** 0–5 stars (a Google favourite is 5). */
  rating?: Sourced<number>;
  /** People named in the photo (names only; Google exports no face positions). */
  people?: Sourced<string[]>;
  cameraMake?: Sourced<string>;
  cameraModel?: Sourced<string>;
}

export const FIELD_KEYS = [
  "dateTaken",
  "gps",
  "description",
  "rating",
  "people",
  "cameraMake",
  "cameraModel",
] as const satisfies readonly (keyof XmpFields)[];

/** Merge `incoming` into `existing`, field by field: the more trusted source wins; ties go to incoming. */
export function mergeFields(existing: XmpFields, incoming: XmpFields): XmpFields {
  const out: XmpFields = { ...existing };
  for (const key of FIELD_KEYS) {
    const next = incoming[key];
    const prev = existing[key];
    if (!next) continue;
    if (!prev || RANK[next.source] >= RANK[prev.source]) (out as Record<string, unknown>)[key] = next;
  }
  return out;
}

/** Whether two field sets would produce the same sidecar. */
export function sameFields(a: XmpFields, b: XmpFields): boolean {
  return FIELD_KEYS.every((k) => JSON.stringify(a[k] ?? null) === JSON.stringify(b[k] ?? null));
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

/** A Date as an exact instant in UTC: "2019-05-12T21:30:00+00:00". */
export function utcIso(d: Date): string {
  return `${d.toISOString().slice(0, 19)}+00:00`;
}

/** A Date's wall-clock time in this machine's zone, no zone suffix (how EXIF dates were read). */
export function wallIso(d: Date): string {
  return `${pad(d.getFullYear(), 4)}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** A usable GPS position: Google writes 0,0 when it has none. */
export function usableGps(lat: number | null | undefined, lon: number | null | undefined): boolean {
  return typeof lat === "number" && typeof lon === "number" && !(lat === 0 && lon === 0) && Math.abs(lat) <= 90;
}
