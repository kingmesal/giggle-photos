import type { Generated } from "kysely";
import { z } from "zod";
import { DateSchema, SQLDate } from "./util";

/** motion: still + companion video (decided together, never split); edited: original + edited copy. */
export const MediaPairKind = z.enum(["motion", "edited"]);
export type MediaPairKind = z.infer<typeof MediaPairKind>;

/** Domain model: two media files that belong together (RFD-003 §D). Immutable: createdAt only. */
export const MediaPair = z.object({
  id: z.number().int().positive(),
  kind: MediaPairKind,
  primaryFileId: z.number().int().positive().describe("Still (motion) or original (edited)"),
  secondaryFileId: z.number().int().positive().describe("Video (motion) or edited copy (edited)"),
  createdAt: DateSchema,
});
export type MediaPair = z.infer<typeof MediaPair>;

const MediaPairNoId = MediaPair.omit({ id: true });

export const MediaPairRecord = MediaPairNoId.omit({ createdAt: true }).extend({ createdAt: SQLDate });
export type MediaPairRecord = z.infer<typeof MediaPairRecord> & { id: Generated<number> };

export const NewMediaPair = MediaPairNoId.omit({ createdAt: true });
export type NewMediaPair = z.input<typeof NewMediaPair>;

export const UpdateMediaPair = MediaPair.omit({ createdAt: true }).partial().required({ id: true });
export type UpdateMediaPair = z.infer<typeof UpdateMediaPair>;
