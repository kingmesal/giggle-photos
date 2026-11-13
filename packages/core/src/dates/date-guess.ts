/**
 * A capture date guessed from a file's name or folder (RFD-006/RFD-007), for files whose own
 * metadata has none: a date in the file name first, then the deepest dated folder.
 */
import { basename, dirname } from "node:path";
import { type DatePrecision, parseFilenameDate, parseFolderDate, wallTime } from "./date-parse";

export interface DateGuess {
  /** Local wall time "YYYY-MM-DDTHH:mm:ss". */
  takenAt: string;
  precision: DatePrecision;
  source: "filename" | "folder";
  /** The file or folder name text it was read from. */
  detail: string;
}

export function guessDate(path: string): DateGuess | null {
  const fromName = parseFilenameDate(basename(path));
  if (fromName) {
    return { takenAt: wallTime(fromName), precision: fromName.precision, source: "filename", detail: fromName.matched };
  }
  const fromFolder = parseFolderDate(dirname(path));
  if (fromFolder) {
    return {
      takenAt: wallTime(fromFolder),
      precision: fromFolder.precision,
      source: "folder",
      detail: fromFolder.matched,
    };
  }
  return null;
}
