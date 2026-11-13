import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { StrictMode } from "react";
import { clearReviewService, initReviewService } from "../../services/processing";
import { notifyReviewDataChanged } from "../../state/review-events";
import { resetReviewPrefs } from "./prefs";
import { ResultsScreen } from "./ResultsScreen";
import { resetReviewState } from "./review-store";
import { fakeRpc, file, twoGroups } from "./test-fixtures";

beforeEach(() => {
  resetReviewState();
  resetReviewPrefs();
});

afterEach(() => {
  cleanup();
  clearReviewService();
});

const button = (name: string | RegExp) => screen.getByRole("button", { name });
const cards = () => screen.getAllByTestId("image-card");

async function renderWith(data = twoGroups()) {
  const rpc = fakeRpc(data);
  initReviewService(rpc);
  render(<ResultsScreen />);
  await waitFor(() => expect(screen.getByText("Group 1 of 2")).toBeTruthy());
  await waitFor(() => expect(cards().length).toBeGreaterThan(0));
  return { rpc, data };
}

describe("ResultsScreen", () => {
  test("keeps the heading, tabs, stats and grid sizes; Apply is hidden with nothing to delete", async () => {
    await renderWith();
    expect(screen.getByRole("heading", { name: "Review Duplicates" })).toBeTruthy();
    for (const tab of ["Exact Duplicates", "Same Content", "Perceptually Identical", "Perceptually Similar"]) {
      expect(button(new RegExp(tab))).toBeTruthy();
    }
    for (const stat of ["Pending Groups", "Files to Keep", "Files to Delete", "Total Decisions"]) {
      expect(screen.getByText(stat)).toBeTruthy();
    }
    expect(button(/Exact Duplicates/).className).toContain("bg-blue-600");
    expect(screen.queryByRole("button", { name: /Apply Deletions/ })).toBeNull();
    fireEvent.click(screen.getByTitle("Large"));
    expect(screen.getByTitle("Large").className).toContain("bg-blue-600");
    expect(screen.getByTitle("Small").className).not.toContain("bg-blue-600");
  });

  test("pre-fills keep for every suggested keepFileId and delete for the rest", async () => {
    await renderWith();
    expect(cards()).toHaveLength(3);
    expect(screen.getByText("2 keep, 1 delete")).toBeTruthy();
    expect(screen.getAllByText("Suggested Keep")).toHaveLength(1);
  });

  test("no suggestion (fileId 0) leaves files undecided and Save & Next disabled", async () => {
    const data = twoGroups();
    const g1 = data.files.g1;
    if (g1) g1.suggestion = { fileId: 0, keepFileIds: [], reason: "clip" };
    await renderWith(data);
    expect(screen.getByText("No decisions yet")).toBeTruthy();
    expect(screen.getByText("Set an action for each file.")).toBeTruthy();
    expect((button(/Save & Next/) as HTMLButtonElement).disabled).toBe(true);
  });

  test("toggling a file and Save & Next submits the decisions and advances", async () => {
    const { rpc } = await renderWith();
    const third = cards()[2] as HTMLElement;
    fireEvent.click(within(third).getByRole("button", { name: "Keep" }));
    expect(screen.getByText("3 keep")).toBeTruthy();
    fireEvent.click(button(/Save & Next/));
    await waitFor(() => expect(rpc.submitReviewDecisions).toHaveBeenCalledTimes(1));
    expect(rpc.submitReviewDecisions.mock.calls[0]?.[0]).toEqual({
      decisions: [
        { mediaFileId: 1, action: "keep" },
        { mediaFileId: 2, action: "keep" },
        { mediaFileId: 3, action: "keep" },
      ],
      method: "sha256",
      reviewGroupKey: "g1",
    });
    await waitFor(() => expect(rpc.getPendingGroups).toHaveBeenCalledTimes(2));
  });

  test("saving with nothing kept asks first, then submits", async () => {
    const { rpc } = await renderWith();
    fireEvent.click(button("Delete All"));
    expect(screen.getByText("3 delete")).toBeTruthy();
    fireEvent.click(button(/Save & Next/));
    expect(screen.getByText("Delete All Files?")).toBeTruthy();
    expect(rpc.submitReviewDecisions).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete All" }));
    await waitFor(() => expect(rpc.submitReviewDecisions).toHaveBeenCalledTimes(1));
  });

  test("Next Group skips, Prev Group returns with the edited decisions", async () => {
    const { rpc } = await renderWith();
    fireEvent.click(button("Keep All"));
    fireEvent.click(button(/Next Group/));
    await waitFor(() => expect(screen.getByText("1 keep, 1 delete")).toBeTruthy());
    expect(rpc.getLogicalGroupFiles.mock.calls.at(-1)?.[0]).toEqual({ method: "sha256", groupKey: "g2" });
    fireEvent.click(button(/Prev Group/));
    await waitFor(() => expect(screen.getByText("3 keep")).toBeTruthy());
  });

  test("switching tabs with unsaved edits asks before discarding", async () => {
    const { rpc } = await renderWith();
    fireEvent.click(button("Keep All"));
    fireEvent.click(button(/Same Content/));
    expect(screen.getByText("Unsaved Changes")).toBeTruthy();
    fireEvent.click(button("Stay Here"));
    expect(screen.getByText("3 keep")).toBeTruthy();
    fireEvent.click(button(/Same Content/));
    fireEvent.click(button(/Discard & Switch/));
    await waitFor(() => expect(rpc.getPendingGroups.mock.calls.at(-1)?.[0]).toMatchObject({ method: "content_hash" }));
    await waitFor(() => expect(button(/Same Content/).className).toContain("bg-purple-600"));
  });

  test("a review-data version change drops the cache and reloads", async () => {
    const { rpc, data } = await renderWith();
    fireEvent.click(button(/Next Group/));
    await waitFor(() => expect(screen.getByText("1 keep, 1 delete")).toBeTruthy());
    data.groups = [data.groups[0] as (typeof data.groups)[number]];
    act(() => notifyReviewDataChanged());
    await waitFor(() => expect(screen.getByText("Group 1 of 1")).toBeTruthy());
    expect(rpc.getPendingGroups).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(screen.getByText("2 keep, 1 delete")).toBeTruthy());
    expect((button(/Prev Group/) as HTMLButtonElement).disabled).toBe(true);
  });

  test("clicking a thumbnail opens the comparison; Escape closes it", async () => {
    await renderWith();
    const img = within(cards()[2] as HTMLElement).getByAltText("img3.jpg");
    fireEvent.click(img);
    expect(screen.getByText("Compare Images")).toBeTruthy();
    expect(screen.getByText("Metadata Comparison")).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByText("Compare Images")).toBeNull();
  });

  test("without RPC the mock group review is shown (StrictMode)", async () => {
    render(
      <StrictMode>
        <ResultsScreen />
      </StrictMode>,
    );
    await waitFor(() => expect(screen.getByText(/Group 1 of 1/)).toBeTruthy());
    expect(button(/Prev Group/)).toBeTruthy();
    expect(button(/Next Group/)).toBeTruthy();
    expect(button(/Save & Next/)).toBeTruthy();
    expect(button("Keep All")).toBeTruthy();
    expect(button("Delete All")).toBeTruthy();
  });

  test("an existing stored decision wins over the suggestion", async () => {
    const data = twoGroups();
    const stored = { action: "delete" } as unknown as NonNullable<ReturnType<typeof file>["decision"]>;
    data.files.g1 = {
      files: [file(1, { decision: stored }), file(2), file(3)],
      suggestion: { fileId: 1, keepFileIds: [1], reason: "x" },
    };
    await renderWith(data);
    expect(screen.getByText("1 delete")).toBeTruthy();
  });
});
