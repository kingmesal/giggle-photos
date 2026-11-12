import type { Generated } from "kysely";
import { z } from "zod";
import { DateSchema, SQLDate } from "./util";

/**
 * Domain model for video metadata.
 *
 * Stores extracted metadata from video files including dimensions,
 * duration, codecs, and other technical details.
 */
export const VideoMetadata = z.object({
  id: z.number().int().positive(),
  mediaFileId: z.number().int().positive().describe("Foreign key to media_files (unique - one metadata per file)"),
  width: z.number().int().positive().describe("Video width in pixels"),
  height: z.number().int().positive().describe("Video height in pixels"),
  duration: z.number().nonnegative().describe("Duration in seconds (can be decimal)"),
  frameRate: z.number().positive().nullable().default(null).describe("Frame rate (fps)"),
  codec: z.string().nullable().default(null).describe("Video codec (h264, hevc, vp9, av1, etc.)"),
  audioCodec: z.string().nullable().default(null).describe("Audio codec (aac, mp3, opus, etc.)"),
  bitrate: z.number().int().positive().nullable().default(null).describe("Bitrate in bits per second"),
  dateTaken: DateSchema.nullable().default(null).describe("Date video was recorded (from metadata)"),
  createdAt: DateSchema,
  updatedAt: DateSchema,
});
export type VideoMetadata = z.infer<typeof VideoMetadata>;

/**
 * Internal helper - domain model without id
 */
const VideoMetadataNoId = VideoMetadata.omit({ id: true });

/**
 * Database record type with SQLite-compatible types.
 * Dates stored as integers (Unix timestamps).
 */
export const VideoMetadataRecord = VideoMetadataNoId.omit({
  createdAt: true,
  updatedAt: true,
  dateTaken: true,
}).extend({
  dateTaken: SQLDate.nullable().default(null),
  createdAt: SQLDate,
  updatedAt: SQLDate,
});
export type VideoMetadataRecord = z.infer<typeof VideoMetadataRecord> & {
  id: Generated<number>;
};

/**
 * Schema for inserting new video metadata (without auto-generated fields)
 */
export const NewVideoMetadata = VideoMetadataNoId.omit({
  createdAt: true,
  updatedAt: true,
});
export type NewVideoMetadata = z.input<typeof NewVideoMetadata>;

/**
 * Schema for updating video metadata (partial, requires id)
 */
export const UpdateVideoMetadata = VideoMetadata.omit({
  createdAt: true,
  updatedAt: true,
})
  .partial()
  .required({ id: true });
export type UpdateVideoMetadata = z.infer<typeof UpdateVideoMetadata>;
