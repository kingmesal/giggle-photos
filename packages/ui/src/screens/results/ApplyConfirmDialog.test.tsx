import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ApplyDecisionResult } from "../../services/processing";
import { clearReviewService, initReviewService } from "../../services/processing";
import { resetReviewPrefs } from "./prefs";
import { ResultsScreen } from "./ResultsScreen";
import { resetReviewState } from "./review-store";
import { fakeRpc, plan, summary, twoGroups } from "./test-fixtures";

beforeEach(() => {
  resetReviewState();
  resetReviewPrefs();
});

afterEach(() => {
  cleanup();
  clearReviewService();
});

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/** Everything reviewed, two files marked delete: Apply Deletions is enabled. */
async function renderReady() {
  const data = twoGroups();
  data.groups = [];
  data.summary = summary({ pendingSha256: 0, decidedKeep: 3, decidedDelete: 2 });
  const rpc = fakeRpc(data);
  initReviewService(rpc);
  render(<ResultsScreen />);
  const apply = await screen.findByRole("button", { name: /Apply Deletions \(2\)/ });
  return { rpc, apply };
}

const confirmButton = (name: RegExp) => screen.getByRole("button", { name }) as HTMLButtonElement;

describe("Apply deletions dialog", () => {
  test("is blocked while groups are pending", async () => {
    const data = twoGroups();
    data.summary = summary({ decidedDelete: 1 });
    initReviewService(fakeRpc(data));
    render(<ResultsScreen />);
    const apply = (await screen.findByRole("button", { name: /Apply Deletions \(1\)/ })) as HTMLButtonElement;
    expect(apply.disabled).toBe(true);
    expect(apply.title).toBe("2 pending groups must be reviewed first");
  });

  test("runs a dry run first, shows the plan, and gates confirm until it has loaded", async () => {
    const { rpc, apply } = await renderReady();
    const dry = deferred<ApplyDecisionResult>();
    rpc.applyDeletions.mockImplementationOnce(() => dry.promise);
    fireEvent.click(apply);
    await screen.findByText("Preparing the deletion plan (dry run)…");
    expect(rpc.applyDeletions.mock.calls[0]?.[0]).toEqual({ dryRun: true, moveToTrash: false });
    // Without a plan the wording falls back to trash/delete; confirm is disabled.
    expect(confirmButton(/Delete Files/).disabled).toBe(true);

    await act(async () => dry.resolve(plan(2, "quarantine")));
    expect(screen.getByText("Move to quarantine?")).toBeTruthy();
    expect(
      screen.getByText("2 files will be moved to the quarantine folder (restorable, the Takeout layout is preserved)."),
    ).toBeTruthy();
    const confirm = confirmButton(/Move to Quarantine/);
    expect(confirm.disabled).toBe(false);

    fireEvent.click(confirm);
    await waitFor(() => expect(rpc.applyDeletions).toHaveBeenCalledTimes(2));
    expect(rpc.applyDeletions.mock.calls[1]?.[0]).toEqual({ moveToTrash: true });
    expect(screen.queryByText("Move to quarantine?")).toBeNull();
  });

  test("a plan that removes nothing keeps confirm disabled", async () => {
    const { rpc, apply } = await renderReady();
    rpc.applyDeletions.mockImplementationOnce(
      async () =>
        ({
          ...plan(0, "trash"),
          skipped: 2,
          plan: { remove: [], skipped: [{ reason: "last copy in album" }, { reason: "last copy in album" }] },
        }) as unknown as ApplyDecisionResult,
    );
    fireEvent.click(apply);
    await screen.findByText("Move to Trash?");
    expect(screen.getByText("2 files will NOT be removed:")).toBeTruthy();
    expect(screen.getByText("2 × last copy in album")).toBeTruthy();
    expect(confirmButton(/Move to Trash/).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByText("Move to Trash?")).toBeNull();
    expect(rpc.applyDeletions).toHaveBeenCalledTimes(1);
  });

  test("a failed dry run closes the dialog and shows the error", async () => {
    const { rpc, apply } = await renderReady();
    rpc.applyDeletions.mockImplementationOnce(async () => {
      throw new Error("plan failed");
    });
    fireEvent.click(apply);
    expect((await screen.findAllByText("plan failed")).length).toBeGreaterThan(0);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("conflicts are listed and resolved", async () => {
    const data = twoGroups();
    data.summary = summary({ conflictCount: 1 });
    const rpc = fakeRpc(data);
    rpc.getConflicts.mockImplementation(async () => ({
      conflicts: [
        {
          mediaFileId: 9,
          fileName: "dup.jpg",
          filePath: "/p/dup.jpg",
          decisions: [
            { reviewGroupKey: "g1", action: "keep" as const },
            { reviewGroupKey: "g2", action: "delete" as const },
          ],
        },
      ],
    }));
    initReviewService(rpc);
    render(<ResultsScreen />);
    fireEvent.click(await screen.findByRole("button", { name: /Resolve Conflicts \(1\)/ }));
    await screen.findByText("dup.jpg");
    data.summary = summary();
    fireEvent.click(screen.getByRole("button", { name: /Keep Everywhere/ }));
    await waitFor(() => expect(rpc.resolveConflict).toHaveBeenCalledWith({ mediaFileId: 9, action: "keep" }));
    await waitFor(() => expect(screen.queryByText("Resolve Conflicts")).toBeNull());
  });
});
