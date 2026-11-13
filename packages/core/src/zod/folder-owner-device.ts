import type { Generated } from "kysely";
import { z } from "zod";
import { DateSchema, SQLDate } from "./util";

/**
 * Domain model: a camera that belongs to a scan folder's owner (RFD-005). Photos whose EXIF make and
 * model match are "owned" by that folder, and preselection can prefer the owner's copy.
 * Make and model are stored exactly as EXIF reports them (e.g. "Google" / "Pixel 8 Pro").
 */
export const FolderOwnerDevice = z.object({
  id: z.number().int().positive(),
  scanFolderId: z.number().int().positive().describe("Foreign key to scan_folders"),
  cameraMake: z.string().nullable().default(null).describe("EXIF camera make, exact (null when absent)"),
  cameraModel: z.string().min(1).describe("EXIF camera model, exact"),
  createdAt: DateSchema,
});
export type FolderOwnerDevice = z.infer<typeof FolderOwnerDevice>;

const FolderOwnerDeviceNoId = FolderOwnerDevice.omit({ id: true });

export const FolderOwnerDeviceRecord = FolderOwnerDeviceNoId.omit({ createdAt: true }).extend({ createdAt: SQLDate });
export type FolderOwnerDeviceRecord = z.infer<typeof FolderOwnerDeviceRecord> & { id: Generated<number> };

export const NewFolderOwnerDevice = FolderOwnerDeviceNoId.omit({ createdAt: true });
export type NewFolderOwnerDevice = z.input<typeof NewFolderOwnerDevice>;

export const UpdateFolderOwnerDevice = FolderOwnerDevice.omit({ createdAt: true }).partial().required({ id: true });
export type UpdateFolderOwnerDevice = z.infer<typeof UpdateFolderOwnerDevice>;

/** A camera as the folder setup screen lists it (RFD-005). */
export const DeviceKey = z.object({
  cameraMake: z.string().nullable(),
  cameraModel: z.string().min(1),
});
export type DeviceKey = z.infer<typeof DeviceKey>;
