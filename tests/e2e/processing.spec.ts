// Processing view empty-state tests
// Run with: bun run test:e2e

// Guard: Prevent Bun from loading this file
if (typeof process !== "undefined" && (process.env.BUN_TEST || !process.env.PLAYWRIGHT_TEST)) {
  if (typeof process !== "undefined" && process.exit) {
    process.exit(0);
  }
  throw new Error("This file should only be run with Playwright: bun run test:e2e");
}

import { test, expect } from "@playwright/test";

test.describe("Processing View", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.locator("nav a", { hasText: "Processing" }).click();
    await expect(page.getByRole("heading", { name: "Processing Pipeline" })).toBeVisible();
  });

  test("shows subtitle describing the pipeline", async ({ page }) => {
    await expect(page.getByText("Step-by-step progress through deduplication stages")).toBeVisible();
  });

  test("displays no-folders empty state with Add Folders button", async ({ page }) => {
    // Without RPC, no folders exist — should show the empty state
    await expect(page.getByRole("heading", { name: "No Folders Configured" })).toBeVisible();
    await expect(page.getByText("Add folders to scan for images")).toBeVisible();

    const addFoldersButton = page.locator("button", { hasText: "Add Folders" });
    await expect(addFoldersButton).toBeVisible();
  });

  test("Add Folders button navigates to Folders view", async ({ page }) => {
    const addFoldersButton = page.locator("button", { hasText: "Add Folders" });
    await addFoldersButton.click();
    await expect(page.getByRole("heading", { name: "Source Folders" })).toBeVisible();
  });

  test("no Start Processing button when no folders configured", async ({ page }) => {
    // With the "No Folders Configured" empty state, the start button should not appear
    await expect(page.locator("button", { hasText: "Start Processing" })).not.toBeVisible();
  });

  test("navigating back from Folders preserves Processing view", async ({ page }) => {
    // Go to Folders via the "Add Folders" button
    await page.locator("button", { hasText: "Add Folders" }).click();
    await expect(page.getByRole("heading", { name: "Source Folders" })).toBeVisible();

    // Navigate back to Processing
    await page.locator("nav a", { hasText: "Processing" }).click();
    await expect(page.getByRole("heading", { name: "Processing Pipeline" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "No Folders Configured" })).toBeVisible();
  });
});
