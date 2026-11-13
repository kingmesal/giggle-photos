import type { Generated } from "kysely";
import { z } from "zod";
import { DateSchema, SQLDate } from "./util";

/**
 * Domain model: a CLIP near-duplicate candidate pair (RFD-002 §D). Stored for every pair up to the
 * storage cutoff, so moving the review slider never needs a recompute. mediaFileId1 < mediaFileId2.
 * Review-only: never preselected for deletion (RFD-002 §G). Immutable: createdAt only.
 */
export const ClipMatch = z.object({
  id: z.number().int().positive(),
  mediaFileId1: z.number().int().positive(),
  mediaFileId2: z.number().int().positive(),
  modelId: z.string().min(1),
  distance: z.number().min(0).max(2).describe("Cosine distance (1 − similarity)"),
  createdAt: DateSchema,
});
export type ClipMatch = z.infer<typeof ClipMatch>;

const ClipMatchNoId = ClipMatch.omit({ id: true });

export const ClipMatchRecord = ClipMatchNoId.omit({ createdAt: true }).extend({ createdAt: SQLDate });
export type ClipMatchRecord = z.infer<typeof ClipMatchRecord> & { id: Generated<number> };

export const NewClipMatch = ClipMatchNoId.omit({ createdAt: true });
export type NewClipMatch = z.input<typeof NewClipMatch>;

export const UpdateClipMatch = ClipMatch.omit({ createdAt: true }).partial().required({ id: true });
export type UpdateClipMatch = z.infer<typeof UpdateClipMatch>;
