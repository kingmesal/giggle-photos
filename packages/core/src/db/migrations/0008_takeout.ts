import type { Kysely } from "kysely";

/**
 * Google Takeout awareness (RFD-003 steps 1-2): folder classification, JSON sidecars, and
 * media that belong together (motion/live pairs, original + edited).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("takeoutFolders")
    .ifNotExists()
    .addColumn("id", "integer", (col) => col.primaryKey().autoIncrement())
    .addColumn("scanFolderId", "integer", (col) => col.notNull().references("scanFolders.id").onDelete("cascade"))
    .addColumn("rootPath", "text", (col) => col.notNull())
    .addColumn("path", "text", (col) => col.notNull().unique())
    .addColumn("kind", "text", (col) => col.notNull())
    .addColumn("year", "integer")
    .addColumn("albumTitle", "text")
    .addColumn("createdAt", "integer", (col) => col.notNull())
    .addColumn("updatedAt", "integer", (col) => col.notNull())
    .execute();
  await db.schema
    .createIndex("idxTakeoutFoldersScanFolderId")
    .ifNotExists()
    .on("takeoutFolders")
    .column("scanFolderId")
    .execute();

  // SQLite allows ADD COLUMN with a foreign key when the column defaults to NULL.
  await db.schema
    .alterTable("mediaFiles")
    .addColumn("takeoutFolderId", "integer", (col) => col.references("takeoutFolders.id").onDelete("set null"))
    .execute();
  await db.schema
    .createIndex("idxMediaFilesTakeoutFolderId")
    .ifNotExists()
    .on("mediaFiles")
    .column("takeoutFolderId")
    .execute();

  await db.schema
    .createTable("sidecars")
    .ifNotExists()
    .addColumn("id", "integer", (col) => col.primaryKey().autoIncrement())
    .addColumn("scanFolderId", "integer", (col) => col.notNull().references("scanFolders.id").onDelete("cascade"))
    .addColumn("takeoutFolderId", "integer", (col) => col.references("takeoutFolders.id").onDelete("cascade"))
    .addColumn("path", "text", (col) => col.notNull().unique())
    .addColumn("kind", "text", (col) => col.notNull())
    .addColumn("title", "text")
    .addColumn("description", "text")
    .addColumn("photoTakenTime", "integer")
    .addColumn("geoLat", "real")
    .addColumn("geoLon", "real")
    .addColumn("geoAlt", "real")
    .addColumn("trashed", "integer", (col) => col.notNull().defaultTo(0))
    .addColumn("archived", "integer", (col) => col.notNull().defaultTo(0))
    .addColumn("favorited", "integer", (col) => col.notNull().defaultTo(0))
    .addColumn("people", "text", (col) => col.notNull().defaultTo("[]"))
    .addColumn("mediaFileId", "integer", (col) => col.references("mediaFiles.id").onDelete("set null"))
    .addColumn("matchMethod", "text")
    .addColumn("createdAt", "integer", (col) => col.notNull())
    .addColumn("updatedAt", "integer", (col) => col.notNull())
    .execute();
  await db.schema.createIndex("idxSidecarsMediaFileId").ifNotExists().on("sidecars").column("mediaFileId").execute();
  await db.schema
    .createIndex("idxSidecarsTakeoutFolderId")
    .ifNotExists()
    .on("sidecars")
    .column("takeoutFolderId")
    .execute();

  await db.schema
    .createTable("mediaPairs")
    .ifNotExists()
    .addColumn("id", "integer", (col) => col.primaryKey().autoIncrement())
    .addColumn("kind", "text", (col) => col.notNull())
    .addColumn("primaryFileId", "integer", (col) => col.notNull().references("mediaFiles.id").onDelete("cascade"))
    .addColumn("secondaryFileId", "integer", (col) => col.notNull().references("mediaFiles.id").onDelete("cascade"))
    .addColumn("createdAt", "integer", (col) => col.notNull())
    .addUniqueConstraint("uqMediaPairsPair", ["primaryFileId", "secondaryFileId"])
    .execute();
  await db.schema
    .createIndex("idxMediaPairsSecondaryFileId")
    .ifNotExists()
    .on("mediaPairs")
    .column("secondaryFileId")
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable("mediaPairs").ifExists().execute();
  await db.schema.dropTable("sidecars").ifExists().execute();
  await db.schema.dropIndex("idxMediaFilesTakeoutFolderId").ifExists().execute();
  await db.schema.alterTable("mediaFiles").dropColumn("takeoutFolderId").execute();
  await db.schema.dropTable("takeoutFolders").ifExists().execute();
}
