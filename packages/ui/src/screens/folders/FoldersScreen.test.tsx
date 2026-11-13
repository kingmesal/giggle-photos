import { afterEach, describe, expect, mock, test } from "bun:test";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { type FoldersRPC, initFoldersService, type ScanFolder } from "../../services/folders-service";
import { getReviewDataVersion } from "../../state/review-events";
import { FoldersScreen } from "./FoldersScreen";

function folder(id: number, path: string, extra: Partial<ScanFolder> = {}): ScanFolder {
  return {
    id,
    path,
    priority: 3,
    status: "ready",
    scanSubdirectories: true,
    includeVideos: true,
    imageCount: 10,
    videoCount: 2,
    totalSize: 2048,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...extra,
  };
}

/** In-memory backend behind the FoldersRPC interface. */
function fakeRpc(initial: ScanFolder[], pickerPath: string | null = null) {
  let folders = [...initial];
  let nextId = 100;
  const rpc = {
    listFolders: mock(async () => folders.map((f) => ({ ...f }))),
    getFolderStats: mock(async () => ({
      folderCount: folders.length,
      totalImages: folders.reduce((n, f) => n + f.imageCount, 0),
      totalVideos: folders.reduce((n, f) => n + f.videoCount, 0),
      totalSize: folders.reduce((n, f) => n + f.totalSize, 0),
    })),
    addFolder: mock(async ({ path }: { path: string }) => {
      const added = folder(nextId++, path, { status: "added", imageCount: 0, videoCount: 0, totalSize: 0 });
      folders.push(added);
      return { success: true, folder: added };
    }),
    updateFolder: mock(async (update: Parameters<FoldersRPC["updateFolder"]>[0]) => {
      folders = folders.map((f) => (f.id === update.id ? { ...f, ...update } : f));
      return { success: true, folder: folders.find((f) => f.id === update.id) as ScanFolder };
    }),
    removeFolder: mock(async ({ id }: { id: number }) => {
      folders = folders.filter((f) => f.id !== id);
      return { success: true };
    }),
    showFolderPicker: mock(async () => ({ success: pickerPath !== null, path: pickerPath })),
    scanFolderQuick: mock(async ({ id }: { id: number }) => {
      folders = folders.map((f) => (f.id === id ? { ...f, status: "ready" as const, imageCount: 5 } : f));
      return { success: true, folder: folders.find((f) => f.id === id) as ScanFolder };
    }),
  } satisfies FoldersRPC;
  return rpc;
}

const rowPaths = (): string[] =>
  screen.getAllByTestId("folder-row").map((r) => r.querySelector("p")?.textContent ?? "");

afterEach(() => {
  cleanup();
  initFoldersService(null);
});

describe("FoldersScreen without RPC", () => {
  test("shows heading, empty state, zero stats and the priority info", () => {
    render(<FoldersScreen />);
    expect(screen.getByRole("heading", { name: "Source Folders" })).toBeTruthy();
    expect(screen.getByText("No folders added yet")).toBeTruthy();
    expect(screen.getByText("Click 'Add Folder' to get started")).toBeTruthy();
    for (const label of ["Folders", "Images", "Videos", "Total Files", "Total Size"]) {
      expect(screen.getByText(label, { exact: true })).toBeTruthy();
    }
    expect(screen.getByText("0 B")).toBeTruthy();
    expect(screen.getByText("Folder Priority for Duplicate Resolution")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  test("Add Folder reports the missing RPC client without crashing", async () => {
    render(<FoldersScreen />);
    fireEvent.click(screen.getByRole("button", { name: /Add Folder/ }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("RPC client not initialized"));
    expect(screen.getByRole("heading", { name: "Source Folders" })).toBeTruthy();
  });

  test("loads once the service is initialised after mount", async () => {
    render(<FoldersScreen />);
    act(() => initFoldersService(fakeRpc([folder(1, "/late")])));
    await waitFor(() => expect(rowPaths()).toEqual(["/late"]));
  });
});

describe("FoldersScreen with RPC", () => {
  test("lists folders sorted by priority and shows stats", async () => {
    initFoldersService(fakeRpc([folder(1, "/b", { priority: 2 }), folder(2, "/a", { priority: 1 })]));
    render(<FoldersScreen />);
    await waitFor(() => expect(rowPaths()).toEqual(["/a", "/b"]));
    expect(screen.getByText("4.0 KB")).toBeTruthy(); // total size card
    expect(screen.getAllByText("Ready")).toHaveLength(2);
  });

  test("sorting by name, then toggling direction", async () => {
    initFoldersService(fakeRpc([folder(1, "/a", { priority: 2 }), folder(2, "/b", { priority: 1 })]));
    render(<FoldersScreen />);
    await waitFor(() => expect(rowPaths()).toEqual(["/b", "/a"]));
    fireEvent.click(screen.getByTitle("Click to sort by name"));
    expect(rowPaths()).toEqual(["/a", "/b"]);
    fireEvent.click(screen.getByTitle("Click to sort descending"));
    expect(rowPaths()).toEqual(["/b", "/a"]);
  });

  test("Add Folder: picker, add, then quick scan of the new folder", async () => {
    const rpc = fakeRpc([], "/photos");
    initFoldersService(rpc);
    render(<FoldersScreen />);
    await waitFor(() => expect(rpc.listFolders).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: /Add Folder/ }));
    await waitFor(() => expect(rpc.scanFolderQuick).toHaveBeenCalledWith({ id: 100 }));
    expect(rpc.addFolder).toHaveBeenCalledWith({ path: "/photos" });
    await waitFor(() => expect(screen.getByText("5 images")).toBeTruthy());
  });

  test("cancelled picker adds nothing", async () => {
    const rpc = fakeRpc([], null);
    initFoldersService(rpc);
    render(<FoldersScreen />);
    fireEvent.click(screen.getByRole("button", { name: /Add Folder/ }));
    await waitFor(() => expect(rpc.showFolderPicker).toHaveBeenCalled());
    expect(rpc.addFolder).not.toHaveBeenCalled();
  });

  test("toggles update the folder optimistically", async () => {
    const rpc = fakeRpc([folder(1, "/a")]);
    initFoldersService(rpc);
    render(<FoldersScreen />);
    const subdirs = await screen.findByTitle("Scanning subdirectories (click to disable)");
    fireEvent.click(subdirs);
    expect(screen.getByTitle("Not scanning subdirectories (click to enable)").getAttribute("aria-checked")).toBe(
      "false",
    );
    expect(rpc.updateFolder).toHaveBeenCalledWith({ id: 1, scanSubdirectories: false });
    fireEvent.click(screen.getByTitle("Including videos (click to exclude)"));
    expect(rpc.updateFolder).toHaveBeenCalledWith({ id: 1, includeVideos: false });
    await waitFor(() => expect(screen.getByTitle("Excluding videos (click to include)")).toBeTruthy());
  });

  test("a failed update shows its error and reverts", async () => {
    const rpc = fakeRpc([folder(1, "/a")]);
    rpc.updateFolder.mockImplementationOnce(async () => {
      throw new Error("disk on fire");
    });
    initFoldersService(rpc);
    render(<FoldersScreen />);
    fireEvent.click(await screen.findByTitle("Scanning subdirectories (click to disable)"));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("disk on fire"));
    await waitFor(() => expect(screen.getByTitle("Scanning subdirectories (click to disable)")).toBeTruthy());
  });

  test("priority change through the dropdown", async () => {
    const rpc = fakeRpc([folder(1, "/a")]);
    initFoldersService(rpc);
    render(<FoldersScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "3 - Medium" }));
    const menu = screen.getByRole("listbox");
    fireEvent.click(within(menu).getByRole("option", { name: "1 - Highest" }));
    expect(screen.queryByRole("listbox")).toBeNull();
    await waitFor(() => expect(rpc.updateFolder).toHaveBeenCalledWith({ id: 1, priority: 1 }));
    await waitFor(() => expect(screen.getByRole("button", { name: "1 - Highest" })).toBeTruthy());
  });

  test("priority menu closes on an outside click", async () => {
    initFoldersService(fakeRpc([folder(1, "/a")]));
    render(<FoldersScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "3 - Medium" }));
    expect(screen.getByRole("listbox")).toBeTruthy();
    fireEvent.click(screen.getByText("Source Folders"));
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  test("Rescan runs a quick scan", async () => {
    const rpc = fakeRpc([folder(1, "/a")]);
    initFoldersService(rpc);
    render(<FoldersScreen />);
    fireEvent.click(await screen.findByTitle("Rescan"));
    await waitFor(() => expect(rpc.scanFolderQuick).toHaveBeenCalledWith({ id: 1 }));
    await waitFor(() => expect(screen.getByText("5 images")).toBeTruthy());
  });

  test("remove: confirm dialog, cancel, then confirm notifies review data", async () => {
    const rpc = fakeRpc([folder(1, "/a"), folder(2, "/b")]);
    initFoldersService(rpc);
    render(<FoldersScreen />);
    await waitFor(() => expect(rowPaths()).toHaveLength(2));

    fireEvent.click(screen.getAllByTitle("Delete folder")[0] as HTMLElement);
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("/a")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(rpc.removeFolder).not.toHaveBeenCalled();

    const before = getReviewDataVersion();
    fireEvent.click(screen.getAllByTitle("Delete folder")[0] as HTMLElement);
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: /Remove Folder/ }));
    await waitFor(() => expect(rowPaths()).toEqual(["/b"]));
    expect(rpc.removeFolder).toHaveBeenCalledWith({ id: 1 });
    expect(getReviewDataVersion()).toBe(before + 1);
  });

  test("a failed load shows the error", async () => {
    const rpc = fakeRpc([]);
    rpc.listFolders.mockImplementation(async () => {
      throw new Error("db locked");
    });
    initFoldersService(rpc);
    render(<FoldersScreen />);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("db locked"));
  });
});
