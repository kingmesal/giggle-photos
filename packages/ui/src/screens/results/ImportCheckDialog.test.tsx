import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { clearTakeoutService, initTakeoutService } from "../../services/takeout-service";
import { ImportCheckDialog } from "./ImportCheckDialog";
import { getReview, patchReview, resetReviewState } from "./review-store";

beforeEach(() => {
  resetReviewState();
  patchReview({ dialog: "importCheck" });
});
afterEach(() => {
  cleanup();
  clearTakeoutService();
});

function rpc(events: Record<string, number> = { "discovered image": 10 }) {
  const compareImmichGoReport = mock(async (_report: string) => ({
    events,
    rows: [
      { label: "Photos", app: 10, immichGo: 10, status: "match" as const, note: "n1" },
      { label: "Videos", app: 2, immichGo: 3, status: "differs" as const, note: "n2" },
      { label: "Albums with files", app: 4, immichGo: null, status: "info" as const, note: "n3" },
    ],
  }));
  initTakeoutService({ getTakeoutReport: mock(async () => ({}) as never), compareImmichGoReport });
  return compareImmichGoReport;
}

describe("ImportCheckDialog", () => {
  test("sends the pasted report and shows the comparison", async () => {
    const compare = rpc();
    render(<ImportCheckDialog />);
    fireEvent.change(screen.getByLabelText("immich-go report"), { target: { value: "  discovered image : 10" } });
    fireEvent.click(screen.getByRole("button", { name: "Compare" }));
    await waitFor(() => expect(screen.getByTestId("import-check-table")).toBeTruthy());
    expect(compare.mock.calls[0]?.[0]).toBe("  discovered image : 10");
    const videos = screen.getByText("Videos").closest("tr") as HTMLElement;
    expect(within(videos).getByLabelText("differs")).toBeTruthy();
    expect(within(screen.getByText("Albums with files").closest("tr") as HTMLElement).getByText("—")).toBeTruthy();
  });

  test("warns when nothing in the pasted text was recognised", async () => {
    rpc({});
    render(<ImportCheckDialog />);
    fireEvent.change(screen.getByLabelText("immich-go report"), { target: { value: "hello" } });
    fireEvent.click(screen.getByRole("button", { name: "Compare" }));
    await waitFor(() => expect(screen.getByText(/No immich-go events found/)).toBeTruthy());
  });

  test("without RPC the failure is shown; Close closes", async () => {
    render(<ImportCheckDialog />);
    fireEvent.click(screen.getByRole("button", { name: "Compare" }));
    await waitFor(() => expect(screen.getByText(/only available in the desktop app/)).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(getReview().dialog).toBe("none");
  });
});
