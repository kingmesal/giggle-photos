import { describe, expect, test } from "bun:test";
import { initUI, shutdownUI } from "./main";

describe("UI Main", () => {
  test("initUI initializes without error", () => {
    expect(() => {
      initUI();
    }).not.toThrow();
  });

  test("shutdownUI resolves successfully", async () => {
    initUI();
    await expect(shutdownUI()).resolves.toBeUndefined();
  });

  test("can initialize and shutdown in sequence", async () => {
    initUI();
    await expect(shutdownUI()).resolves.toBeUndefined();
  });
});
