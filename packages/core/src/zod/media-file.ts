import type { Generated } from "kysely";
import { z } from "zod";
import { DateSchema, SQLDate } from "./util";

/**
 * File type discriminator for images vs videos
 */
export const FileType = z.union([
  z.literal("image").describe("Image file (jpg, png, gif, etc.)"),
  z.literal("video").describe("Video file (mp4, mov, avi, etc.)"),
]);
export type FileType = z.infer<typeof FileType>;

/**
 * Processing status for a media file
 */
export const FileStatus = z.union([
  z.literal("pending").describe("File discovered, not yet processed"),
  z.literal("metadata").describe("Metadata extracted successfully"),
  z.literal("hashed").describe("All hash algorithms completed"),
  z.literal("processed").describe("Duplicate detection completed for this file"),
  z.literal("error").describe("An error occurred during processing"),
]);
export type FileStatus = z.infer<typeof FileStatus>;

/**
 * Domain model for a media file (image or video).
 *
 * Represents a file discovered during folder scanning that will be
 * processed for duplicate detection.
 */
export const MediaFile = z.object({
  id: z.number().int().positive(),
  scanFolderId: z.number().int().positive().describe("Foreign key to scan_folders"),
  path: z.string().min(1).describe("Full absolute path to the file"),
  filename: z.string().min(1).describe("File name without directory"),
  extension: z.string().min(1).describe("File extension without dot (jpg, png, mp4)"),
  fileType: FileType,
  size: z.number().int().nonnegative().describe("File size in bytes"),
  status: FileStatus.default("pending"),
  sha256Hash: z.string().nullable().default(null).describe("SHA-256 hash of entire file"),
  contentHash: z.string().nullable().default(null).describe("Hash of image bytes without metadata"),
  perceptualHash: z.string().nullable().default(null).describe("Perceptual hash for near-duplicate detection"),
  errorMessage: z.string().nullable().default(null).describe("Error message if status is 'error'"),
  takeoutFolderId: z
    .number()
    .int()
    .positive()
    .nullable()
    .default(null)
    .describe("Foreign key to takeout_folders (null outside a Google Takeout)"),
  createdAt: DateSchema,
  updatedAt: DateSchema,
});
export type MediaFile = z.infer<typeof MediaFile>;

/**
 * Internal helper - domain model without id
 */
const MediaFileNoId = MediaFile.omit({ id: true });

/**
 * Database record type with SQLite-compatible types.
 * Dates stored as integers (Unix timestamps).
 */
export const MediaFileRecord = MediaFileNoId.omit({
  createdAt: true,
  updatedAt: true,
}).extend({
  createdAt: SQLDate,
  updatedAt: SQLDate,
});
export type MediaFileRecord = z.infer<typeof MediaFileRecord> & {
  id: Generated<number>;
};

/**
 * Schema for inserting a new media file (without auto-generated fields)
 */
export const NewMediaFile = MediaFileNoId.omit({
  createdAt: true,
  updatedAt: true,
});
export type NewMediaFile = z.input<typeof NewMediaFile>;

/**
 * Schema for updating a media file (partial, requires id)
 */
export const UpdateMediaFile = MediaFile.omit({
  createdAt: true,
  updatedAt: true,
})
  .partial()
  .required({ id: true });
export type UpdateMediaFile = z.infer<typeof UpdateMediaFile>;
