import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { SettingsScreen } from "./SettingsScreen";

// No RPC: the settings service uses its localStorage fallback.
const KEY = "giggle-photos-settings";
beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  localStorage.clear();
});

const ruleOrder = () =>
  within(screen.getByRole("list", { name: "Preselection rule order" }))
    .getAllByRole("listitem")
    .map((li) => li.getAttribute("data-testid"));

describe("Preselection rule order", () => {
  test("album first by default; moving owner device up saves the new order", async () => {
    localStorage.setItem(KEY, "{}");
    render(<SettingsScreen />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Save Changes" })).toBeTruthy());
    expect(ruleOrder()).toEqual(["preselect-rule-album", "preselect-rule-owner_device"]);
    expect((screen.getByRole("button", { name: "Move Album copies up" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Move Owner's device up" }));
    expect(ruleOrder()).toEqual(["preselect-rule-owner_device", "preselect-rule-album"]);
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem(KEY) ?? "{}").preselectRuleOrder).toEqual(["owner_device", "album"]),
    );
  });
});
