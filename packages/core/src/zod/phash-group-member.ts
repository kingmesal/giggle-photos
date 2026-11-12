import type { Generated } from "kysely";
import { z } from "zod";
import { DateSchema, SQLDate } from "./util";

/**
 * Domain model for a pHash group member.
 *
 * Each row records that a media file belongs to a connected component
 * (group) in the pHash match graph. The group is identified by its
 * anchor — the lowest file ID in the component.
 *
 * Rows are immutable — only createdAt, no updatedAt.
 * The table is truncated and repopulated when groups change.
 */
export const PhashGroupMember = z.object({
  id: z.number().int().positive(),
  mediaFileId: z.number().int().positive().describe("Foreign key to media_files"),
  groupAnchorFileId: z.number().int().positive().describe("Lowest file ID in the connected component"),
  groupMinDistance: z.number().int().min(0).max(64).describe("Minimum hamming distance within the group"),
  createdAt: DateSchema,
});
export type PhashGroupMember = z.infer<typeof PhashGroupMember>;

/**
 * Internal helper - domain model without id
 */
const PhashGroupMemberNoId = PhashGroupMember.omit({ id: true });

/**
 * Database record type with SQLite-compatible types.
 * Dates stored as integers (Unix timestamps).
 */
export const PhashGroupMemberRecord = PhashGroupMemberNoId.omit({
  createdAt: true,
}).extend({
  createdAt: SQLDate,
});
export type PhashGroupMemberRecord = z.infer<typeof PhashGroupMemberRecord> & {
  id: Generated<number>;
};

/**
 * Schema for inserting a new pHash group member (without auto-generated fields)
 */
export const NewPhashGroupMember = PhashGroupMemberNoId.omit({
  createdAt: true,
});
export type NewPhashGroupMember = z.input<typeof NewPhashGroupMember>;

/**
 * Schema for updating a pHash group member (partial with required id).
 * Note: Updates are unlikely — table is truncated and repopulated.
 */
export const UpdatePhashGroupMember = PhashGroupMember.omit({
  createdAt: true,
})
  .partial()
  .required({ id: true });
export type UpdatePhashGroupMember = z.infer<typeof UpdatePhashGroupMember>;
