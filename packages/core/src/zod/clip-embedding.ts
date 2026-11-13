import type { Generated } from "kysely";
import { z } from "zod";
import { DateSchema, SQLDate } from "./util";

/**
 * Domain model: one CLIP embedding (RFD-002 §F). frameIndex is 0 for images (video frames later).
 * modelId ties it to the model that produced it; embeddings of different models are never compared.
 */
export const ClipEmbedding = z.object({
  id: z.number().int().positive(),
  mediaFileId: z.number().int().positive().describe("Foreign key to media_files"),
  frameIndex: z.number().int().nonnegative().default(0),
  modelId: z.string().min(1),
  embedding: z.instanceof(Float32Array).describe("L2-normalised vector"),
  createdAt: DateSchema,
});
export type ClipEmbedding = z.infer<typeof ClipEmbedding>;

const ClipEmbeddingNoId = ClipEmbedding.omit({ id: true });

/** SQLite record: the vector as a little-endian float32 BLOB. */
export const ClipEmbeddingRecord = ClipEmbeddingNoId.omit({ embedding: true, createdAt: true }).extend({
  embedding: z.instanceof(Uint8Array),
  createdAt: SQLDate,
});
export type ClipEmbeddingRecord = z.infer<typeof ClipEmbeddingRecord> & { id: Generated<number> };

export const NewClipEmbedding = ClipEmbeddingNoId.omit({ createdAt: true });
export type NewClipEmbedding = z.input<typeof NewClipEmbedding>;

export const UpdateClipEmbedding = ClipEmbedding.omit({ createdAt: true }).partial().required({ id: true });
export type UpdateClipEmbedding = z.infer<typeof UpdateClipEmbedding>;

/** Float32Array → BLOB bytes (copy, so later changes to the vector cannot alias the row). */
export const embeddingToBlob = (v: Float32Array): Uint8Array =>
  new Uint8Array(v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength));
/** BLOB bytes → Float32Array (copy, aligned). */
export const blobToEmbedding = (b: Uint8Array): Float32Array =>
  new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
