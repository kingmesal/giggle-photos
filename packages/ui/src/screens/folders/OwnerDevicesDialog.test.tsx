import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { clearOwnerDevicesService, initOwnerDevicesService } from "../../services/owner-devices-service";
import { getReviewDataVersion } from "../../state/review-events";
import { OwnerDevicesDialog } from "./OwnerDevicesDialog";

afterEach(() => {
  cleanup();
  clearOwnerDevicesService();
});

const DEVICES = [
  { cameraMake: "Google", cameraModel: "Pixel 8", photos: 1200, owned: true },
  { cameraMake: "Google", cameraModel: "Pixel 8 Pro", photos: 40, owned: false },
  { cameraMake: null, cameraModel: "Unknown Cam", photos: 2, owned: false },
];

function rpc(fail = false) {
  const api = {
    listFolderDevices: mock(async (_id: number) => DEVICES),
    setFolderOwnerDevices: mock(async (_id: number, _devices: unknown[]) => {
      if (fail) throw new Error("Could not save the owner devices for this folder");
      return { success: true };
    }),
  };
  initOwnerDevicesService(api);
  return api;
}

describe("OwnerDevicesDialog", () => {
  test("lists the folder's cameras with counts and the owned ones ticked; saves the new choice", async () => {
    const api = rpc();
    const onClose = mock(() => {});
    const before = getReviewDataVersion();
    render(<OwnerDevicesDialog folder={{ id: 7, path: "/takeouts/heather" }} onClose={onClose} />);
    const pixel8 = (await screen.findByLabelText(/Google Pixel 8$/)) as HTMLInputElement;
    expect(api.listFolderDevices.mock.calls[0]?.[0]).toBe(7);
    expect(pixel8.checked).toBe(true);
    expect(screen.getByText("1,200 photos")).toBeTruthy();
    expect((screen.getByLabelText(/Google Pixel 8 Pro/) as HTMLInputElement).checked).toBe(false);
    fireEvent.click(pixel8);
    fireEvent.click(screen.getByLabelText(/Unknown Cam/));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(api.setFolderOwnerDevices.mock.calls[0]).toEqual([7, [{ cameraMake: null, cameraModel: "Unknown Cam" }]]);
    expect(getReviewDataVersion()).toBe(before + 1);
  });

  test("a failed save stays open and says why", async () => {
    rpc(true);
    const onClose = mock(() => {});
    render(<OwnerDevicesDialog folder={{ id: 7, path: "/h" }} onClose={onClose} />);
    await screen.findByLabelText(/Google Pixel 8$/);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByText("Could not save the owner devices for this folder")).toBeTruthy());
    expect(onClose).not.toHaveBeenCalled();
  });

  test("no cameras yet: explains what to do", async () => {
    render(<OwnerDevicesDialog folder={{ id: 1, path: "/x" }} onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText(/No camera models found/)).toBeTruthy());
  });
});
