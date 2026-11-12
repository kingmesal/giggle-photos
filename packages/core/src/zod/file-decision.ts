import type { Generated } from "kysely";
import { z } from "zod";
import { DateSchema, SQLDate } from "./util";

/**
 * Action a user can take on a file within a review group context.
 */
export const FileDecisionAction = z.union([
  z.literal("keep").describe("User confirmed this file should be kept"),
  z.literal("delete").describe("User confirmed this file is a duplicate and should be deleted"),
]);
export type FileDecisionAction = z.infer<typeof FileDecisionAction>;

/**
 * Detection method that created the review group.
 */
export const FileDecisionMethod = z.union([
  z.literal("sha256").describe("Exact file hash match"),
  z.literal("content_hash").describe("Image content hash (ignores metadata)"),
  z.literal("phash").describe("Perceptual hash (near-duplicate detection)"),
]);
export type FileDecisionMethod = z.infer<typeof FileDecisionMethod>;

/**
 * Domain model for a file decision.
 *
 * Stores a user's keep/delete decision for a specific
 * media file within a specific review group context.
 *
 * UNIQUE constraint on (mediaFileId, reviewGroupKey) ensures one decision
 * per file per logical group.
 */
export const FileDecision = z.object({
  id: z.number().int().positive(),
  mediaFileId: z.number().int().positive().describe("Foreign key to media_files"),
  action: FileDecisionAction,
  method: FileDecisionMethod.describe("Which detection method triggered review"),
  reviewGroupKey: z
    .string()
    .min(1)
    .describe("Group key: hash value for sha256/content_hash, 'phash:{anchorFileId}' for phash"),
  createdAt: DateSchema,
});
export type FileDecision = z.infer<typeof FileDecision>;

/**
 * Internal helper - domain model without id
 */
const FileDecisionNoId = FileDecision.omit({ id: true });

/**
 * Database record type with SQLite-compatible types.
 * Dates stored as integers (Unix timestamps).
 */
export const FileDecisionRecord = FileDecisionNoId.omit({
  createdAt: true,
}).extend({
  createdAt: SQLDate,
});
export type FileDecisionRecord = z.infer<typeof FileDecisionRecord> & {
  id: Generated<number>;
};

/**
 * Schema for inserting a new file decision (without auto-generated fields)
 */
export const NewFileDecision = FileDecisionNoId.omit({
  createdAt: true,
});
export type NewFileDecision = z.input<typeof NewFileDecision>;

/**
 * Schema for updating a file decision (partial, requires id)
 */
export const UpdateFileDecision = FileDecision.omit({
  createdAt: true,
})
  .partial()
  .required({ id: true });
export type UpdateFileDecision = z.infer<typeof UpdateFileDecision>;
