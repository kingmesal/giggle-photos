/**
 * Capture dates from file names and folder names (RFD-006). Pure.
 *
 * Filenames carry a day or a full timestamp (IMG_20190512_143000, PXL_20190512_143000123,
 * Screenshot_2019-05-12-14-30-00, IMG-20190512-WA0001, 2019-05-12 14.30.00). Folders carry a day
 * ("2019-05-12 Trip", 2019/05/12), a month (2019-05, 2019/05) or a year ("Photos from 2019", 2019).
 * A partial date becomes a concrete one by the maintainer's rule: a year-only date is July 1, a
 * month-only date is the 15th, a day without a time is 12:00.
 */

export type DatePrecision = "second" | "day" | "month" | "year";

export interface DateGuess {
  year: number;
  month?: number;
  day?: number;
  hour?: number;
  minute?: number;
  second?: number;
  precision: DatePrecision;
  /** The text the date was read from. */
  matched: string;
}

const MIN_YEAR = 1990;
const maxYear = () => new Date().getFullYear() + 1;

function validDate(y: number, m = 1, d = 1, h = 0, mi = 0, s = 0): boolean {
  if (y < MIN_YEAR || y > maxYear() || m < 1 || m > 12 || h > 23 || mi > 59 || s > 59) return false;
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return d >= 1 && d <= daysInMonth;
}

// Date with an optional time: YYYY[-_.]MM[-_.]DD, then optionally [-_ T.]HH[-_.:]MM[-_.:]SS.
// Not preceded or followed by a digit (up to 3 millisecond digits allowed after the seconds).
const FILENAME =
  /(?<!\d)((?:19|20)\d{2})[-_.]?(0[1-9]|1[0-2])[-_.]?(0[1-9]|[12]\d|3[01])(?:[-_ T.]?([01]\d|2[0-3])[-_.:]?([0-5]\d)[-_.:]?([0-5]\d)\d{0,3})?(?!\d)/;

/** Date (and time, when present) in a file name, without its extension. */
export function parseFilenameDate(filename: string): DateGuess | null {
  const base = filename.replace(/\.[^.]+$/, "");
  const m = FILENAME.exec(base);
  if (!m) return null;
  const [y, mo, d, h, mi, s] = m.slice(1, 7).map((v) => (v === undefined ? undefined : Number(v)));
  if (!validDate(y as number, mo, d, h ?? 0, mi ?? 0, s ?? 0)) return null;
  const withTime = h !== undefined;
  return {
    year: y as number,
    month: mo,
    day: d,
    ...(withTime ? { hour: h, minute: mi, second: s } : {}),
    precision: withTime ? "second" : "day",
    matched: m[0],
  };
}

/** Numeric regex group (strict index access). */
const n = (m: RegExpExecArray, i: number): number => Number(m[i]);

const SEG_DAY = /^((?:19|20)\d{2})[-_. ](0[1-9]|1[0-2])[-_. ](0[1-9]|[12]\d|3[01])(?:$|[^0-9])/;
const SEG_MONTH = /^((?:19|20)\d{2})[-_. ](0[1-9]|1[0-2])(?:$|[^0-9])/;
const SEG_YEAR = /^(?:Photos from )?((?:19|20)\d{2})$/;
const SEG_MM = /^(0[1-9]|1[0-2])(?:$|[^0-9])/;
const SEG_DD = /^(0[1-9]|[12]\d|3[01])(?:$|[^0-9])/;

/**
 * Most precise date in a directory path, read from the deepest folder up: a dated folder name, or
 * nested numeric folders like 2019/05/12. Returns null when no folder carries a date.
 */
export function parseFolderDate(dirPath: string): DateGuess | null {
  const segs = dirPath.split(/[\\/]+/).filter(Boolean);
  for (let i = segs.length - 1; i >= 0; i--) {
    const seg = segs[i] as string;
    let m = SEG_DAY.exec(seg);
    if (m && validDate(n(m, 1), n(m, 2), n(m, 3))) {
      return { year: n(m, 1), month: n(m, 2), day: n(m, 3), precision: "day", matched: seg };
    }
    m = SEG_MONTH.exec(seg);
    if (m && validDate(n(m, 1), n(m, 2))) return { year: n(m, 1), month: n(m, 2), precision: "month", matched: seg };
    const parent = segs[i - 1];
    const grand = segs[i - 2];
    // 2019/05/12: day folder under month under year
    const dd = SEG_DD.exec(seg);
    if (dd && parent && grand && SEG_MM.test(parent) && SEG_YEAR.test(grand)) {
      const y = +(SEG_YEAR.exec(grand)?.[1] as string);
      const mo = +(SEG_MM.exec(parent)?.[1] as string);
      if (validDate(y, mo, n(dd, 1))) {
        return { year: y, month: mo, day: n(dd, 1), precision: "day", matched: `${grand}/${parent}/${seg}` };
      }
    }
    // 2019/05: month folder under a year folder
    const mm = SEG_MM.exec(seg);
    if (mm && parent && SEG_YEAR.test(parent)) {
      const y = +(SEG_YEAR.exec(parent)?.[1] as string);
      if (validDate(y, n(mm, 1))) return { year: y, month: n(mm, 1), precision: "month", matched: `${parent}/${seg}` };
    }
    m = SEG_YEAR.exec(seg);
    if (m && validDate(n(m, 1))) return { year: n(m, 1), precision: "year", matched: seg };
  }
  return null;
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

/**
 * Concrete local wall time "YYYY-MM-DDTHH:mm:ss" for a guess: year-only → July 1, month-only → the
 * 15th, a day without time → 12:00 (noon keeps the date stable across time zones).
 */
export function wallTime(g: DateGuess): string {
  const month = g.month ?? 7;
  const day = g.day ?? (g.month === undefined ? 1 : 15);
  const [h, mi, s] = g.precision === "second" ? [g.hour ?? 0, g.minute ?? 0, g.second ?? 0] : [12, 0, 0];
  return `${pad(g.year, 4)}-${pad(month)}-${pad(day)}T${pad(h)}:${pad(mi)}:${pad(s)}`;
}
