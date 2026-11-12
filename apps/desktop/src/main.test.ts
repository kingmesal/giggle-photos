import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { initUI, shutdownUI } from "@giggle-photos/ui";

describe("Desktop App", () => {
  beforeEach(() => {
    // Reset state before each test
  });

  afterEach(async () => {
    // Cleanup after each test
    try {
      await shutdownUI();
    } catch {
      // Ignore errors during cleanup
    }
  });

  test("UI can be initialized", () => {
    expect(() => {
      initUI();
    }).not.toThrow();
  });

  test("UI can be shut down", async () => {
    initUI();
    await expect(shutdownUI()).resolves.toBeUndefined();
  });

  test("UI can be initialized and shut down multiple times", async () => {
    initUI();
    await shutdownUI();

    initUI();
    await shutdownUI();

    initUI();
    await expect(shutdownUI()).resolves.toBeUndefined();
  });
});
