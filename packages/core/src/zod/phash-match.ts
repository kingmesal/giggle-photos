import type { Generated } from "kysely";
import { z } from "zod";
import { DateSchema, SQLDate } from "./util";

/**
 * Domain model for a pHash match (pairwise hamming distance).
 *
 * Stores the raw hamming distance between two perceptual hashes.
 * mediaFileId1 < mediaFileId2 is enforced at the DB level so each
 * pair is stored exactly once (A→B = B→A).
 * Rows are immutable — only createdAt, no updatedAt.
 */
export const PhashMatch = z.object({
  id: z.number().int().positive(),
  mediaFileId1: z.number().int().positive().describe("Foreign key to media_files (lower id)"),
  mediaFileId2: z.number().int().positive().describe("Foreign key to media_files (higher id)"),
  distance: z.number().int().min(0).max(64).describe("Hamming distance between perceptual hashes (0-64)"),
  createdAt: DateSchema,
});
export type PhashMatch = z.infer<typeof PhashMatch>;

/**
 * Internal helper - domain model without id
 */
const PhashMatchNoId = PhashMatch.omit({ id: true });

/**
 * Database record type with SQLite-compatible types.
 * Dates stored as integers (Unix timestamps).
 */
export const PhashMatchRecord = PhashMatchNoId.omit({
  createdAt: true,
}).extend({
  createdAt: SQLDate,
});
export type PhashMatchRecord = z.infer<typeof PhashMatchRecord> & {
  id: Generated<number>;
};

/**
 * Schema for inserting a new pHash match (without auto-generated fields)
 */
export const NewPhashMatch = PhashMatchNoId.omit({
  createdAt: true,
});
export type NewPhashMatch = z.input<typeof NewPhashMatch>;

/**
 * Schema for updating a pHash match (partial with required id).
 * Note: Updates are unlikely for this table, but included for pattern consistency.
 */
export const UpdatePhashMatch = PhashMatch.omit({
  createdAt: true,
})
  .partial()
  .required({ id: true });
export type UpdatePhashMatch = z.infer<typeof UpdatePhashMatch>;
