import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { clearQuarantineService, initQuarantineService } from "../../services/quarantine-service";
import { QuarantineRestore } from "./QuarantineRestore";

afterEach(() => {
  cleanup();
  clearQuarantineService();
});

function rpc(files: number, problems: string[] = []) {
  let left = files;
  const api = {
    getQuarantineStatus: mock(async () => ({ root: "/q", enabled: true, files: left, sidecars: left > 0 ? 1 : 0 })),
    restoreQuarantinedFiles: mock(async () => {
      const restored = left;
      left = 0;
      return { restored, problems };
    }),
  };
  initQuarantineService(api);
  return api;
}

const restoreButton = () => screen.getByRole("button", { name: /Restore All/ }) as HTMLButtonElement;

describe("QuarantineRestore", () => {
  test("hidden without RPC (dev preview)", async () => {
    const { container } = render(<QuarantineRestore />);
    await new Promise((r) => setTimeout(r, 10));
    expect(container.textContent).toBe("");
  });

  test("empty quarantine: says so and Restore is disabled", async () => {
    rpc(0);
    render(<QuarantineRestore />);
    await waitFor(() => expect(screen.getByText("Quarantine is empty")).toBeTruthy());
    expect(restoreButton().disabled).toBe(true);
  });

  test("restores, reports the outcome and problems, then re-reads the status", async () => {
    const api = rpc(3, ["Not restored (original path is occupied): /lib/a.jpg"]);
    render(<QuarantineRestore />);
    await waitFor(() => expect(screen.getByText("3 files in quarantine (+1 sidecars)")).toBeTruthy());
    expect(screen.getByText("/q")).toBeTruthy();
    fireEvent.click(restoreButton());
    await waitFor(() => expect(screen.getByTestId("quarantine-restore-result")).toBeTruthy());
    expect(api.restoreQuarantinedFiles).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Restored 3 files\. Re-scan their folders/)).toBeTruthy();
    expect(screen.getByText(/original path is occupied/)).toBeTruthy();
    await waitFor(() => expect(screen.getByText("Quarantine is empty")).toBeTruthy());
    expect(api.getQuarantineStatus).toHaveBeenCalledTimes(2);
  });

  test("a failed restore shows its message", async () => {
    const api = rpc(1);
    api.restoreQuarantinedFiles.mockImplementation(async () => {
      throw new Error("Could not restore the quarantine at /q");
    });
    render(<QuarantineRestore />);
    await waitFor(() => expect(restoreButton().disabled).toBe(false));
    fireEvent.click(restoreButton());
    await waitFor(() => expect(screen.getByText("Could not restore the quarantine at /q")).toBeTruthy());
  });
});
