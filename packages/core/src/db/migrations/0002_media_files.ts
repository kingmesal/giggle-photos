import type { Kysely } from "kysely";
import { sql } from "kysely";

/**
 * Media files table for storing discovered images and videos.
 * Each file belongs to a scan folder and tracks processing status and hashes.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("mediaFiles")
    .ifNotExists()
    .addColumn("id", "integer", (col) => col.primaryKey().autoIncrement())
    .addColumn("scanFolderId", "integer", (col) => col.notNull().references("scanFolders.id").onDelete("cascade"))
    .addColumn("path", "text", (col) => col.notNull().unique())
    .addColumn("filename", "text", (col) => col.notNull())
    .addColumn("extension", "text", (col) => col.notNull())
    // Raw sql in CHECK is not transformed by CamelCasePlugin; use DB column name (snake_case).
    .addColumn("fileType", "text", (col) => col.notNull().check(sql`file_type in ('image', 'video')`))
    .addColumn("size", "integer", (col) => col.notNull().defaultTo(0))
    .addColumn("status", "text", (col) =>
      col.notNull().defaultTo("pending").check(sql`status in ('pending', 'metadata', 'hashed', 'processed', 'error')`),
    )
    .addColumn("sha256Hash", "text")
    .addColumn("contentHash", "text")
    .addColumn("perceptualHash", "text")
    .addColumn("errorMessage", "text")
    .addColumn("createdAt", "integer", (col) => col.notNull())
    .addColumn("updatedAt", "integer", (col) => col.notNull())
    .execute();

  // Index for looking up files by folder
  await db.schema
    .createIndex("idxMediaFilesScanFolderId")
    .ifNotExists()
    .on("mediaFiles")
    .column("scanFolderId")
    .execute();

  // Index for finding files by status (for batch processing)
  await db.schema.createIndex("idxMediaFilesStatus").ifNotExists().on("mediaFiles").column("status").execute();

  // Index for finding duplicates by SHA-256
  await db.schema.createIndex("idxMediaFilesSha256Hash").ifNotExists().on("mediaFiles").column("sha256Hash").execute();

  // Index for finding duplicates by content hash
  await db.schema
    .createIndex("idxMediaFilesContentHash")
    .ifNotExists()
    .on("mediaFiles")
    .column("contentHash")
    .execute();

  // Index for finding near-duplicates by perceptual hash
  await db.schema
    .createIndex("idxMediaFilesPerceptualHash")
    .ifNotExists()
    .on("mediaFiles")
    .column("perceptualHash")
    .execute();

  // Compound index for file type + status (common query pattern)
  await db.schema
    .createIndex("idxMediaFilesTypeStatus")
    .ifNotExists()
    .on("mediaFiles")
    .columns(["fileType", "status"])
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable("mediaFiles").ifExists().execute();
}
