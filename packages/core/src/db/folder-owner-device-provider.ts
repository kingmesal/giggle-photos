/**
 * Folder owner devices (RFD-005): which cameras belong to a scan folder's owner, the cameras found in
 * a folder's photos, and which files were taken by a device their own folder owns.
 */
import { type DeviceKey, FolderOwnerDeviceRecord, NewFolderOwnerDevice } from "../zod/folder-owner-device";
import type { DatabaseInstance } from "./schema";

const CHUNK = 500;
const keyOf = (d: { cameraMake: string | null; cameraModel: string | null }) =>
  `${d.cameraMake ?? ""}\u0000${d.cameraModel ?? ""}`;

export interface FolderDevice extends DeviceKey {
  /** Photos in this folder taken with the device. */
  photos: number;
  owned: boolean;
}

export class FolderOwnerDeviceProvider {
  constructor(private db: DatabaseInstance) {}

  /** Devices owned by a folder. */
  async getOwnerDevices(scanFolderId: number): Promise<DeviceKey[]> {
    const rows = await this.db
      .selectFrom("folderOwnerDevices")
      .select(["cameraMake", "cameraModel"])
      .where("scanFolderId", "=", scanFolderId)
      .orderBy("cameraModel")
      .execute();
    return rows.map((r) => ({ cameraMake: r.cameraMake ?? null, cameraModel: r.cameraModel }));
  }

  /** Replace a folder's owned devices (validated, de-duplicated) in one transaction. */
  async setOwnerDevices(scanFolderId: number, devices: DeviceKey[]): Promise<void> {
    const unique = new Map(devices.map((d) => [keyOf(d), d]));
    const now = new Date();
    const records = [...unique.values()].map((d) =>
      FolderOwnerDeviceRecord.parse({ ...NewFolderOwnerDevice.parse({ scanFolderId, ...d }), createdAt: now }),
    );
    await this.db.transaction().execute(async (trx) => {
      await trx.deleteFrom("folderOwnerDevices").where("scanFolderId", "=", scanFolderId).execute();
      if (records.length > 0) await trx.insertInto("folderOwnerDevices").values(records).execute();
    });
  }

  /** Cameras found in the folder's photo EXIF, most used first, each marked owned or not. */
  async listFolderDevices(scanFolderId: number): Promise<FolderDevice[]> {
    const [rows, owned] = await Promise.all([
      this.db
        .selectFrom("imageMetadata")
        .innerJoin("mediaFiles", "mediaFiles.id", "imageMetadata.mediaFileId")
        .select(["imageMetadata.cameraMake", "imageMetadata.cameraModel", (eb) => eb.fn.countAll().as("photos")])
        .where("mediaFiles.scanFolderId", "=", scanFolderId)
        .where("imageMetadata.cameraModel", "is not", null)
        .groupBy(["imageMetadata.cameraMake", "imageMetadata.cameraModel"])
        .execute(),
      this.getOwnerDevices(scanFolderId),
    ]);
    const ownedKeys = new Set(owned.map(keyOf));
    const found: FolderDevice[] = rows.map((r) => ({
      cameraMake: r.cameraMake ?? null,
      cameraModel: r.cameraModel as string,
      photos: Number(r.photos),
      owned: ownedKeys.has(keyOf(r)),
    }));
    // Owned devices with no photos (yet) stay visible so they can be unticked.
    const foundKeys = new Set(found.map(keyOf));
    for (const d of owned) if (!foundKeys.has(keyOf(d))) found.push({ ...d, photos: 0, owned: true });
    return found.sort((a, b) => b.photos - a.photos || a.cameraModel.localeCompare(b.cameraModel));
  }

  /** Of `fileIds`, those taken with a device that the file's own scan folder owns. */
  async getOwnedFileIds(fileIds: number[]): Promise<Set<number>> {
    const owned = new Set<number>();
    if (fileIds.length === 0) return owned;
    const devices = await this.db
      .selectFrom("folderOwnerDevices")
      .select(["scanFolderId", "cameraMake", "cameraModel"])
      .execute();
    if (devices.length === 0) return owned;
    const ownedBy = new Set(devices.map((d) => `${d.scanFolderId}\u0000${keyOf(d)}`));
    for (let i = 0; i < fileIds.length; i += CHUNK) {
      const rows = await this.db
        .selectFrom("mediaFiles")
        .innerJoin("imageMetadata", "imageMetadata.mediaFileId", "mediaFiles.id")
        .select(["mediaFiles.id", "mediaFiles.scanFolderId", "imageMetadata.cameraMake", "imageMetadata.cameraModel"])
        .where("mediaFiles.id", "in", fileIds.slice(i, i + CHUNK))
        .execute();
      for (const r of rows) {
        if (r.cameraModel && ownedBy.has(`${r.scanFolderId}\u0000${keyOf(r)}`)) owned.add(r.id as number);
      }
    }
    return owned;
  }
}
