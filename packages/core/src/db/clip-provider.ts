import { blobToEmbedding, ClipEmbeddingRecord, embeddingToBlob, NewClipEmbedding } from "../zod/clip-embedding";
import { ClipMatch, ClipMatchRecord, NewClipMatch } from "../zod/clip-match";
import type { DatabaseInstance } from "./schema";

const CHUNK = 500;

/**
 * Provider for clipEmbeddings and clipMatches (RFD-002 §F). All writes are Zod-validated.
 */
export class ClipProvider {
  constructor(private db: DatabaseInstance) {}

  /** Insert or replace embeddings (unique per file, frame and model). */
  async upsertEmbeddings(rows: NewClipEmbedding[]): Promise<void> {
    if (rows.length === 0) return;
    const now = new Date();
    const records = rows.map((row) => {
      const valid = NewClipEmbedding.parse(row);
      return ClipEmbeddingRecord.parse({ ...valid, embedding: embeddingToBlob(valid.embedding), createdAt: now });
    });
    for (let i = 0; i < records.length; i += CHUNK) {
      await this.db
        .insertInto("clipEmbeddings")
        .values(records.slice(i, i + CHUNK))
        .onConflict((oc) =>
          oc.columns(["mediaFileId", "frameIndex", "modelId"]).doUpdateSet((eb) => ({
            embedding: eb.ref("excluded.embedding"),
            createdAt: eb.ref("excluded.createdAt"),
          })),
        )
        .execute();
    }
  }

  /** Analysed images (hashed or processed) that have no frame-0 embedding for `modelId`. */
  async getImagesMissingEmbedding(modelId: string, limit?: number): Promise<{ id: number; path: string }[]> {
    let query = this.db
      .selectFrom("mediaFiles as m")
      .select(["m.id", "m.path"])
      .where("m.fileType", "=", "image")
      .where("m.status", "in", ["hashed", "processed"])
      .where(({ not, exists, selectFrom }) =>
        not(
          exists(
            selectFrom("clipEmbeddings as e")
              .select("e.id")
              .whereRef("e.mediaFileId", "=", "m.id")
              .where("e.frameIndex", "=", 0)
              .where("e.modelId", "=", modelId),
          ),
        ),
      )
      .orderBy("m.id");
    if (limit !== undefined) query = query.limit(limit);
    const rows = await query.execute();
    return rows.map((r) => ({ id: Number(r.id), path: r.path }));
  }

  /** Videos with a known duration and no frame embeddings for `modelId` (RFD-002 §E). */
  async getVideosMissingFrames(modelId: string): Promise<{ id: number; path: string; durationSec: number }[]> {
    const rows = await this.db
      .selectFrom("mediaFiles as m")
      .innerJoin("videoMetadata as v", "v.mediaFileId", "m.id")
      .select(["m.id", "m.path", "v.duration"])
      .where("m.fileType", "=", "video")
      .where("v.duration", ">", 0)
      .where(({ not, exists, selectFrom }) =>
        not(
          exists(
            selectFrom("clipEmbeddings as e")
              .select("e.id")
              .whereRef("e.mediaFileId", "=", "m.id")
              .where("e.modelId", "=", modelId),
          ),
        ),
      )
      .orderBy("m.id")
      .execute();
    return rows.map((r) => ({ id: Number(r.id), path: r.path, durationSec: Number(r.duration) }));
  }

  /** Every video's frame embeddings (frames in position order) with its duration. */
  async loadVideoFrames(
    modelId: string,
    dimensions: number,
  ): Promise<{ id: number; durationSec: number; frames: Float32Array[] }[]> {
    const rows = await this.db
      .selectFrom("clipEmbeddings as e")
      .innerJoin("mediaFiles as m", "m.id", "e.mediaFileId")
      .innerJoin("videoMetadata as v", "v.mediaFileId", "m.id")
      .select(["e.mediaFileId", "e.frameIndex", "e.embedding", "v.duration"])
      .where("e.modelId", "=", modelId)
      .where("m.fileType", "=", "video")
      .orderBy("e.mediaFileId")
      .orderBy("e.frameIndex")
      .execute();
    const videos = new Map<number, { id: number; durationSec: number; frames: Float32Array[] }>();
    for (const row of rows) {
      const id = Number(row.mediaFileId);
      const v = blobToEmbedding(row.embedding);
      if (v.length !== dimensions) throw new Error(`Frame embedding for file ${id} has ${v.length} values`);
      let video = videos.get(id);
      if (!video) {
        video = { id, durationSec: Number(row.duration), frames: [] };
        videos.set(id, video);
      }
      video.frames.push(v);
    }
    return [...videos.values()];
  }

  async countEmbeddings(modelId: string): Promise<number> {
    const row = await this.db
      .selectFrom("clipEmbeddings")
      .select((eb) => eb.fn.countAll().as("n"))
      .where("modelId", "=", modelId)
      .executeTakeFirst();
    return Number(row?.n ?? 0);
  }

  /** All image embeddings for a model as one row-major matrix (ids ascending). Videos excluded. */
  async loadEmbeddings(modelId: string, dimensions: number): Promise<{ ids: number[]; vectors: Float32Array }> {
    const rows = await this.db
      .selectFrom("clipEmbeddings")
      .innerJoin("mediaFiles", "mediaFiles.id", "clipEmbeddings.mediaFileId")
      .select(["clipEmbeddings.mediaFileId", "clipEmbeddings.embedding"])
      .where("clipEmbeddings.modelId", "=", modelId)
      .where("clipEmbeddings.frameIndex", "=", 0)
      .where("mediaFiles.fileType", "=", "image")
      .orderBy("clipEmbeddings.mediaFileId")
      .execute();
    const vectors = new Float32Array(rows.length * dimensions);
    const ids: number[] = [];
    for (const [i, row] of rows.entries()) {
      const v = blobToEmbedding(row.embedding);
      if (v.length !== dimensions) throw new Error(`Embedding for file ${row.mediaFileId} has ${v.length} values`);
      vectors.set(v, i * dimensions);
      ids.push(Number(row.mediaFileId));
    }
    return { ids, vectors };
  }

  /** Replace all candidate pairs of a model atomically. */
  async replaceMatches(modelId: string, pairs: Omit<NewClipMatch, "modelId">[]): Promise<void> {
    const now = new Date();
    const records = pairs.map((p) => {
      const valid = NewClipMatch.parse({
        ...p,
        modelId,
        mediaFileId1: Math.min(p.mediaFileId1, p.mediaFileId2),
        mediaFileId2: Math.max(p.mediaFileId1, p.mediaFileId2),
      });
      return ClipMatchRecord.parse({ ...valid, createdAt: now });
    });
    await this.db.transaction().execute(async (trx) => {
      await trx.deleteFrom("clipMatches").where("modelId", "=", modelId).execute();
      for (let i = 0; i < records.length; i += CHUNK) {
        await trx
          .insertInto("clipMatches")
          .values(records.slice(i, i + CHUNK))
          .execute();
      }
    });
  }

  /** Pairs at or under `maxDistance` (the review slider), closest first. */
  async getMatches(modelId: string, maxDistance: number): Promise<ClipMatch[]> {
    const rows = await this.db
      .selectFrom("clipMatches")
      .selectAll()
      .where("modelId", "=", modelId)
      .where("distance", "<=", maxDistance)
      .orderBy("distance")
      .execute();
    return rows.map((r) => ClipMatch.parse(r));
  }

  async countMatches(modelId: string, maxDistance: number): Promise<number> {
    const row = await this.db
      .selectFrom("clipMatches")
      .select((eb) => eb.fn.countAll().as("n"))
      .where("modelId", "=", modelId)
      .where("distance", "<=", maxDistance)
      .executeTakeFirst();
    return Number(row?.n ?? 0);
  }
}
