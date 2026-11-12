import { describe, expect, test } from "bun:test";
import { NewPhashMatch, PhashMatch, PhashMatchRecord, UpdatePhashMatch } from "./phash-match";

const validDate = new Date("2024-01-15T12:00:00.000Z");

function validPhashMatchInput(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    mediaFileId1: 10,
    mediaFileId2: 20,
    distance: 3,
    createdAt: validDate,
    ...overrides,
  };
}

describe("phash-match", () => {
  describe("PhashMatch", () => {
    test("parses valid full input", () => {
      const input = validPhashMatchInput();
      const result = PhashMatch.parse(input);
      expect(result.id).toBe(1);
      expect(result.mediaFileId1).toBe(10);
      expect(result.mediaFileId2).toBe(20);
      expect(result.distance).toBe(3);
      expect(result.createdAt).toEqual(validDate);
    });

    test("accepts distance 0 (identical)", () => {
      const input = validPhashMatchInput({ distance: 0 });
      const result = PhashMatch.parse(input);
      expect(result.distance).toBe(0);
    });

    test("accepts distance 64 (maximum)", () => {
      const input = validPhashMatchInput({ distance: 64 });
      const result = PhashMatch.parse(input);
      expect(result.distance).toBe(64);
    });

    test("rejects distance > 64", () => {
      expect(PhashMatch.safeParse(validPhashMatchInput({ distance: 65 })).success).toBe(false);
      expect(PhashMatch.safeParse(validPhashMatchInput({ distance: 100 })).success).toBe(false);
    });

    test("rejects negative distance", () => {
      expect(PhashMatch.safeParse(validPhashMatchInput({ distance: -1 })).success).toBe(false);
      expect(PhashMatch.safeParse(validPhashMatchInput({ distance: -10 })).success).toBe(false);
    });

    test("rejects non-integer distance", () => {
      expect(PhashMatch.safeParse(validPhashMatchInput({ distance: 3.5 })).success).toBe(false);
      expect(PhashMatch.safeParse(validPhashMatchInput({ distance: 1.1 })).success).toBe(false);
    });

    test("rejects id zero or negative", () => {
      expect(PhashMatch.safeParse(validPhashMatchInput({ id: 0 })).success).toBe(false);
      expect(PhashMatch.safeParse(validPhashMatchInput({ id: -1 })).success).toBe(false);
      expect(PhashMatch.safeParse(validPhashMatchInput({ id: -100 })).success).toBe(false);
    });

    test("rejects non-integer id", () => {
      expect(PhashMatch.safeParse(validPhashMatchInput({ id: 1.5 })).success).toBe(false);
      expect(PhashMatch.safeParse(validPhashMatchInput({ id: 2.7 })).success).toBe(false);
    });

    test("rejects mediaFileId1 zero or negative", () => {
      expect(PhashMatch.safeParse(validPhashMatchInput({ mediaFileId1: 0 })).success).toBe(false);
      expect(PhashMatch.safeParse(validPhashMatchInput({ mediaFileId1: -1 })).success).toBe(false);
      expect(PhashMatch.safeParse(validPhashMatchInput({ mediaFileId1: -50 })).success).toBe(false);
    });

    test("rejects non-integer mediaFileId1", () => {
      expect(PhashMatch.safeParse(validPhashMatchInput({ mediaFileId1: 1.5 })).success).toBe(false);
    });

    test("rejects mediaFileId2 zero or negative", () => {
      expect(PhashMatch.safeParse(validPhashMatchInput({ mediaFileId2: 0 })).success).toBe(false);
      expect(PhashMatch.safeParse(validPhashMatchInput({ mediaFileId2: -1 })).success).toBe(false);
      expect(PhashMatch.safeParse(validPhashMatchInput({ mediaFileId2: -50 })).success).toBe(false);
    });

    test("rejects non-integer mediaFileId2", () => {
      expect(PhashMatch.safeParse(validPhashMatchInput({ mediaFileId2: 2.5 })).success).toBe(false);
    });

    test("rejects missing required fields", () => {
      expect(PhashMatch.safeParse({ id: 1 }).success).toBe(false);
      expect(PhashMatch.safeParse({ id: 1, mediaFileId1: 10 }).success).toBe(false);
      expect(PhashMatch.safeParse({ id: 1, mediaFileId1: 10, mediaFileId2: 20 }).success).toBe(false);
    });

    test("accepts date-like inputs for createdAt", () => {
      const input = validPhashMatchInput({
        createdAt: validDate.getTime(),
      });
      const result = PhashMatch.parse(input);
      expect(result.createdAt).toBeInstanceOf(Date);
    });

    test("accepts string date for createdAt", () => {
      const input = validPhashMatchInput({
        createdAt: "2024-01-15T12:00:00.000Z",
      });
      const result = PhashMatch.parse(input);
      expect(result.createdAt).toBeInstanceOf(Date);
    });
  });

  describe("PhashMatchRecord", () => {
    test("parses input with SQL types for dates", () => {
      const input = {
        mediaFileId1: 10,
        mediaFileId2: 20,
        distance: 5,
        createdAt: validDate.getTime(),
      };
      const result = PhashMatchRecord.parse(input);
      expect(result.mediaFileId1).toBe(10);
      expect(result.mediaFileId2).toBe(20);
      expect(result.distance).toBe(5);
      expect(result.createdAt).toBe(validDate.getTime());
    });

    test("preprocesses Date object to timestamp", () => {
      const input = {
        mediaFileId1: 10,
        mediaFileId2: 20,
        distance: 2,
        createdAt: validDate,
      };
      const result = PhashMatchRecord.parse(input);
      expect(result.createdAt).toBe(validDate.getTime());
    });

    test("parsed result omits id (schema has no id field)", () => {
      const input = {
        id: 1,
        mediaFileId1: 10,
        mediaFileId2: 20,
        distance: 0,
        createdAt: 0,
      };
      const result = PhashMatchRecord.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) expect("id" in result.data).toBe(false);
    });

    test("accepts distance boundary values", () => {
      for (const distance of [0, 1, 32, 63, 64]) {
        const input = {
          mediaFileId1: 1,
          mediaFileId2: 2,
          distance,
          createdAt: 0,
        };
        const result = PhashMatchRecord.safeParse(input);
        expect(result.success).toBe(true);
      }
    });

    test("rejects negative timestamps", () => {
      const input = {
        mediaFileId1: 10,
        mediaFileId2: 20,
        distance: 3,
        createdAt: -1,
      };
      expect(PhashMatchRecord.safeParse(input).success).toBe(false);
    });
  });

  describe("NewPhashMatch", () => {
    test("parses input without id and createdAt", () => {
      const input = {
        mediaFileId1: 10,
        mediaFileId2: 20,
        distance: 4,
      };
      const result = NewPhashMatch.parse(input);
      expect(result.mediaFileId1).toBe(10);
      expect(result.mediaFileId2).toBe(20);
      expect(result.distance).toBe(4);
      expect("id" in result).toBe(false);
      expect("createdAt" in result).toBe(false);
    });

    test("accepts all valid distance values", () => {
      for (const distance of [0, 1, 5, 10, 32, 64]) {
        const input = {
          mediaFileId1: 1,
          mediaFileId2: 2,
          distance,
        };
        const result = NewPhashMatch.parse(input);
        expect(result.distance).toBe(distance);
      }
    });

    test("rejects missing mediaFileId1", () => {
      expect(
        NewPhashMatch.safeParse({
          mediaFileId2: 20,
          distance: 3,
        }).success,
      ).toBe(false);
    });

    test("rejects missing mediaFileId2", () => {
      expect(
        NewPhashMatch.safeParse({
          mediaFileId1: 10,
          distance: 3,
        }).success,
      ).toBe(false);
    });

    test("rejects missing distance", () => {
      expect(
        NewPhashMatch.safeParse({
          mediaFileId1: 10,
          mediaFileId2: 20,
        }).success,
      ).toBe(false);
    });

    test("rejects invalid mediaFileId1", () => {
      expect(
        NewPhashMatch.safeParse({
          mediaFileId1: 0,
          mediaFileId2: 20,
          distance: 3,
        }).success,
      ).toBe(false);
      expect(
        NewPhashMatch.safeParse({
          mediaFileId1: -1,
          mediaFileId2: 20,
          distance: 3,
        }).success,
      ).toBe(false);
    });

    test("rejects invalid mediaFileId2", () => {
      expect(
        NewPhashMatch.safeParse({
          mediaFileId1: 10,
          mediaFileId2: 0,
          distance: 3,
        }).success,
      ).toBe(false);
      expect(
        NewPhashMatch.safeParse({
          mediaFileId1: 10,
          mediaFileId2: -1,
          distance: 3,
        }).success,
      ).toBe(false);
    });

    test("rejects invalid distance", () => {
      expect(
        NewPhashMatch.safeParse({
          mediaFileId1: 10,
          mediaFileId2: 20,
          distance: -1,
        }).success,
      ).toBe(false);
      expect(
        NewPhashMatch.safeParse({
          mediaFileId1: 10,
          mediaFileId2: 20,
          distance: 65,
        }).success,
      ).toBe(false);
    });
  });

  describe("UpdatePhashMatch", () => {
    test("requires id", () => {
      expect(UpdatePhashMatch.safeParse({ mediaFileId1: 10 }).success).toBe(false);
      expect(UpdatePhashMatch.safeParse({ distance: 5 }).success).toBe(false);
      const result = UpdatePhashMatch.safeParse({ id: 1 });
      expect(result.success).toBe(true);
    });

    test("accepts partial update with id", () => {
      const result = UpdatePhashMatch.parse({ id: 1, mediaFileId1: 15 });
      expect(result.id).toBe(1);
      expect(result.mediaFileId1).toBe(15);
    });

    test("accepts only id", () => {
      const result = UpdatePhashMatch.parse({ id: 5 });
      expect(result.id).toBe(5);
    });

    test("accepts multiple optional fields", () => {
      const result = UpdatePhashMatch.parse({
        id: 2,
        mediaFileId1: 100,
        mediaFileId2: 200,
        distance: 10,
      });
      expect(result.id).toBe(2);
      expect(result.mediaFileId1).toBe(100);
      expect(result.mediaFileId2).toBe(200);
      expect(result.distance).toBe(10);
    });

    test("rejects invalid id", () => {
      expect(UpdatePhashMatch.safeParse({ id: 0 }).success).toBe(false);
      expect(UpdatePhashMatch.safeParse({ id: -1 }).success).toBe(false);
    });

    test("rejects non-integer id", () => {
      expect(UpdatePhashMatch.safeParse({ id: 1.5 }).success).toBe(false);
    });

    test("rejects invalid mediaFileId1 when provided", () => {
      expect(UpdatePhashMatch.safeParse({ id: 1, mediaFileId1: 0 }).success).toBe(false);
      expect(UpdatePhashMatch.safeParse({ id: 1, mediaFileId1: -1 }).success).toBe(false);
      expect(UpdatePhashMatch.safeParse({ id: 1, mediaFileId1: 1.5 }).success).toBe(false);
    });

    test("rejects invalid mediaFileId2 when provided", () => {
      expect(UpdatePhashMatch.safeParse({ id: 1, mediaFileId2: 0 }).success).toBe(false);
      expect(UpdatePhashMatch.safeParse({ id: 1, mediaFileId2: -1 }).success).toBe(false);
      expect(UpdatePhashMatch.safeParse({ id: 1, mediaFileId2: 1.5 }).success).toBe(false);
    });

    test("rejects invalid distance when provided", () => {
      expect(UpdatePhashMatch.safeParse({ id: 1, distance: -1 }).success).toBe(false);
      expect(UpdatePhashMatch.safeParse({ id: 1, distance: 65 }).success).toBe(false);
      expect(UpdatePhashMatch.safeParse({ id: 1, distance: 3.5 }).success).toBe(false);
    });

    test("omits createdAt from updates", () => {
      const result = UpdatePhashMatch.safeParse({
        id: 1,
        createdAt: validDate,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect("createdAt" in result.data).toBe(false);
      }
    });
  });
});
