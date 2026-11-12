import { describe, expect, test } from "bun:test";
import { BooleanSchema, DateSchema, MAX_DATE, MAX_DATE_INTEGER, SQLBoolean, SQLDate } from "./util";

describe("util", () => {
  describe("MAX_DATE_INTEGER and MAX_DATE", () => {
    test("MAX_DATE_INTEGER is 8640000000000000", () => {
      expect(MAX_DATE_INTEGER).toBe(8640000000000000);
    });

    test("MAX_DATE is a Date at max integer ms", () => {
      expect(MAX_DATE).toBeInstanceOf(Date);
      expect(MAX_DATE.getTime()).toBe(MAX_DATE_INTEGER);
    });
  });

  describe("SQLDate", () => {
    test("accepts non-negative integer (ms since epoch)", () => {
      const result = SQLDate.safeParse(0);
      expect(result.success).toBe(true);
      if (result.success) expect(result.data).toBe(0);

      const result2 = SQLDate.safeParse(1700000000000);
      expect(result2.success).toBe(true);
      if (result2.success) expect(result2.data).toBe(1700000000000);
    });

    test("accepts MAX_DATE_INTEGER", () => {
      const result = SQLDate.safeParse(MAX_DATE_INTEGER);
      expect(result.success).toBe(true);
      if (result.success) expect(result.data).toBe(MAX_DATE_INTEGER);
    });

    test("rejects negative number", () => {
      const result = SQLDate.safeParse(-1);
      expect(result.success).toBe(false);
    });

    test("rejects number greater than MAX_DATE_INTEGER", () => {
      const result = SQLDate.safeParse(MAX_DATE_INTEGER + 1);
      expect(result.success).toBe(false);
    });

    test("rejects non-integer number", () => {
      const result = SQLDate.safeParse(1700000000000.5);
      expect(result.success).toBe(false);
    });

    test("preprocesses Date to ms", () => {
      const d = new Date("2024-01-15T12:00:00.000Z");
      const result = SQLDate.safeParse(d);
      expect(result.success).toBe(true);
      if (result.success) expect(result.data).toBe(d.getTime());
    });

    test("preprocesses ISO string to ms", () => {
      const result = SQLDate.safeParse("2024-01-15T12:00:00.000Z");
      expect(result.success).toBe(true);
      if (result.success) expect(result.data).toBe(new Date("2024-01-15T12:00:00.000Z").getTime());
    });

    test("rejects empty string (NaN after parse)", () => {
      const result = SQLDate.safeParse("");
      expect(result.success).toBe(false);
    });

    test("rejects invalid string", () => {
      const result = SQLDate.safeParse("not a date");
      expect(result.success).toBe(false);
    });

    test("rejects non-date non-number types", () => {
      expect(SQLDate.safeParse(null).success).toBe(false);
      expect(SQLDate.safeParse({}).success).toBe(false);
      expect(SQLDate.safeParse(true).success).toBe(false);
    });
  });

  describe("SQLBoolean", () => {
    test("preprocesses truthy values to 1", () => {
      expect(SQLBoolean.parse(true)).toBe(1);
      expect(SQLBoolean.parse(1)).toBe(1);
      expect(SQLBoolean.parse("1")).toBe(1);
      expect(SQLBoolean.parse("true")).toBe(1);
      expect(SQLBoolean.parse("True")).toBe(1);
      expect(SQLBoolean.parse("TRUE")).toBe(1);
    });

    test("preprocesses falsy values to 0", () => {
      expect(SQLBoolean.parse(false)).toBe(0);
      expect(SQLBoolean.parse(0)).toBe(0);
      expect(SQLBoolean.parse("0")).toBe(0);
      expect(SQLBoolean.parse("false")).toBe(0);
      expect(SQLBoolean.parse("")).toBe(0);
      expect(SQLBoolean.parse(null)).toBe(0);
      expect(SQLBoolean.parse(undefined)).toBe(0);
    });

    test("output is 0 or 1 only", () => {
      const r1 = SQLBoolean.safeParse("true");
      expect(r1.success).toBe(true);
      if (r1.success) expect([0, 1]).toContain(r1.data);

      const r2 = SQLBoolean.safeParse("false");
      expect(r2.success).toBe(true);
      if (r2.success) expect(r2.data).toBe(0);
    });
  });

  describe("BooleanSchema", () => {
    test("preprocesses truthy values to true", () => {
      expect(BooleanSchema.parse(true)).toBe(true);
      expect(BooleanSchema.parse(1)).toBe(true);
      expect(BooleanSchema.parse("1")).toBe(true);
      expect(BooleanSchema.parse("true")).toBe(true);
      expect(BooleanSchema.parse("True")).toBe(true);
      expect(BooleanSchema.parse("TRUE")).toBe(true);
    });

    test("preprocesses falsy values to false", () => {
      expect(BooleanSchema.parse(false)).toBe(false);
      expect(BooleanSchema.parse(0)).toBe(false);
      expect(BooleanSchema.parse("0")).toBe(false);
      expect(BooleanSchema.parse("")).toBe(false);
      expect(BooleanSchema.parse(null)).toBe(false);
      expect(BooleanSchema.parse(undefined)).toBe(false);
    });

    test("output is boolean only", () => {
      const r = BooleanSchema.safeParse("true");
      expect(r.success).toBe(true);
      if (r.success) expect(typeof r.data).toBe("boolean");
    });
  });

  describe("DateSchema", () => {
    test("accepts Date instance", () => {
      const d = new Date("2024-06-01T00:00:00.000Z");
      const result = DateSchema.safeParse(d);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBeInstanceOf(Date);
        expect(result.data.getTime()).toBe(d.getTime());
      }
    });

    test("accepts ISO date string", () => {
      const result = DateSchema.safeParse("2024-06-01T00:00:00.000Z");
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBeInstanceOf(Date);
        expect(result.data.getTime()).toBe(new Date("2024-06-01T00:00:00.000Z").getTime());
      }
    });

    test("accepts number as seconds (< 99999999999)", () => {
      const result = DateSchema.safeParse(1700000000); // seconds
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBeInstanceOf(Date);
        expect(result.data.getTime()).toBe(1700000000 * 1000);
      }
    });

    test("accepts number as ms (>= 99999999999)", () => {
      const ms = 1700000000000;
      const result = DateSchema.safeParse(ms);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBeInstanceOf(Date);
        expect(result.data.getTime()).toBe(ms);
      }
    });

    test("rejects invalid date string", () => {
      const result = DateSchema.safeParse("not a date");
      expect(result.success).toBe(false);
    });

    test("rejects invalid number (NaN)", () => {
      const result = DateSchema.safeParse(Number.NaN);
      expect(result.success).toBe(false);
    });

    test("rejects null (preprocess returns null, z.date() fails)", () => {
      const result = DateSchema.safeParse(null);
      expect(result.success).toBe(false);
    });

    test("rejects undefined (preprocess returns undefined, z.date() fails)", () => {
      const result = DateSchema.safeParse(undefined);
      expect(result.success).toBe(false);
    });

    test("rejects object", () => {
      const result = DateSchema.safeParse({});
      expect(result.success).toBe(false);
    });
  });
});
