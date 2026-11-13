/**
 * Folder owner devices (RFD-005): the cameras found in a folder and which belong to its owner.
 * Electrobun uses RPC; without RPC (dev preview / E2E) an in-memory store keeps the screen usable.
 */
import { getLogger } from "./logger-service";

const log = getLogger("ui:owner-devices");

/** Mirrors core DeviceKey / FolderDevice (the UI only talks to core over RPC). */
export interface DeviceKey {
  cameraMake: string | null;
  cameraModel: string;
}

export interface FolderDevice extends DeviceKey {
  photos: number;
  owned: boolean;
}

export interface OwnerDevicesRPC {
  listFolderDevices: (scanFolderId: number) => Promise<FolderDevice[]>;
  setFolderOwnerDevices: (scanFolderId: number, devices: DeviceKey[]) => Promise<{ success: boolean }>;
}

let rpcClient: OwnerDevicesRPC | null = null;
const memory = new Map<number, FolderDevice[]>();

export function initOwnerDevicesService(rpc: OwnerDevicesRPC): void {
  rpcClient = rpc;
  log.debug("Owner devices service initialized with RPC");
}

/** Test helper. */
export function clearOwnerDevicesService(): void {
  rpcClient = null;
  memory.clear();
}

export async function listFolderDevices(scanFolderId: number): Promise<FolderDevice[]> {
  return rpcClient ? rpcClient.listFolderDevices(scanFolderId) : (memory.get(scanFolderId) ?? []);
}

export async function saveFolderOwnerDevices(scanFolderId: number, devices: DeviceKey[]): Promise<void> {
  if (rpcClient) {
    await rpcClient.setFolderOwnerDevices(scanFolderId, devices);
    return;
  }
  const owned = new Set(devices.map((d) => `${d.cameraMake}|${d.cameraModel}`));
  memory.set(
    scanFolderId,
    (memory.get(scanFolderId) ?? []).map((d) => ({ ...d, owned: owned.has(`${d.cameraMake}|${d.cameraModel}`) })),
  );
}
