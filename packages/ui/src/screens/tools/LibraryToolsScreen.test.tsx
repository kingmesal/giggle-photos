import { afterEach, describe, expect, mock, test } from "bun:test";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import {
  clearLibraryToolsService,
  initLibraryToolsService,
  type LibraryToolJob,
  type LibraryToolsPreview,
} from "../../services/library-tools-service";
import { LibraryToolsScreen } from "./LibraryToolsScreen";

afterEach(() => {
  cleanup();
  clearLibraryToolsService();
});

const PREVIEW: LibraryToolsPreview = {
  xmpFromFiles: {
    files: 10,
    embeddedDate: 7,
    filenameDate: 1,
    folderDate: 1,
    noDate: 1,
    withGps: 4,
    listLimit: 500,
    guessed: [
      {
        fileId: 1,
        path: "/l/2017-06 Trip/b.jpg",
        fileType: "image",
        takenAt: "2017-06-15T12:00:00",
        precision: "month",
        source: "folder",
        detail: "2017-06 Trip",
      },
      {
        fileId: 2,
        path: "/l/x/IMG_20190512_143000.jpg",
        fileType: "image",
        takenAt: "2019-05-12T14:30:00",
        precision: "second",
        source: "filename",
        detail: "20190512_143000",
      },
    ],
  },
  jsonToXmp: { files: 5, inherited: 1, withDate: 5, withGps: 2, withDescription: 1, withPeople: 2, favorites: 1 },
  removeJson: { converted: 3, notConverted: 2, albumAndOther: 4, mode: "quarantine" },
};

function rpc() {
  let job: LibraryToolJob = { tool: "json_to_xmp", running: true, done: 2, total: 5, result: null, error: null };
  const api = {
    getLibraryToolsPreview: mock(async () => PREVIEW),
    startLibraryTool: mock(async (tool: LibraryToolJob["tool"], _o?: unknown) => ({ ...job, tool })),
    getLibraryToolJob: mock(async () => job),
  };
  initLibraryToolsService(api as never);
  return {
    api,
    finish: (result: LibraryToolJob["result"]) => {
      job = { ...job, running: false, result };
    },
  };
}
const card = (name: string) => screen.getByRole("region", { name });

describe("LibraryToolsScreen", () => {
  test("three tools with their counts; guessed dates on request", async () => {
    rpc();
    render(<LibraryToolsScreen />);
    await waitFor(() => expect(card("Write XMP from file metadata")).toBeTruthy());
    expect(within(card("Write XMP from file metadata")).getByText("Date from folder")).toBeTruthy();
    expect(within(card("Convert Google JSON to XMP")).getByText("Favourites")).toBeTruthy();
    fireEvent.click(screen.getByText("Show the 2 guessed dates"));
    expect(within(screen.getByTestId("guessed-dates")).getByText("2017-06-15 12:00")).toBeTruthy();
    expect(screen.getByText("folder · month (15th)")).toBeTruthy();
  });

  test("a tool runs in the background with progress, then shows its result and refreshes", async () => {
    const { api, finish } = rpc();
    render(<LibraryToolsScreen />);
    await waitFor(() => expect(card("Convert Google JSON to XMP")).toBeTruthy());
    fireEvent.click(within(card("Convert Google JSON to XMP")).getByRole("button", { name: /Convert to XMP/ }));
    await waitFor(() => expect(screen.getByText("Convert Google JSON to XMP: 2 of 5 (40%)")).toBeTruthy());
    expect(api.startLibraryTool.mock.calls[0]?.[0]).toBe("json_to_xmp");
    expect(
      (
        within(card("Write XMP from file metadata")).getByRole("button", {
          name: /Write Sidecars/,
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    finish({
      written: 4,
      unchanged: 0,
      skipped: 1,
      failed: 0,
      errors: [{ path: "/l/a.jpg.xmp", error: "An XMP sidecar from another app is already there" }],
    });
    await act(() => new Promise((r) => setTimeout(r, 1100)));
    await waitFor(() =>
      expect(
        screen.getByText(
          "Convert Google JSON to XMP: 4 written, 0 already up to date, 1 skipped (another app's sidecar).",
        ),
      ).toBeTruthy(),
    );
    expect(api.getLibraryToolsPreview).toHaveBeenCalledTimes(2);
  });

  test("removing JSON: converted only by default, options add more, and it asks first", async () => {
    const { api } = rpc();
    render(<LibraryToolsScreen />);
    await waitFor(() => expect(card("Remove Google JSON files")).toBeTruthy());
    const c = card("Remove Google JSON files");
    expect(within(c).getByRole("button", { name: "Remove 3 JSON Files" })).toBeTruthy();
    fireEvent.click(within(c).getByLabelText(/Also album/));
    fireEvent.click(within(c).getByRole("button", { name: "Remove 7 JSON Files" }));
    expect(screen.getByText(/Only remove them after you have imported/)).toBeTruthy();
    expect(screen.getByText(/can be restored from Settings/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Remove JSON Files" }));
    await waitFor(() => expect(api.startLibraryTool).toHaveBeenCalledTimes(1));
    expect(api.startLibraryTool.mock.calls[0]).toEqual(["remove_json", { includeAlbumAndOther: true }]);
  });
});
