import type { Generated } from "kysely";
import { z } from "zod";
import { BooleanSchema, DateSchema, SQLBoolean, SQLDate } from "./util";

/** media: per-photo JSON; album_metadata: an album's metadata.json; unparseable: invalid JSON. */
export const SidecarKind = z.enum(["media", "album_metadata", "other", "unparseable"]);
export type SidecarKind = z.infer<typeof SidecarKind>;

/** Which rule linked the sidecar to its media file (see takeout/sidecar-match.ts). */
export const SidecarMatchMethod = z.enum(["name_exact", "name_truncated", "title", "edited_name", "album_reference"]);
export type SidecarMatchMethod = z.infer<typeof SidecarMatchMethod>;

/**
 * Domain model: one Google Takeout JSON file (RFD-003 §C). `mediaFileId` is the file it
 * describes; for album_reference it is the year-folder photo the album sidecar points to.
 */
export const Sidecar = z.object({
  id: z.number().int().positive(),
  scanFolderId: z.number().int().positive().describe("Foreign key to scan_folders"),
  takeoutFolderId: z.number().int().positive().nullable().default(null).describe("Foreign key to takeout_folders"),
  path: z.string().min(1).describe("Absolute path of the JSON file"),
  kind: SidecarKind,
  title: z.string().nullable().default(null).describe("JSON title: original file name or album title"),
  description: z.string().nullable().default(null),
  photoTakenTime: DateSchema.nullable().default(null),
  geoLat: z.number().min(-90).max(90).nullable().default(null),
  geoLon: z.number().min(-180).max(180).nullable().default(null),
  geoAlt: z.number().nullable().default(null),
  trashed: BooleanSchema.default(false),
  archived: BooleanSchema.default(false),
  favorited: BooleanSchema.default(false),
  people: z.array(z.string()).default([]).describe("People tag names"),
  mediaFileId: z.number().int().positive().nullable().default(null).describe("Foreign key to media_files"),
  matchMethod: SidecarMatchMethod.nullable().default(null),
  createdAt: DateSchema,
  updatedAt: DateSchema,
});
export type Sidecar = z.infer<typeof Sidecar>;

const SidecarNoId = Sidecar.omit({ id: true });

/** SQLite record: dates as integers, booleans as 0/1, people as a JSON text array. */
export const SidecarRecord = SidecarNoId.omit({
  photoTakenTime: true,
  trashed: true,
  archived: true,
  favorited: true,
  people: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  photoTakenTime: SQLDate.nullable(),
  trashed: SQLBoolean,
  archived: SQLBoolean,
  favorited: SQLBoolean,
  people: z.string().describe("JSON array of people names"),
  createdAt: SQLDate,
  updatedAt: SQLDate,
});
export type SidecarRecord = z.infer<typeof SidecarRecord> & { id: Generated<number> };

export const NewSidecar = SidecarNoId.omit({ createdAt: true, updatedAt: true });
export type NewSidecar = z.input<typeof NewSidecar>;

export const UpdateSidecar = Sidecar.omit({ createdAt: true, updatedAt: true }).partial().required({ id: true });
export type UpdateSidecar = z.infer<typeof UpdateSidecar>;
