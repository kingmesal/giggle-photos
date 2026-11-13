import type { Kysely } from "kysely";
import { sql } from "kysely";

/** CLIP embeddings and candidate pairs (RFD-002 §F). */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("clipEmbeddings")
    .ifNotExists()
    .addColumn("id", "integer", (col) => col.primaryKey().autoIncrement())
    .addColumn("mediaFileId", "integer", (col) => col.notNull().references("mediaFiles.id").onDelete("cascade"))
    .addColumn("frameIndex", "integer", (col) => col.notNull().defaultTo(0))
    .addColumn("modelId", "text", (col) => col.notNull())
    .addColumn("embedding", "blob", (col) => col.notNull())
    .addColumn("createdAt", "integer", (col) => col.notNull())
    .addUniqueConstraint("uqClipEmbeddingsFileFrameModel", ["mediaFileId", "frameIndex", "modelId"])
    .execute();
  await db.schema
    .createIndex("idxClipEmbeddingsModelId")
    .ifNotExists()
    .on("clipEmbeddings")
    .column("modelId")
    .execute();

  await db.schema
    .createTable("clipMatches")
    .ifNotExists()
    .addColumn("id", "integer", (col) => col.primaryKey().autoIncrement())
    .addColumn("mediaFileId1", "integer", (col) => col.notNull().references("mediaFiles.id").onDelete("cascade"))
    .addColumn("mediaFileId2", "integer", (col) => col.notNull().references("mediaFiles.id").onDelete("cascade"))
    .addColumn("modelId", "text", (col) => col.notNull())
    .addColumn("distance", "real", (col) => col.notNull().check(sql`distance >= 0 AND distance <= 2`))
    .addColumn("createdAt", "integer", (col) => col.notNull())
    .addCheckConstraint("ckClipMatchesOrdering", sql`media_file_id1 < media_file_id2`)
    .addUniqueConstraint("uqClipMatchesPairModel", ["mediaFileId1", "mediaFileId2", "modelId"])
    .execute();
  await db.schema
    .createIndex("idxClipMatchesMediaFileId1")
    .ifNotExists()
    .on("clipMatches")
    .column("mediaFileId1")
    .execute();
  await db.schema
    .createIndex("idxClipMatchesMediaFileId2")
    .ifNotExists()
    .on("clipMatches")
    .column("mediaFileId2")
    .execute();
  await db.schema.createIndex("idxClipMatchesDistance").ifNotExists().on("clipMatches").column("distance").execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable("clipMatches").ifExists().execute();
  await db.schema.dropTable("clipEmbeddings").ifExists().execute();
}
