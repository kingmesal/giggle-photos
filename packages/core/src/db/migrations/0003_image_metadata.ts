import type { Kysely } from "kysely";

/**
 * Image metadata table for storing EXIF and technical image properties.
 * One-to-one relationship with media_files (unique constraint on mediaFileId).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("imageMetadata")
    .ifNotExists()
    .addColumn("id", "integer", (col) => col.primaryKey().autoIncrement())
    .addColumn("mediaFileId", "integer", (col) =>
      col.notNull().unique().references("mediaFiles.id").onDelete("cascade"),
    )
    .addColumn("width", "integer", (col) => col.notNull())
    .addColumn("height", "integer", (col) => col.notNull())
    .addColumn("format", "text", (col) => col.notNull())
    .addColumn("colorSpace", "text")
    .addColumn("hasAlpha", "integer", (col) => col.notNull().defaultTo(0))
    .addColumn("orientation", "integer")
    .addColumn("dateTaken", "integer")
    .addColumn("cameraMake", "text")
    .addColumn("cameraModel", "text")
    .addColumn("gpsLatitude", "real")
    .addColumn("gpsLongitude", "real")
    .addColumn("gpsAltitude", "real")
    .addColumn("createdAt", "integer", (col) => col.notNull())
    .addColumn("updatedAt", "integer", (col) => col.notNull())
    .execute();

  // Index for looking up metadata by media file (though unique constraint already creates an index)
  await db.schema
    .createIndex("idxImageMetadataMediaFileId")
    .ifNotExists()
    .on("imageMetadata")
    .column("mediaFileId")
    .execute();

  // Index for querying by format
  await db.schema.createIndex("idxImageMetadataFormat").ifNotExists().on("imageMetadata").column("format").execute();

  // Index for querying by dimensions (useful for finding similar-sized images)
  await db.schema
    .createIndex("idxImageMetadataDimensions")
    .ifNotExists()
    .on("imageMetadata")
    .columns(["width", "height"])
    .execute();

  // Index for querying by camera (for grouping photos by device)
  await db.schema
    .createIndex("idxImageMetadataCamera")
    .ifNotExists()
    .on("imageMetadata")
    .columns(["cameraMake", "cameraModel"])
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable("imageMetadata").ifExists().execute();
}
