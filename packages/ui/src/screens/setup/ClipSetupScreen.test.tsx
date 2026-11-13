import { afterEach, describe, expect, mock, test } from "bun:test";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { type ClipModelStatus, initClipService, resetClipServiceForTests } from "../../services/clip-service";
import { ClipSetupScreen } from "./ClipSetupScreen";

afterEach(() => {
  cleanup();
  resetClipServiceForTests();
});

/** A fake RPC whose status the test changes; returns a setter. */
function rpc(initial: ClipModelStatus, importResult: { status: ClipModelStatus; error: string | null } | null = null) {
  let status = initial;
  const api = {
    getClipModelStatus: mock(async () => status),
    retryClipModelSetup: mock(async () => {
      status = { state: "downloading", file: "model.onnx", receivedBytes: 0, totalBytes: 100 };
      return status;
    }),
    importClipModelFile: mock(async () => importResult ?? { status, error: null }),
  };
  initClipService(api);
  return { api, set: (next: ClipModelStatus) => (status = next) };
}

const DOWNLOADING: ClipModelStatus = {
  state: "downloading",
  file: "model.onnx",
  receivedBytes: 104857600,
  totalBytes: 335544320,
};
const title = () => screen.queryByRole("heading", { name: "Setting up visual similarity" });

describe("ClipSetupScreen", () => {
  test("nothing without RPC, and nothing when the model was already ready at launch", async () => {
    render(<ClipSetupScreen />);
    expect(title()).toBeNull();
    rpc({ state: "ready", dir: "/m" });
    await new Promise((r) => setTimeout(r, 20));
    expect(title()).toBeNull();
  });

  test("shows download progress; Continue in background closes it for the session", async () => {
    rpc(DOWNLOADING);
    render(<ClipSetupScreen />);
    await waitFor(() => expect(title()).toBeTruthy());
    expect(screen.getByText("100 MB / 320 MB")).toBeTruthy();
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("31");
    fireEvent.click(screen.getByRole("button", { name: "Continue in background" }));
    expect(title()).toBeNull();
  });

  test("after a download it says ready, with Get started", async () => {
    const { set } = rpc(DOWNLOADING);
    render(<ClipSetupScreen />);
    await waitFor(() => expect(title()).toBeTruthy());
    set({ state: "ready", dir: "/m" });
    await act(() => new Promise((r) => setTimeout(r, 1100))); // next poll
    expect(screen.getByText(/Model ready/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Get started" }));
    expect(title()).toBeNull();
  });

  test("an error offers retry, import, and continuing without it", async () => {
    const { api } = rpc({ state: "error", message: "network down" });
    render(<ClipSetupScreen />);
    await waitFor(() => expect(screen.getByText("network down")).toBeTruthy());
    expect(screen.getByRole("button", { name: "Continue without it" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Retry download/ }));
    await waitFor(() => expect(api.retryClipModelSetup).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText(/Downloading model.onnx/)).toBeTruthy());
  });

  test("a failed import shows why", async () => {
    rpc(
      { state: "error", message: "offline" },
      { status: { state: "error", message: "offline" }, error: "Hash mismatch" },
    );
    render(<ClipSetupScreen />);
    await waitFor(() => expect(screen.getByText("offline")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Import model file…" }));
    await waitFor(() => expect(screen.getByText("Hash mismatch")).toBeTruthy());
  });
});
