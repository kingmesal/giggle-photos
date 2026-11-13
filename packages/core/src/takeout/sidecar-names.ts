/**
 * Google Takeout sidecar / media filename grammar (RFD-003 §C.2).
 *
 * Observed in real exports:
 * - `IMG_1.jpg.json`, newer `IMG_1.jpg.supplemental-metadata.json`.
 * - The sidecar name (without a duplicate counter) is capped at 51 characters including ".json":
 *   the "supplemental-metadata" word is cut first (`.supple.json`, `.supplemental-me.json`), then the
 *   media name itself (`…_com.snapcha.json` for `…_com.snapchat.jpg`).
 * - Duplicate counters move: media `IMG_1(1).jpg` ↔ sidecar `IMG_1.jpg(1).json` or
 *   `IMG_1.jpg.supplemental-metadata(1).json` (counter appended after the cap is applied).
 * - Edited copies (`IMG_1-edited.jpg`, localized) and live-photo videos have no sidecar of their own.
 */

/** Total length cap of a sidecar name, ".json" included, before any "(n)" counter. */
export const SIDECAR_NAME_CAP = 51;
const SUPPLEMENTAL = "supplemental-metadata";
const COUNTER = /\((\d+)\)$/;

/** Suffixes Google appends to edited copies (English is the reference; others best-effort). */
export const EDITED_SUFFIXES = [
  "-edited",
  "-bearbeitet",
  "-modifié",
  "-editado",
  "-modificato",
  "-bewerkt",
  "-redigerad",
];

const nfc = (s: string) => s.normalize("NFC");

export interface SidecarName {
  /** Media file name the sidecar describes, possibly truncated (see `truncated`). */
  base: string;
  /** Duplicate counter, e.g. 1 for `IMG.jpg(1).json`. */
  counter: number | null;
  supplemental: boolean;
  /** The name hit the length cap, so `base` may be a prefix of the real media name. */
  truncated: boolean;
}

export interface MediaName {
  name: string;
  /** Name with any "(n)" duplicate counter removed: `IMG(1).jpg` → `IMG.jpg`. */
  counterless: string;
  counter: number | null;
  extension: string;
  /** For edited copies, the original's counterless name (`IMG-edited.jpg` → `IMG.jpg`), else null. */
  editedOf: string | null;
}

/** Parse a sidecar file name; null if it is not a `.json` file. */
export function parseSidecarName(fileName: string): SidecarName | null {
  const name = nfc(fileName);
  if (!name.toLowerCase().endsWith(".json")) return null;
  let rest = name.slice(0, -".json".length);
  let counter: number | null = null;
  const counterMatch = COUNTER.exec(rest);
  if (counterMatch) {
    counter = Number(counterMatch[1]);
    rest = rest.slice(0, counterMatch.index);
  }
  const lengthBeforeCounter = rest.length + ".json".length;
  const truncated = lengthBeforeCounter >= SIDECAR_NAME_CAP;

  let supplemental = false;
  const dot = rest.lastIndexOf(".");
  if (dot > 0) {
    const segment = rest.slice(dot + 1).toLowerCase();
    // The full word always counts; a cut-down prefix only when the name hit the cap.
    if (segment === SUPPLEMENTAL || (truncated && segment.length > 0 && SUPPLEMENTAL.startsWith(segment))) {
      supplemental = true;
      rest = rest.slice(0, dot);
    }
  }
  return { base: rest, counter, supplemental, truncated };
}

/** Parse a media file name into its counter, extension and edited-copy relationship. */
export function parseMediaName(fileName: string): MediaName {
  const name = nfc(fileName);
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const extension = dot > 0 ? name.slice(dot + 1) : "";
  const withExt = (s: string) => (extension ? `${s}.${extension}` : s);

  const counterMatch = COUNTER.exec(stem);
  const counter = counterMatch ? Number(counterMatch[1]) : null;
  const stemNoCounter = counterMatch ? stem.slice(0, counterMatch.index) : stem;

  let editedOf: string | null = null;
  const lower = stemNoCounter.toLowerCase();
  for (const suffix of EDITED_SUFFIXES) {
    if (lower.endsWith(suffix) && lower.length > suffix.length) {
      editedOf = withExt(stemNoCounter.slice(0, -suffix.length));
      break;
    }
  }
  return { name, counterless: withExt(stemNoCounter), counter, extension, editedOf };
}

/**
 * How a sidecar name refers to a media name, or null if it does not:
 * - "exact": the sidecar base is the media file name (with its counter in the usual place);
 * - "truncated": the sidecar name hit the cap and its base is a prefix of the media name.
 */
export function sidecarNameRefersTo(sidecar: SidecarName, media: MediaName): "exact" | "truncated" | null {
  // A "(n)" that belongs to the original file name (no separate sidecar counter).
  if (sidecar.counter === null && sidecar.base === media.name) return "exact";
  if (sidecar.counter !== media.counter) return null;
  if (sidecar.base === media.counterless) return "exact";
  if (sidecar.truncated && sidecar.base.length > 0 && media.counterless.startsWith(sidecar.base)) return "truncated";
  return null;
}
