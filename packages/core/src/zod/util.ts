import z from "zod";

export const MAX_DATE_INTEGER = 8640000000000000;
export const MAX_DATE = new Date(MAX_DATE_INTEGER);

export const SQLDate = z.preprocess((value) => {
  // Already a non-negative integer number: accept as-is
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  // If it's a Date, convert to ms
  if (value instanceof Date) {
    return value.getTime();
  }

  // If it's a string, try to parse as ISO (or any Date-parsable string)
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return NaN; // will fail validation below
    }

    const timestamp = Date.parse(trimmed); // ms since epoch or NaN
    return timestamp;
  }

  // Everything else: force failure later
  return NaN;
}, z.number().int().nonnegative().max(MAX_DATE_INTEGER).describe("Unix time in UTC - starting wall clock time"));
export type SQLDate = z.infer<typeof SQLDate>;

export const SQLBoolean = z.preprocess(
  (arg: unknown): 0 | 1 => {
    if (arg === true || arg === 1 || arg === "1" || arg === "true" || arg === "True" || arg === "TRUE") {
      return 1;
    }
    return 0;
  },
  z.union([z.literal(0), z.literal(1)]),
);
export type SQLBoolean = z.infer<typeof SQLBoolean>;

export const BooleanSchema = z.preprocess((arg: boolean | number | string): boolean => {
  if (arg === true || arg === 1 || arg === "1" || arg === "true" || arg === "True" || arg === "TRUE") {
    return true;
  }
  return false;
}, z.boolean());

export const DateSchema = z.preprocess((arg: unknown): Date | null | undefined => {
  if (typeof arg === "string" || arg instanceof Date) {
    const date = new Date(arg);
    return Number.isNaN(date.getTime()) ? undefined : date;
  }
  if (typeof arg === "number") {
    const date = arg < 99999999999 ? new Date(arg * 1000) : new Date(arg);
    return Number.isNaN(date.getTime()) ? undefined : date;
  }
  if (arg === undefined) {
    return undefined;
  }
  return null;
}, z.date());
