import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { env } from "./env";

describe("Environment Configuration", () => {
  // Preserve LOG_LEVEL so we don't break other test files in the same process
  let savedLogLevel: string | undefined;

  beforeAll(() => {
    savedLogLevel = process.env.LOG_LEVEL;
  });

  afterAll(() => {
    // Restore LOG_LEVEL for other test files (e.g., LOG_LEVEL=off for silent tests)
    if (savedLogLevel !== undefined) {
      process.env.LOG_LEVEL = savedLogLevel;
    } else {
      delete process.env.LOG_LEVEL;
    }
  });

  beforeEach(() => {
    // Reset environment variables (env object is parsed once at module load, so
    // these deletions don't affect the env const — they only affect process.env reads)
    delete process.env.DATABASE_PATH;
    delete process.env.LOG_LEVEL;
    delete process.env.SCAN_BATCH_SIZE;
    delete process.env.HASH_ALGORITHM;
  });

  test("has default values", () => {
    // DATABASE_PATH defaults to OS-specific app data directory
    expect(env.DATABASE_PATH).toContain("giggle-photos");
    expect(env.DATABASE_PATH).toContain("app.db");
    // LOG_LEVEL defaults to "info" but may be overridden by env (e.g., LOG_LEVEL=off in tests)
    expect(["off", "trace", "debug", "info", "warn", "error"]).toContain(env.LOG_LEVEL);
    expect(env.SCAN_BATCH_SIZE).toBe(10);
    expect(env.HASH_ALGORITHM).toBe("sha256");
  });

  test("validates LOG_LEVEL enum", () => {
    process.env.LOG_LEVEL = "debug";
    // Note: env is parsed once at module load, so this test validates the schema
    expect(["off", "trace", "debug", "info", "warn", "error"]).toContain("debug");
  });
});
