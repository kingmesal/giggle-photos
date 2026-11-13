import type { Generated } from "kysely";
import { z } from "zod";
import { DateSchema, SQLDate } from "./util";

/** Kind of folder inside a Google Photos Takeout (RFD-003 §B). */
export const TakeoutFolderKind = z.enum(["year", "album", "special", "non_takeout"]);
export type TakeoutFolderKind = z.infer<typeof TakeoutFolderKind>;

/**
 * Domain model: one direct child folder of a Takeout's Google Photos directory.
 * Media files point to it (mediaFiles.takeoutFolderId); album folders carry the album title
 * (from the album's metadata.json when present, else the folder name).
 */
export const TakeoutFolder = z.object({
  id: z.number().int().positive(),
  scanFolderId: z.number().int().positive().describe("Foreign key to scan_folders"),
  rootPath: z.string().min(1).describe("Absolute path of the Google Photos directory"),
  path: z.string().min(1).describe("Absolute path of this folder"),
  kind: TakeoutFolderKind,
  year: z.number().int().min(1800).max(2200).nullable().default(null).describe("Year of a year folder"),
  albumTitle: z.string().nullable().default(null).describe("Album title (album folders)"),
  createdAt: DateSchema,
  updatedAt: DateSchema,
});
export type TakeoutFolder = z.infer<typeof TakeoutFolder>;

const TakeoutFolderNoId = TakeoutFolder.omit({ id: true });

export const TakeoutFolderRecord = TakeoutFolderNoId.omit({ createdAt: true, updatedAt: true }).extend({
  createdAt: SQLDate,
  updatedAt: SQLDate,
});
export type TakeoutFolderRecord = z.infer<typeof TakeoutFolderRecord> & { id: Generated<number> };

export const NewTakeoutFolder = TakeoutFolderNoId.omit({ createdAt: true, updatedAt: true });
export type NewTakeoutFolder = z.input<typeof NewTakeoutFolder>;

export const UpdateTakeoutFolder = TakeoutFolder.omit({ createdAt: true, updatedAt: true })
  .partial()
  .required({ id: true });
export type UpdateTakeoutFolder = z.infer<typeof UpdateTakeoutFolder>;
