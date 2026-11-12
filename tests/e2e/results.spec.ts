// Results/Duplicates view tests
// Run with: bun run test:e2e

// Guard: Prevent Bun from loading this file
if (typeof process !== "undefined" && (process.env.BUN_TEST || !process.env.PLAYWRIGHT_TEST)) {
  if (typeof process !== "undefined" && process.exit) {
    process.exit(0);
  }
  throw new Error("This file should only be run with Playwright: bun run test:e2e");
}

import { test, expect } from "@playwright/test";

test.describe("Results View", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.locator("nav a", { hasText: "Duplicates" }).click();
    await expect(page.getByRole("heading", { name: "Review Duplicates" })).toBeVisible();
  });

  test("displays all 4 category tabs", async ({ page }) => {
    await expect(page.locator("button", { hasText: "Exact Duplicates" })).toBeVisible();
    await expect(page.locator("button", { hasText: "Same Content" })).toBeVisible();
    await expect(page.locator("button", { hasText: "Perceptually Identical" })).toBeVisible();
    await expect(page.locator("button", { hasText: "Perceptually Similar" })).toBeVisible();
  });

  test("displays summary stats cards", async ({ page }) => {
    await expect(page.getByText("Pending Groups")).toBeVisible();
    await expect(page.getByText("Files to Keep")).toBeVisible();
    await expect(page.getByText("Files to Delete")).toBeVisible();
    await expect(page.getByText("Total Decisions")).toBeVisible();
  });

  test("Apply Deletions button is hidden when no deletions pending", async ({ page }) => {
    // Button only visible when deleteCount > 0
    await expect(page.locator("button", { hasText: /Apply Deletions/ })).not.toBeVisible();
  });

  test("category tabs can be clicked to switch", async ({ page }) => {
    // Click "Same Content" tab
    await page.locator("button", { hasText: "Same Content" }).click();
    await expect(page.locator("button", { hasText: "Same Content" })).toBeVisible();

    // Click "Perceptually Similar" tab
    await page.locator("button", { hasText: "Perceptually Similar" }).click();
    await expect(page.locator("button", { hasText: "Perceptually Similar" })).toBeVisible();
  });

  test("shows group review UI with mock data (no RPC)", async ({ page }) => {
    // Without RPC, the review service falls back to mock groups.
    // The subtitle should show a group index (e.g., "Group 1 of ...") or the default subtitle.
    const subtitle = page.locator("p", { hasText: /Group \d+ of \d+|Review and decide/ });
    await expect(subtitle).toBeVisible();
  });

  test("grid size buttons change active state", async ({ page }) => {
    const smallBtn = page.locator('button[title="Small"]');
    const largeBtn = page.locator('button[title="Large"]');

    await expect(smallBtn).toBeVisible();
    await expect(largeBtn).toBeVisible();

    // Click Large
    await largeBtn.click();
    await expect(largeBtn).toHaveClass(/bg-blue-600/);
    await expect(smallBtn).not.toHaveClass(/bg-blue-600/);

    // Click Small
    await smallBtn.click();
    await expect(smallBtn).toHaveClass(/bg-blue-600/);
    await expect(largeBtn).not.toHaveClass(/bg-blue-600/);
  });

  test("category tab switching changes active tab styling", async ({ page }) => {
    const exactTab = page.locator("button", { hasText: "Exact Duplicates" });
    const sameTab = page.locator("button", { hasText: "Same Content" });

    // Exact Duplicates is default active tab — should have colored bg
    await expect(exactTab).toHaveClass(/bg-blue-600/);

    // Switch to Same Content
    await sameTab.click();
    await expect(sameTab).toHaveClass(/bg-purple-600/);
    await expect(exactTab).not.toHaveClass(/bg-blue-600/);
  });

  test("group navigation buttons are present", async ({ page }) => {
    // These buttons should be visible in the review UI with mock data
    await expect(page.locator("button", { hasText: "Prev Group" })).toBeVisible();
    await expect(page.locator("button", { hasText: "Next Group" })).toBeVisible();
    await expect(page.locator("button", { hasText: "Save & Next" })).toBeVisible();
  });

  test("bulk action buttons are present", async ({ page }) => {
    await expect(page.locator("button", { hasText: "Keep All" })).toBeVisible();
    await expect(page.locator("button", { hasText: "Delete All" })).toBeVisible();
  });
});
