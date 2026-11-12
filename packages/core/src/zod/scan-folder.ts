import type { Generated } from "kysely";
import { z } from "zod";
import { BooleanSchema, DateSchema, SQLBoolean, SQLDate } from "./util";

export const FolderStatus = z.union([
  z.literal("added").describe("Folder was added but not yet scanned"),
  z.literal("scanning").describe("Folder is currently being scanned"),
  z.literal("ready").describe("Scanning completed successfully, ready for processing"),
  z.literal("error").describe("An error occurred during scanning"),
]);
export type FolderStatus = z.infer<typeof FolderStatus>;

/**
 * This is the domain model for a scan folder.
 *
 * Represents a folder that can be scanned for images/videos
 */
export const ScanFolder = z.object({
  id: z.number().int().positive(),
  path: z.string().min(1),
  priority: z.number().int().min(1).max(5).default(3).describe("1 = highest, 5 = lowest"),
  status: FolderStatus.default("added"),
  scanSubdirectories: BooleanSchema.default(true),
  includeVideos: BooleanSchema.default(true),
  imageCount: z.number().int().nonnegative().default(0),
  videoCount: z.number().int().nonnegative().default(0),
  totalSize: z.number().int().nonnegative().default(0).describe("Size in bytes"),
  createdAt: DateSchema,
  updatedAt: DateSchema,
});
export type ScanFolder = z.infer<typeof ScanFolder>;

/**
 * We reuse the domain model without the id for a few things, but NOT externally.
 */
const ScanFolderNoId = ScanFolder.omit({ id: true });

/**
 * We need to create a DB domain record with the correct types.
 *
 * All the custom types here will parse into the correct types for the database.
 */
export const ScanFolderRecord = ScanFolderNoId.omit({
  scanSubdirectories: true,
  includeVideos: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  scanSubdirectories: SQLBoolean,
  includeVideos: SQLBoolean,
  createdAt: SQLDate,
  updatedAt: SQLDate,
});
export type ScanFolderRecord = z.infer<typeof ScanFolderRecord> & {
  id: Generated<number>;
};

/**
 * Schema for new folder input (without auto-generated fields)
 */
export const NewScanFolder = ScanFolderNoId.omit({
  createdAt: true,
  updatedAt: true,
});
export type NewScanFolder = z.input<typeof NewScanFolder>;

/**
 * Schema for folder update input (partial, requires id)
 */
export const UpdateScanFolder = ScanFolder.omit({
  createdAt: true,
  updatedAt: true,
})
  .partial()
  .required({ id: true });

export type UpdateScanFolder = z.infer<typeof UpdateScanFolder>;
