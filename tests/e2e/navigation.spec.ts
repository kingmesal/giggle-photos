// Navigation smoke test — verifies all 4 views load via sidebar navigation
// Run with: bun run test:e2e

// Guard: Prevent Bun from loading this file
if (typeof process !== "undefined" && (process.env.BUN_TEST || !process.env.PLAYWRIGHT_TEST)) {
  if (typeof process !== "undefined" && process.exit) {
    process.exit(0);
  }
  throw new Error("This file should only be run with Playwright: bun run test:e2e");
}

import { test, expect } from "@playwright/test";

test.describe("Navigation", () => {
  test("clicking sidebar nav items switches between all 4 views", async ({ page }) => {
    await page.goto("/");

    // Verify page title
    await expect(page).toHaveTitle(/Giggle Photos/i);

    // Default view should be Folders
    const foldersHeading = page.getByRole("heading", { name: "Source Folders" });
    await expect(foldersHeading).toBeVisible();
    await expect(page.getByText("No folders added yet")).toBeVisible();

    // Verify Folders nav link is active
    const foldersLink = page.locator("nav a", { hasText: "Folders" });
    await expect(foldersLink).toHaveClass(/bg-blue-600/);

    // Click Processing
    const processingLink = page.locator("nav a", { hasText: "Processing" });
    await processingLink.click();
    await expect(page.getByRole("heading", { name: "Processing Pipeline" })).toBeVisible();
    await expect(processingLink).toHaveClass(/bg-blue-600/);
    // Folders link should no longer be active
    await expect(foldersLink).not.toHaveClass(/bg-blue-600/);

    // Click Duplicates
    const duplicatesLink = page.locator("nav a", { hasText: "Duplicates" });
    await duplicatesLink.click();
    await expect(page.getByRole("heading", { name: "Review Duplicates" })).toBeVisible();
    await expect(duplicatesLink).toHaveClass(/bg-blue-600/);

    // Click Settings (button in sidebar footer, not a nav link)
    const settingsButton = page.locator("aside button", { hasText: "Settings" });
    await settingsButton.click();
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();

    // Click Folders again to complete round-trip
    await foldersLink.click();
    await expect(foldersHeading).toBeVisible();
    await expect(foldersLink).toHaveClass(/bg-blue-600/);
  });
});
