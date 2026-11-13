import { afterEach, describe, expect, mock, test } from "bun:test";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { clearUpdateService, initUpdateService, type UpdateState } from "../services/update-service";
import { UpdateStatus } from "./UpdateStatus";

afterEach(() => {
  cleanup();
  clearUpdateService();
});

function rpc(initial: UpdateState) {
  let state = initial;
  const api = {
    getUpdateState: mock(async () => state),
    restartToUpdate: mock(async () => ({ ...state, phase: "applying" as const })),
    retryUpdate: mock(async () => ({ phase: "checking" as const })),
  };
  initUpdateService(api);
  return { api, set: (next: UpdateState) => (state = next) };
}

describe("UpdateStatus", () => {
  test("nothing without RPC, while checking, or when up to date", async () => {
    const { container } = render(<UpdateStatus />);
    expect(container.textContent).toBe("");
    cleanup();
    rpc({ phase: "up-to-date" });
    const r = render(<UpdateStatus />);
    await new Promise((res) => setTimeout(res, 20));
    expect(r.container.textContent).toBe("");
  });

  test("downloading shows the version and progress, then turns into Restart to update", async () => {
    const { api, set } = rpc({
      phase: "downloading",
      version: "0.1.3",
      progress: 45,
      bytesDownloaded: 110 * 1048576,
      totalBytes: 245 * 1048576,
    });
    render(<UpdateStatus />);
    await waitFor(() => expect(screen.getByText("Downloading version 0.1.3")).toBeTruthy());
    expect(screen.getByText("45% · 110 MB of 245 MB")).toBeTruthy();
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("45");
    set({ phase: "ready", version: "0.1.3" });
    await act(() => new Promise((res) => setTimeout(res, 1100)));
    expect(screen.getByText("Version 0.1.3 is ready")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Restart to update" }));
    await waitFor(() => expect(api.restartToUpdate).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText("Restarting…")).toBeTruthy());
  });

  test("a failed check offers a retry", async () => {
    const { api } = rpc({ phase: "error", message: "HTTP 404" });
    render(<UpdateStatus />);
    await waitFor(() => expect(screen.getByTestId("update-error")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(api.retryUpdate).toHaveBeenCalledTimes(1));
  });
});
