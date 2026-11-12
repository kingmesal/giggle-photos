import type { Kysely } from "kysely";
import { sql } from "kysely";

/**
 * Initial schema: scan_folders table and indexes.
 * Uses camelCase names; CamelCasePlugin converts to snake_case in the database.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("scanFolders")
    .ifNotExists()
    .addColumn("id", "integer", (col) => col.primaryKey().autoIncrement())
    .addColumn("path", "text", (col) => col.notNull().unique())
    .addColumn("priority", "integer", (col) => col.notNull().defaultTo(3).check(sql`priority >= 1 and priority <= 5`))
    .addColumn("status", "text", (col) =>
      col.notNull().defaultTo("added").check(sql`status in ('added', 'scanning', 'ready', 'error')`),
    )
    .addColumn("scanSubdirectories", "boolean", (col) => col.notNull().defaultTo(true))
    .addColumn("includeVideos", "boolean", (col) => col.notNull().defaultTo(true))
    .addColumn("imageCount", "integer", (col) => col.notNull().defaultTo(0))
    .addColumn("videoCount", "integer", (col) => col.notNull().defaultTo(0))
    .addColumn("totalSize", "integer", (col) => col.notNull().defaultTo(0))
    .addColumn("createdAt", "integer", (col) => col.notNull())
    .addColumn("updatedAt", "integer", (col) => col.notNull())
    .execute();

  await db.schema.createIndex("idxScanFoldersPath").ifNotExists().on("scanFolders").column("path").execute();

  await db.schema.createIndex("idxScanFoldersPriority").ifNotExists().on("scanFolders").column("priority").execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable("scanFolders").ifExists().execute();
}
