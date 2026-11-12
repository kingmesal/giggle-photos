import { describe, expect, test } from "bun:test";
import {
  FileDecision,
  FileDecisionAction,
  FileDecisionMethod,
  FileDecisionRecord,
  NewFileDecision,
  UpdateFileDecision,
} from "./file-decision";

const validDate = new Date("2024-01-15T12:00:00.000Z");

function validFileDecisionInput(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    mediaFileId: 10,
    action: "keep" as const,
    method: "sha256" as const,
    reviewGroupKey: "abc123def456",
    createdAt: validDate,
    ...overrides,
  };
}

describe("file-decision", () => {
  describe("FileDecisionAction", () => {
    test("accepts 'keep'", () => {
      expect(FileDecisionAction.parse("keep")).toBe("keep");
    });

    test("accepts 'delete'", () => {
      expect(FileDecisionAction.parse("delete")).toBe("delete");
    });

    test("rejects invalid action strings", () => {
      expect(FileDecisionAction.safeParse("remove").success).toBe(false);
      expect(FileDecisionAction.safeParse("KEEP").success).toBe(false);
      expect(FileDecisionAction.safeParse("").success).toBe(false);
      expect(FileDecisionAction.safeParse("ignore").success).toBe(false);
    });

    test("rejects non-string types", () => {
      expect(FileDecisionAction.safeParse(1).success).toBe(false);
      expect(FileDecisionAction.safeParse(null).success).toBe(false);
      expect(FileDecisionAction.safeParse(undefined).success).toBe(false);
      expect(FileDecisionAction.safeParse({}).success).toBe(false);
    });
  });

  describe("FileDecisionMethod", () => {
    test("accepts 'sha256'", () => {
      expect(FileDecisionMethod.parse("sha256")).toBe("sha256");
    });

    test("accepts 'content_hash'", () => {
      expect(FileDecisionMethod.parse("content_hash")).toBe("content_hash");
    });

    test("accepts 'phash'", () => {
      expect(FileDecisionMethod.parse("phash")).toBe("phash");
    });

    test("rejects invalid method strings", () => {
      expect(FileDecisionMethod.safeParse("md5").success).toBe(false);
      expect(FileDecisionMethod.safeParse("SHA256").success).toBe(false);
      expect(FileDecisionMethod.safeParse("").success).toBe(false);
    });
  });

  describe("FileDecision", () => {
    test("parses valid full input", () => {
      const input = validFileDecisionInput();
      const result = FileDecision.parse(input);
      expect(result.id).toBe(1);
      expect(result.mediaFileId).toBe(10);
      expect(result.action).toBe("keep");
      expect(result.method).toBe("sha256");
      expect(result.reviewGroupKey).toBe("abc123def456");
      expect(result.createdAt).toEqual(validDate);
    });

    test("parses with delete action", () => {
      const input = validFileDecisionInput({ action: "delete" });
      const result = FileDecision.parse(input);
      expect(result.action).toBe("delete");
    });

    test("parses with content_hash method", () => {
      const input = validFileDecisionInput({ method: "content_hash" });
      const result = FileDecision.parse(input);
      expect(result.method).toBe("content_hash");
    });

    test("parses with phash method and phash group key", () => {
      const input = validFileDecisionInput({ method: "phash", reviewGroupKey: "phash:42" });
      const result = FileDecision.parse(input);
      expect(result.method).toBe("phash");
      expect(result.reviewGroupKey).toBe("phash:42");
    });

    test("rejects id zero or negative", () => {
      expect(FileDecision.safeParse(validFileDecisionInput({ id: 0 })).success).toBe(false);
      expect(FileDecision.safeParse(validFileDecisionInput({ id: -1 })).success).toBe(false);
    });

    test("rejects non-integer id", () => {
      expect(FileDecision.safeParse(validFileDecisionInput({ id: 1.5 })).success).toBe(false);
    });

    test("rejects mediaFileId zero or negative", () => {
      expect(FileDecision.safeParse(validFileDecisionInput({ mediaFileId: 0 })).success).toBe(false);
      expect(FileDecision.safeParse(validFileDecisionInput({ mediaFileId: -1 })).success).toBe(false);
    });

    test("rejects non-integer mediaFileId", () => {
      expect(FileDecision.safeParse(validFileDecisionInput({ mediaFileId: 1.5 })).success).toBe(false);
    });

    test("rejects invalid action", () => {
      expect(FileDecision.safeParse(validFileDecisionInput({ action: "invalid" })).success).toBe(false);
      expect(FileDecision.safeParse(validFileDecisionInput({ action: "" })).success).toBe(false);
    });

    test("rejects invalid method", () => {
      expect(FileDecision.safeParse(validFileDecisionInput({ method: "invalid" })).success).toBe(false);
      expect(FileDecision.safeParse(validFileDecisionInput({ method: "" })).success).toBe(false);
    });

    test("rejects empty reviewGroupKey", () => {
      expect(FileDecision.safeParse(validFileDecisionInput({ reviewGroupKey: "" })).success).toBe(false);
    });

    test("rejects missing required fields", () => {
      expect(FileDecision.safeParse({ id: 1 }).success).toBe(false);
      expect(FileDecision.safeParse({ id: 1, mediaFileId: 10 }).success).toBe(false);
    });

    test("accepts date-like inputs for createdAt", () => {
      const input = validFileDecisionInput({ createdAt: validDate.getTime() });
      const result = FileDecision.parse(input);
      expect(result.createdAt).toBeInstanceOf(Date);
    });

    test("accepts string date for createdAt", () => {
      const input = validFileDecisionInput({ createdAt: "2024-01-15T12:00:00.000Z" });
      const result = FileDecision.parse(input);
      expect(result.createdAt).toBeInstanceOf(Date);
    });
  });

  describe("FileDecisionRecord", () => {
    test("parses input with SQL types for dates", () => {
      const input = {
        mediaFileId: 10,
        action: "keep",
        method: "sha256",
        reviewGroupKey: "abc123",
        createdAt: validDate.getTime(),
      };
      const result = FileDecisionRecord.parse(input);
      expect(result.mediaFileId).toBe(10);
      expect(result.action).toBe("keep");
      expect(result.method).toBe("sha256");
      expect(result.reviewGroupKey).toBe("abc123");
      expect(result.createdAt).toBe(validDate.getTime());
    });

    test("preprocesses Date object to timestamp", () => {
      const input = {
        mediaFileId: 10,
        action: "delete",
        method: "content_hash",
        reviewGroupKey: "xyz789",
        createdAt: validDate,
      };
      const result = FileDecisionRecord.parse(input);
      expect(result.createdAt).toBe(validDate.getTime());
    });

    test("parsed result omits id (schema has no id field)", () => {
      const input = {
        id: 1,
        mediaFileId: 10,
        action: "keep",
        method: "phash",
        reviewGroupKey: "phash:1",
        createdAt: 0,
      };
      const result = FileDecisionRecord.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) expect("id" in result.data).toBe(false);
    });

    test("accepts all valid actions", () => {
      const actions = ["keep", "delete"] as const;
      for (const action of actions) {
        const input = {
          mediaFileId: 1,
          action,
          method: "sha256" as const,
          reviewGroupKey: "test",
          createdAt: 0,
        };
        const result = FileDecisionRecord.safeParse(input);
        expect(result.success).toBe(true);
      }
    });

    test("rejects negative timestamps", () => {
      const input = {
        mediaFileId: 10,
        action: "keep",
        method: "sha256",
        reviewGroupKey: "test",
        createdAt: -1,
      };
      expect(FileDecisionRecord.safeParse(input).success).toBe(false);
    });
  });

  describe("NewFileDecision", () => {
    test("parses input without id and createdAt", () => {
      const input = {
        mediaFileId: 10,
        action: "keep" as const,
        method: "sha256" as const,
        reviewGroupKey: "abc123",
      };
      const result = NewFileDecision.parse(input);
      expect(result.mediaFileId).toBe(10);
      expect(result.action).toBe("keep");
      expect(result.method).toBe("sha256");
      expect(result.reviewGroupKey).toBe("abc123");
      expect("id" in result).toBe(false);
      expect("createdAt" in result).toBe(false);
    });

    test("parses with all valid actions", () => {
      const actions = ["keep", "delete"] as const;
      for (const action of actions) {
        const input = {
          mediaFileId: 1,
          action,
          method: "sha256" as const,
          reviewGroupKey: "test",
        };
        const result = NewFileDecision.parse(input);
        expect(result.action).toBe(action);
      }
    });

    test("parses with all valid methods", () => {
      const methods = ["sha256", "content_hash", "phash"] as const;
      for (const method of methods) {
        const input = {
          mediaFileId: 1,
          action: "keep" as const,
          method,
          reviewGroupKey: "test",
        };
        const result = NewFileDecision.parse(input);
        expect(result.method).toBe(method);
      }
    });

    test("rejects missing mediaFileId", () => {
      expect(
        NewFileDecision.safeParse({
          action: "keep",
          method: "sha256",
          reviewGroupKey: "test",
        }).success,
      ).toBe(false);
    });

    test("rejects missing action", () => {
      expect(
        NewFileDecision.safeParse({
          mediaFileId: 10,
          method: "sha256",
          reviewGroupKey: "test",
        }).success,
      ).toBe(false);
    });

    test("rejects missing method", () => {
      expect(
        NewFileDecision.safeParse({
          mediaFileId: 10,
          action: "keep",
          reviewGroupKey: "test",
        }).success,
      ).toBe(false);
    });

    test("rejects missing reviewGroupKey", () => {
      expect(
        NewFileDecision.safeParse({
          mediaFileId: 10,
          action: "keep",
          method: "sha256",
        }).success,
      ).toBe(false);
    });

    test("rejects invalid mediaFileId", () => {
      expect(
        NewFileDecision.safeParse({
          mediaFileId: 0,
          action: "keep",
          method: "sha256",
          reviewGroupKey: "test",
        }).success,
      ).toBe(false);
      expect(
        NewFileDecision.safeParse({
          mediaFileId: -1,
          action: "keep",
          method: "sha256",
          reviewGroupKey: "test",
        }).success,
      ).toBe(false);
    });
  });

  describe("UpdateFileDecision", () => {
    test("requires id", () => {
      expect(UpdateFileDecision.safeParse({ mediaFileId: 10 }).success).toBe(false);
      expect(UpdateFileDecision.safeParse({ action: "keep" }).success).toBe(false);
      const result = UpdateFileDecision.safeParse({ id: 1 });
      expect(result.success).toBe(true);
    });

    test("accepts partial update with id", () => {
      const result = UpdateFileDecision.parse({ id: 1, action: "delete" });
      expect(result.id).toBe(1);
      expect(result.action).toBe("delete");
    });

    test("accepts only id", () => {
      const result = UpdateFileDecision.parse({ id: 5 });
      expect(result.id).toBe(5);
    });

    test("accepts multiple optional fields", () => {
      const result = UpdateFileDecision.parse({
        id: 2,
        mediaFileId: 100,
        action: "delete",
        method: "phash",
        reviewGroupKey: "phash:42",
      });
      expect(result.id).toBe(2);
      expect(result.mediaFileId).toBe(100);
      expect(result.action).toBe("delete");
      expect(result.method).toBe("phash");
      expect(result.reviewGroupKey).toBe("phash:42");
    });

    test("rejects invalid id", () => {
      expect(UpdateFileDecision.safeParse({ id: 0 }).success).toBe(false);
      expect(UpdateFileDecision.safeParse({ id: -1 }).success).toBe(false);
    });

    test("rejects non-integer id", () => {
      expect(UpdateFileDecision.safeParse({ id: 1.5 }).success).toBe(false);
    });

    test("rejects invalid action when provided", () => {
      expect(UpdateFileDecision.safeParse({ id: 1, action: "invalid" }).success).toBe(false);
      expect(UpdateFileDecision.safeParse({ id: 1, action: "" }).success).toBe(false);
    });

    test("rejects invalid method when provided", () => {
      expect(UpdateFileDecision.safeParse({ id: 1, method: "invalid" }).success).toBe(false);
      expect(UpdateFileDecision.safeParse({ id: 1, method: "" }).success).toBe(false);
    });

    test("rejects empty reviewGroupKey when provided", () => {
      expect(UpdateFileDecision.safeParse({ id: 1, reviewGroupKey: "" }).success).toBe(false);
    });

    test("omits createdAt from updates", () => {
      const result = UpdateFileDecision.safeParse({
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
