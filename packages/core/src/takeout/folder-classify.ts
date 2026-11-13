/**
 * Classify folders of a Google Photos Takeout (RFD-003 §B).
 *
 * English names are the reference (the maintainer's export). Other languages are best-effort:
 * Takeout localizes folder names, so year folders are also recognised generically
 * ("<something with photo/foto> <4-digit year>").
 */

export type TakeoutFolderKind = "year" | "album" | "special" | "non_takeout";

/** Names of the Google Photos directory inside a Takeout export. */
export const GOOGLE_PHOTOS_DIR_NAMES = [
  "Google Photos",
  "Google Fotos",
  "Google Foto",
  "Google Foto's",
  "Zdjęcia Google",
] as const;

/** Year folders: "Photos from 2019" and localized forms. */
const YEAR_PATTERNS = [
  /^Photos from (\d{4})$/,
  /^Fotos aus (\d{4})$/, // de
  /^Photos de (\d{4})$/, // fr
  /^Fotos de (\d{4})$/, // es, pt
  /^Foto dal (\d{4})$/, // it
  /^Foto's uit (\d{4})$/, // nl
];
/** Generic fallback: a photo/foto word followed by a plausible year. */
const GENERIC_YEAR = /^(?=.*\b(?:photos?|fotos?|foto's)\b).*\s((?:19|20)\d{2})$/i;

/** Folders Google uses for non-album states. Excluded or flagged by setting. */
const SPECIAL_NAMES = new Set(
  [
    "Trash",
    "Bin",
    "Archive",
    "Locked Folder",
    // best-effort localizations
    "Papierkorb",
    "Archiv",
    "Corbeille",
    "Archives",
    "Papelera",
    "Archivo",
    "Cestino",
    "Archivio",
    "Prullenbak",
    "Archief",
  ].map((n) => n.toLowerCase()),
);

/** File names Google uses for an album's metadata JSON (the content check is authoritative). */
export const ALBUM_METADATA_FILE_NAMES = new Set(
  ["metadata.json", "métadonnées.json", "Metadaten.json", "metadatos.json", "metadati.json", "metadados.json"].map(
    (n) => n.normalize("NFC").toLowerCase(),
  ),
);

export function isGooglePhotosDirName(name: string): boolean {
  const normalized = name.normalize("NFC");
  return GOOGLE_PHOTOS_DIR_NAMES.some((n) => n.normalize("NFC") === normalized);
}

/** The year of a year folder ("Photos from 2019" → 2019), or null. */
export function yearOfFolder(name: string): number | null {
  for (const pattern of YEAR_PATTERNS) {
    const match = pattern.exec(name);
    if (match) return Number(match[1]);
  }
  const generic = GENERIC_YEAR.exec(name);
  return generic ? Number(generic[1]) : null;
}

/**
 * Classify a direct child folder of the Google Photos directory.
 * `albumTitle` is the folder name; the indexer replaces it with metadata.json's title when present.
 */
export function classifyTakeoutFolder(name: string): {
  kind: TakeoutFolderKind;
  year: number | null;
  albumTitle: string | null;
} {
  const year = yearOfFolder(name);
  if (year !== null) return { kind: "year", year, albumTitle: null };
  if (SPECIAL_NAMES.has(name.toLowerCase())) return { kind: "special", year: null, albumTitle: null };
  return { kind: "album", year: null, albumTitle: name };
}
