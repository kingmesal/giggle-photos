import { describe, expect, test } from "bun:test";
import { errorCategoryLabel } from "./error-labels";

describe("errorCategoryLabel", () => {
  test("labels known categories", () => {
    expect(errorCategoryLabel("corrupt_or_truncated")).toBe("Corrupt or truncated");
    expect(errorCategoryLabel("empty_file")).toBe("Empty file");
  });

  test("shows the format for per-format unsupported counts", () => {
    expect(errorCategoryLabel("unsupported_format:heic")).toBe("Unsupported format (HEIC)");
  });

  test("falls back to spaced text for unknown keys", () => {
    expect(errorCategoryLabel("disk_full")).toBe("disk full");
  });
});
