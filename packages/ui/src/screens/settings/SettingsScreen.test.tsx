import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { SettingsScreen } from "./SettingsScreen";

// No RPC is initialised in tests, so the settings service uses its localStorage fallback (as the E2E harness does).
const KEY = "giggle-photos-settings";

function stored(): Record<string, unknown> {
  return JSON.parse(localStorage.getItem(KEY) ?? "{}");
}

function saveButton(): HTMLButtonElement {
  return screen.getByRole("button", { name: /Save Changes|Saving|Saved!|Error - Retry|Loading/ }) as HTMLButtonElement;
}

async function renderLoaded(seed: Record<string, unknown> = {}) {
  localStorage.setItem(KEY, JSON.stringify(seed));
  render(<SettingsScreen />);
  await waitFor(() => expect(saveButton().textContent).toBe("Save Changes"));
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("SettingsScreen", () => {
  test("shows every section and the loaded values", async () => {
    await renderLoaded({
      logLevel: "debug",
      parallelWorkers: 8,
      clipThreads: 12,
      quarantinePath: "/q",
      similarityThreshold: 3,
    });
    for (const name of [
      "Settings",
      "Logging",
      "Processing",
      "Visual Similarity (CLIP)",
      "Removal",
      "Database",
      "About",
    ]) {
      expect(screen.getByRole("heading", { name })).toBeTruthy();
    }
    expect(screen.getByRole("button", { name: "Default Log Level" }).textContent).toBe("Debug");
    expect(screen.getByRole("button", { name: "Parallel Workers" }).textContent).toBe("8");
    expect((screen.getByLabelText("Model Threads") as HTMLInputElement).value).toBe("12");
    expect((screen.getByPlaceholderText("Default (app data/quarantine)") as HTMLInputElement).value).toBe("/q");
    expect((screen.getByRole("slider") as HTMLInputElement).value).toBe("3");
    expect(saveButton().disabled).toBe(true);
    await waitFor(() => expect(screen.getByText("dev preview")).toBeTruthy());
    expect(screen.getByText("Version")).toBeTruthy();
    expect(screen.getByText("License")).toBeTruthy();
    expect(screen.getByText("Reset Application", { selector: "p" })).toBeTruthy();
  });

  test("Save enables after a change and saves the draft without overwriting theme or log folder", async () => {
    await renderLoaded({ themeMode: "dark", useGlobalLogLevel: true, reviewGridSize: "lg" });
    const toggle = screen.getAllByRole("switch")[0] as HTMLElement;
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(saveButton().disabled).toBe(false);

    // The sidebar changes the theme and a log folder is chosen while the form is open.
    localStorage.setItem(KEY, JSON.stringify({ ...stored(), themeMode: "light", logPath: "/logs" }));

    await act(async () => fireEvent.click(saveButton()));
    await waitFor(() => expect(saveButton().textContent).toBe("Saved!"));
    const saved = stored();
    expect(saved.useGlobalLogLevel).toBe(false);
    expect(saved.themeMode).toBe("light");
    expect(saved.logPath).toBe("/logs");
    expect(saved.reviewGridSize).toBe("lg");
    expect(saved.clipEnabled).toBe(true);
    expect(saveButton().disabled).toBe(true);
  });

  test("dropdown opens, selects, and closes on Escape or outside press", async () => {
    await renderLoaded();
    const trigger = screen.getByRole("button", { name: "Default Log Level" });
    expect(trigger.textContent).toBe("Info");
    fireEvent.click(trigger);
    fireEvent.click(within(screen.getByRole("listbox")).getByText("Debug"));
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(trigger.textContent).toBe("Debug");
    expect(saveButton().disabled).toBe(false);

    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByRole("listbox"), { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();

    fireEvent.click(trigger);
    fireEvent.mouseDown(screen.getByTestId("dropdown-backdrop"));
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  test("CLIP thresholds keep strong ≤ review ≤ stored", async () => {
    await renderLoaded();
    // Collapsed: the hamming slider is the only range input (the E2E spec relies on it).
    expect(screen.getAllByRole("slider")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: /Thresholds/ }));
    const strong = screen.getByLabelText("Same Photo Distance") as HTMLInputElement;
    const review = screen.getByLabelText("Review Distance") as HTMLInputElement;
    const store = screen.getByLabelText("Storage Cutoff") as HTMLInputElement;
    expect([strong.value, review.value, store.value]).toEqual(["0.02", "0.06", "0.12"]);

    fireEvent.change(review, { target: { value: "0.01" } });
    expect([strong.value, review.value]).toEqual(["0.01", "0.01"]);

    fireEvent.change(strong, { target: { value: "0.2" } });
    expect([strong.value, review.value, store.value]).toEqual(["0.2", "0.2", "0.2"]);

    fireEvent.change(store, { target: { value: "0.1" } });
    expect([strong.value, review.value, store.value]).toEqual(["0.1", "0.1", "0.1"]);

    await act(async () => fireEvent.click(saveButton()));
    await waitFor(() => expect(stored().clipStoreMaxDistance).toBe(0.1));
    expect(stored().clipStrongMaxDistance).toBe(0.1);
    expect(stored().clipReviewMaxDistance).toBe(0.1);
  });

  test("CLIP provider, threads and top-K are saved", async () => {
    await renderLoaded();
    fireEvent.click(screen.getByRole("button", { name: "Execution Provider" }));
    fireEvent.click(within(screen.getByRole("listbox")).getByText("CUDA (NVIDIA)"));
    const threads = screen.getByLabelText("Model Threads") as HTMLInputElement;
    fireEvent.change(threads, { target: { value: "500" } });
    fireEvent.blur(threads);
    expect(threads.value).toBe("64");
    fireEvent.click(screen.getByRole("button", { name: /Thresholds/ }));
    fireEvent.change(screen.getByLabelText("Neighbours per Image"), { target: { value: "128" } });
    await act(async () => fireEvent.click(saveButton()));
    await waitFor(() => expect(stored().clipExecutionProvider).toBe("cuda"));
    expect(stored().clipThreads).toBe(64);
    expect(stored().clipTopK).toBe(128);
  });

  test("quarantine toggle and folder are saved (folder trimmed)", async () => {
    await renderLoaded();
    const quarantine = screen.getByRole("switch", { name: "Quarantine Removed Files" });
    expect(quarantine.getAttribute("aria-checked")).toBe("true");
    expect(screen.getByText(/Used only when quarantine is off/)).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText("Default (app data/quarantine)"), {
      target: { value: "  /data/quarantine  " },
    });
    fireEvent.click(quarantine);
    expect(quarantine.getAttribute("aria-checked")).toBe("false");
    await act(async () => fireEvent.click(saveButton()));
    await waitFor(() => expect(stored().quarantineEnabled).toBe(false));
    expect(stored().quarantinePath).toBe("/data/quarantine");
  });

  test("no trash command: toggle is off and disabled, help dialog explains", async () => {
    await renderLoaded({ moveToTrash: true });
    const trash = screen.getByRole("switch", { name: "Move Deleted Files to Trash" }) as HTMLButtonElement;
    expect(trash.getAttribute("aria-checked")).toBe("false");
    expect(trash.disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "How to enable trash" }));
    expect(screen.getByRole("heading", { name: "Enable Trash Support" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("heading", { name: "Enable Trash Support" })).toBeNull();
  });

  test("Reset Application asks for confirmation; Cancel closes", async () => {
    await renderLoaded();
    fireEvent.click(screen.getByRole("button", { name: "Reset Application" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/This will permanently delete/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("Reset Application shows the failure when the reset does not succeed", async () => {
    await renderLoaded();
    fireEvent.click(screen.getByRole("button", { name: "Reset Application" }));
    const dialog = screen.getByRole("dialog");
    await act(async () => fireEvent.click(within(dialog).getByRole("button", { name: "Reset Application" })));
    await waitFor(() => expect(within(dialog).getByText(/Failed to reset application/)).toBeTruthy());
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
