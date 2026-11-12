import type { Kysely } from "kysely";

/**
 * Video metadata table for storing extracted video information.
 * Each video file has at most one metadata record (unique constraint on mediaFileId).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("videoMetadata")
    .ifNotExists()
    .addColumn("id", "integer", (col) => col.primaryKey().autoIncrement())
    .addColumn("mediaFileId", "integer", (col) =>
      col.notNull().references("mediaFiles.id").onDelete("cascade").unique(),
    )
    .addColumn("width", "integer", (col) => col.notNull())
    .addColumn("height", "integer", (col) => col.notNull())
    .addColumn("duration", "real", (col) => col.notNull())
    .addColumn("frameRate", "real")
    .addColumn("codec", "text")
    .addColumn("audioCodec", "text")
    .addColumn("bitrate", "integer")
    .addColumn("dateTaken", "integer")
    .addColumn("createdAt", "integer", (col) => col.notNull())
    .addColumn("updatedAt", "integer", (col) => col.notNull())
    .execute();

  // Index for looking up metadata by media file
  await db.schema
    .createIndex("idxVideoMetadataMediaFileId")
    .ifNotExists()
    .on("videoMetadata")
    .column("mediaFileId")
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable("videoMetadata").ifExists().execute();
}
