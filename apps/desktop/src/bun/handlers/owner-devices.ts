import { DatabaseProvider } from "@giggle-photos/core/db/database-provider";
import type { FolderDevice } from "@giggle-photos/core/db/folder-owner-device-provider";
import { getLogger } from "@giggle-photos/core/logging/logger";
import { DeviceKey } from "@giggle-photos/core/zod/folder-owner-device";

const log = getLogger("rpc:owner-devices");

/** RPC: cameras found in a folder's photos, each marked owned or not (RFD-005). */
export async function listFolderDevices(params: { scanFolderId: number }): Promise<FolderDevice[]> {
  return (await DatabaseProvider.getInstance()).getFolderOwnerDeviceProvider().listFolderDevices(params.scanFolderId);
}

/** RPC: replace the cameras a folder's owner uses. */
export async function setFolderOwnerDevices(params: {
  scanFolderId: number;
  devices: DeviceKey[];
}): Promise<{ success: boolean }> {
  try {
    const devices = params.devices.map((d) => DeviceKey.parse(d));
    await (await DatabaseProvider.getInstance())
      .getFolderOwnerDeviceProvider()
      .setOwnerDevices(params.scanFolderId, devices);
    log.info("Owner devices saved", { scanFolderId: params.scanFolderId, devices: devices.length });
    return { success: true };
  } catch (error) {
    log.error("Failed to save owner devices", { scanFolderId: params.scanFolderId, error });
    throw new Error("Could not save the owner devices for this folder");
  }
}
