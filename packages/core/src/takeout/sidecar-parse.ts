/**
 * Parse Google Takeout JSON files (RFD-003 §C). Kind is decided by content, not file name:
 * media sidecars carry `photoTakenTime` / `url`; album metadata carries a `title` without them.
 * Field names follow Google's export format (title, description, photoTakenTime.timestamp,
 * geoData / geoDataExif, trashed, archived, favorited, people[].name).
 */

export type SidecarKind = "media" | "album_metadata" | "other";

export interface ParsedSidecar {
  kind: SidecarKind;
  /** Media: original file name as uploaded. Album: album title. */
  title: string | null;
  description: string | null;
  photoTakenTime: Date | null;
  geoLat: number | null;
  geoLon: number | null;
  geoAlt: number | null;
  trashed: boolean;
  archived: boolean;
  favorited: boolean;
  people: string[];
}

/** Larger JSON files are not sidecars (Takeout ships some big non-photo JSON files). */
export const MAX_SIDECAR_BYTES = 1024 * 1024;

const asRecord = (v: unknown): Record<string, unknown> | null =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const asString = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);
const asNumber = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Google writes 0/0 when a photo has no location. */
function geo(value: unknown): { lat: number; lon: number; alt: number | null } | null {
  const g = asRecord(value);
  const lat = asNumber(g?.latitude);
  const lon = asNumber(g?.longitude);
  if (lat === null || lon === null || (lat === 0 && lon === 0)) return null;
  return { lat, lon, alt: asNumber(g?.altitude) };
}

function takenTime(value: unknown): Date | null {
  const raw = asRecord(value)?.timestamp;
  const seconds = typeof raw === "string" ? Number(raw) : asNumber(raw);
  if (seconds === null || !Number.isFinite(seconds) || seconds <= 0) return null;
  return new Date(seconds * 1000);
}

/** Parse JSON text. Throws on invalid JSON (the caller counts it as an unparseable file). */
export function parseSidecarJson(text: string): ParsedSidecar {
  const json = asRecord(JSON.parse(text));
  const empty: ParsedSidecar = {
    kind: "other",
    title: null,
    description: null,
    photoTakenTime: null,
    geoLat: null,
    geoLon: null,
    geoAlt: null,
    trashed: false,
    archived: false,
    favorited: false,
    people: [],
  };
  if (!json) return empty;

  const isMedia = "photoTakenTime" in json || "url" in json || "imageViews" in json;
  const title = asString(json.title);
  const kind: SidecarKind = isMedia ? "media" : title !== null ? "album_metadata" : "other";
  // Prefer Google's own location (user-edited) and fall back to the camera's.
  const location = geo(json.geoData) ?? geo(json.geoDataExif);
  const people = Array.isArray(json.people)
    ? json.people.map((p) => asString(asRecord(p)?.name)).filter((n): n is string => n !== null)
    : [];

  return {
    kind,
    title,
    description: asString(json.description),
    photoTakenTime: takenTime(json.photoTakenTime),
    geoLat: location?.lat ?? null,
    geoLon: location?.lon ?? null,
    geoAlt: location?.alt ?? null,
    trashed: json.trashed === true,
    archived: json.archived === true,
    favorited: json.favorited === true,
    people,
  };
}
