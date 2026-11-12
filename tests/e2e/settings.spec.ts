// Settings view tests
// Run with: bun run test:e2e

// Guard: Prevent Bun from loading this file
if (typeof process !== "undefined" && (process.env.BUN_TEST || !process.env.PLAYWRIGHT_TEST)) {
  if (typeof process !== "undefined" && process.exit) {
    process.exit(0);
  }
  throw new Error("This file should only be run with Playwright: bun run test:e2e");
}

import { test, expect } from "@playwright/test";

test.describe("Settings View", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.locator("aside button", { hasText: "Settings" }).click();
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  });

  test("displays all section headings", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "Logging" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Processing" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Database" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "About" })).toBeVisible();
  });

  test("shows logging toggle controls", async ({ page }) => {
    await expect(page.getByText("Use Global Level for All")).toBeVisible();
    await expect(page.getByText("Log to File")).toBeVisible();
  });

  test("shows processing controls", async ({ page }) => {
    await expect(page.getByText("Similarity Threshold")).toBeVisible();
    await expect(page.getByText("Parallel Workers")).toBeVisible();
  });

  test("shows similarity threshold slider", async ({ page }) => {
    // The range input should exist
    const slider = page.locator("input[type='range']");
    await expect(slider).toBeVisible();
  });

  test("shows Save Changes button", async ({ page }) => {
    const saveButton = page.locator("button", { hasText: "Save Changes" });
    await expect(saveButton).toBeVisible();
  });

  test("shows database section with location and size", async ({ page }) => {
    await expect(page.getByText("Database Location")).toBeVisible();
    await expect(page.getByText("Database Size")).toBeVisible();
  });

  test("shows about section with version info", async ({ page }) => {
    await expect(page.getByText("Version", { exact: true })).toBeVisible();
    await expect(page.getByText("License")).toBeVisible();
  });

  test("shows Reset Application button", async ({ page }) => {
    const resetButton = page.locator("button", { hasText: "Reset Application" });
    await expect(resetButton).toBeVisible();
  });

  test("toggle switches can be clicked and change state", async ({ page }) => {
    // Find the first toggle switch (Use Global Level for All)
    const toggle = page.locator('button[role="switch"]').first();
    await expect(toggle).toBeVisible();

    const initialState = await toggle.getAttribute("aria-checked");
    await toggle.click();
    const newState = await toggle.getAttribute("aria-checked");

    // State should have toggled
    expect(newState).not.toBe(initialState);
  });

  test("dropdown opens and allows selection", async ({ page }) => {
    // Find the Default Log Level dropdown trigger by its label context
    const logLevelSection = page.locator("div", { hasText: "Default Log Level" });
    const dropdown = logLevelSection.locator("button").filter({ hasText: "Info" });
    await dropdown.click();

    // The dropdown menu is portaled to body with z-[9999]
    const menu = page.locator("div.fixed").filter({ has: page.locator("div.cursor-pointer") });
    await expect(menu).toBeVisible();

    // Select "Debug" option
    await menu.locator("div", { hasText: "Debug" }).click();

    // Menu should close and new value should appear in the section
    await expect(menu).not.toBeVisible();
    const updatedDropdown = logLevelSection.locator("button").filter({ hasText: "Debug" });
    await expect(updatedDropdown).toBeVisible();
  });

  test("Save Changes button enables after making a change", async ({ page }) => {
    const saveButton = page.locator("button", { hasText: "Save Changes" });

    // Toggle a setting to dirty the form
    const toggle = page.locator('button[role="switch"]').first();
    await toggle.click();

    // Save button should now be enabled (not have opacity-50/cursor-not-allowed)
    await expect(saveButton).toBeEnabled();
  });

  test("theme toggle in sidebar switches between light and dark", async ({ page }) => {
    // Navigate away from settings to see sidebar clearly, then come back
    // The theme toggle is in the sidebar footer
    const themeToggle = page.locator('button[title*="Switch to"]');
    await expect(themeToggle).toBeVisible();

    // Check initial state (dark mode by default)
    const htmlEl = page.locator("html");
    await expect(htmlEl).toHaveClass(/dark/);

    // Click to switch to light mode
    await themeToggle.click();
    await expect(htmlEl).not.toHaveClass(/dark/);

    // Click to switch back to dark mode
    await themeToggle.click();
    await expect(htmlEl).toHaveClass(/dark/);
  });
});
