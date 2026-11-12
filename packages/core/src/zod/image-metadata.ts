import type { Generated } from "kysely";
import { z } from "zod";
import { BooleanSchema, DateSchema, SQLBoolean, SQLDate } from "./util";

/**
 * EXIF orientation values (1-8).
 * Describes how the stored pixel data should be transformed for correct display.
 */
export const ExifOrientation = z.union([
  z.literal(1).describe("Horizontal (normal)"),
  z.literal(2).describe("Mirror horizontal"),
  z.literal(3).describe("Rotate 180"),
  z.literal(4).describe("Mirror vertical"),
  z.literal(5).describe("Mirror horizontal and rotate 270 CW"),
  z.literal(6).describe("Rotate 90 CW"),
  z.literal(7).describe("Mirror horizontal and rotate 90 CW"),
  z.literal(8).describe("Rotate 270 CW"),
]);
export type ExifOrientation = z.infer<typeof ExifOrientation>;

/**
 * Domain model for image metadata extracted from EXIF and file analysis.
 *
 * One-to-one relationship with MediaFile (unique mediaFileId).
 * Contains technical image properties and camera/location data.
 */
export const ImageMetadata = z.object({
  id: z.number().int().positive(),
  mediaFileId: z.number().int().positive().describe("Foreign key to media_files (unique)"),
  width: z.number().int().positive().describe("Image width in pixels"),
  height: z.number().int().positive().describe("Image height in pixels"),
  format: z.string().min(1).describe("Image format (jpeg, png, webp, gif, etc.)"),
  colorSpace: z.string().nullable().default(null).describe("Color space (sRGB, Adobe RGB, etc.)"),
  hasAlpha: BooleanSchema.describe("Whether the image has an alpha channel"),
  orientation: ExifOrientation.nullable().default(null).describe("EXIF orientation value (1-8)"),
  dateTaken: DateSchema.nullable().default(null).describe("Date photo was taken (from EXIF)"),
  cameraMake: z.string().nullable().default(null).describe("Camera manufacturer (from EXIF)"),
  cameraModel: z.string().nullable().default(null).describe("Camera model (from EXIF)"),
  gpsLatitude: z.number().nullable().default(null).describe("GPS latitude coordinate"),
  gpsLongitude: z.number().nullable().default(null).describe("GPS longitude coordinate"),
  gpsAltitude: z.number().nullable().default(null).describe("GPS altitude in meters"),
  createdAt: DateSchema,
  updatedAt: DateSchema,
});
export type ImageMetadata = z.infer<typeof ImageMetadata>;

/**
 * Internal helper - domain model without id
 */
const ImageMetadataNoId = ImageMetadata.omit({ id: true });

/**
 * Database record type with SQLite-compatible types.
 * Dates stored as integers (Unix timestamps).
 * Booleans stored as integers (0/1).
 */
export const ImageMetadataRecord = ImageMetadataNoId.omit({
  createdAt: true,
  updatedAt: true,
  hasAlpha: true,
  dateTaken: true,
}).extend({
  hasAlpha: SQLBoolean,
  dateTaken: SQLDate.nullable().optional(),
  createdAt: SQLDate,
  updatedAt: SQLDate,
});
export type ImageMetadataRecord = z.infer<typeof ImageMetadataRecord> & {
  id: Generated<number>;
};

/**
 * Schema for inserting a new image metadata record (without auto-generated fields)
 */
export const NewImageMetadata = ImageMetadataNoId.omit({
  createdAt: true,
  updatedAt: true,
});
export type NewImageMetadata = z.input<typeof NewImageMetadata>;

/**
 * Schema for updating image metadata (partial, requires id)
 */
export const UpdateImageMetadata = ImageMetadata.omit({
  createdAt: true,
  updatedAt: true,
})
  .partial()
  .required({ id: true });
export type UpdateImageMetadata = z.infer<typeof UpdateImageMetadata>;
