import { afterEach, describe, expect, mock, test } from "bun:test";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  type CaptureDateJob,
  type CaptureDateReport,
  clearCaptureDatesService,
  initCaptureDatesService,
} from "../../services/capture-dates-service";
import { CaptureDatesScreen } from "./CaptureDatesScreen";

afterEach(() => {
  cleanup();
  clearCaptureDatesService();
});

const REPORT: CaptureDateReport = {
  total: 2,
  bySource: { folder: 1, sidecar: 1 },
  byPrecision: { year: 1, exact: 1 },
  proposals: [
    {
      fileId: 1,
      path: "/t/Photos from 2018/b.jpg",
      fileType: "image",
      takenAt: "2018-07-01T12:00:00",
      precision: "year",
      source: "folder",
      detail: "Photos from 2018",
    },
    {
      fileId: 2,
      path: "/t/misc/c.jpg",
      fileType: "image",
      takenAt: "2015-08-09T10:11:12.000Z",
      precision: "exact",
      source: "sidecar",
      detail: "Google JSON",
    },
  ],
  undatable: 3,
  undatableSample: [],
  listLimit: 500,
};

function rpc() {
  let job: CaptureDateJob = { running: true, done: 1, total: 2, result: null, error: null };
  let report = REPORT;
  const api = {
    getCaptureDateReport: mock(async () => report),
    startCaptureDates: mock(async () => job),
    getCaptureDateJob: mock(async () => job),
  };
  initCaptureDatesService(api);
  return {
    api,
    finish: () => {
      job = { running: false, done: 2, total: 2, result: { written: 2, failed: 0, errors: [] }, error: null };
      report = { ...REPORT, total: 0, bySource: {}, byPrecision: {}, proposals: [] };
    },
  };
}

describe("CaptureDatesScreen", () => {
  test("lists each proposal with its source and precision, and the counts", async () => {
    rpc();
    render(<CaptureDatesScreen />);
    await waitFor(() => expect(screen.getByTestId("capture-date-table")).toBeTruthy());
    expect(screen.getByText("2018-07-01 12:00")).toBeTruthy();
    expect(screen.getByText("2015-08-09 10:11 UTC")).toBeTruthy();
    expect(screen.getByText("Folder: Photos from 2018")).toBeTruthy();
    expect(screen.getAllByText("year (July 1)").length).toBeGreaterThan(0);
    expect(screen.getByText("3")).toBeTruthy(); // undatable
    expect(screen.getByRole("button", { name: /Write Dates \(2\)/ })).toBeTruthy();
  });

  test("asks first, then writes in the background, shows progress, and reloads when done", async () => {
    const { api, finish } = rpc();
    render(<CaptureDatesScreen />);
    await waitFor(() => expect(screen.getByTestId("capture-date-table")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /Write Dates \(2\)/ }));
    expect(screen.getByText(/No backup copy is kept/)).toBeTruthy();
    expect(api.startCaptureDates).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Write Dates" }));
    await waitFor(() => expect(screen.getByText("Writing dates: 1 of 2 (50%)")).toBeTruthy());
    finish();
    await act(() => new Promise((r) => setTimeout(r, 1100)));
    await waitFor(() => expect(screen.getByText("Wrote 2 dates.")).toBeTruthy());
    await waitFor(() => expect(screen.getByText(/already has a date/)).toBeTruthy());
    expect(api.getCaptureDateReport).toHaveBeenCalledTimes(2);
  });

  test("without RPC: nothing to date, the button is disabled", async () => {
    render(<CaptureDatesScreen />);
    await waitFor(() => expect(screen.getByText(/already has a date/)).toBeTruthy());
    expect((screen.getByRole("button", { name: /Write Dates \(0\)/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});
