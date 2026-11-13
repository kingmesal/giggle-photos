import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { activePreset } from "./clip-presets";
import { SettingsScreen } from "./SettingsScreen";

const KEY = "giggle-photos-settings"; // no RPC: the settings service uses localStorage
beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("activePreset", () => {
  test("recognises each preset exactly, anything else is custom", () => {
    expect(
      activePreset({ clipStrongMaxDistance: 0.02, clipReviewMaxDistance: 0.06, clipSimilarShotsEnabled: false }),
    ).toBe("giggle");
    expect(
      activePreset({ clipStrongMaxDistance: 0.01, clipReviewMaxDistance: 0.01, clipSimilarShotsEnabled: false }),
    ).toBe("immich");
    expect(
      activePreset({ clipStrongMaxDistance: 0.02, clipReviewMaxDistance: 0.06, clipSimilarShotsEnabled: true }),
    ).toBeNull();
    expect(
      activePreset({ clipStrongMaxDistance: 0.015, clipReviewMaxDistance: 0.06, clipSimilarShotsEnabled: false }),
    ).toBeNull();
  });
});

describe("CLIP presets in Settings", () => {
  const presets = () => within(screen.getByRole("group", { name: "CLIP presets" }));
  test("Giggle defaults is active at first; Immich defaults sets 0.01 and saves", async () => {
    localStorage.setItem(KEY, "{}");
    render(<SettingsScreen />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Save Changes" })).toBeTruthy());
    expect(
      presets()
        .getByRole("button", { name: /Giggle defaults/ })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    fireEvent.click(presets().getByRole("button", { name: /Immich defaults/ }));
    expect(
      presets()
        .getByRole("button", { name: /Immich defaults/ })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(screen.getByText(/same ≤ 0\.010 · review ≤ 0\.010/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem(KEY) ?? "{}")).toMatchObject({
        clipStrongMaxDistance: 0.01,
        clipReviewMaxDistance: 0.01,
        clipSimilarShotsEnabled: false,
        clipStoreMaxDistance: 0.12,
      }),
    );
  });

  test("custom thresholds highlight neither preset; Giggle defaults puts them back", async () => {
    localStorage.setItem(KEY, JSON.stringify({ clipStrongMaxDistance: 0.03, clipReviewMaxDistance: 0.08 }));
    render(<SettingsScreen />);
    await waitFor(() => expect(screen.getByText("Custom thresholds")).toBeTruthy());
    fireEvent.click(presets().getByRole("button", { name: /Giggle defaults/ }));
    expect(screen.queryByText("Custom thresholds")).toBeNull();
    expect(screen.getByText(/same ≤ 0\.020 · review ≤ 0\.060/)).toBeTruthy();
  });
});
