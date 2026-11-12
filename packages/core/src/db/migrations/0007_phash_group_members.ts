import type { Kysely } from "kysely";

/**
 * Pre-computed pHash group membership table.
 * Stores connected components from phashMatches so the review layer
 * can query groups with simple indexed lookups instead of rebuilding
 * Union-Find on every request.
 *
 * Populated after duplicate detection and after file deletions.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("phashGroupMembers")
    .ifNotExists()
    .addColumn("id", "integer", (col) => col.primaryKey().autoIncrement())
    .addColumn("mediaFileId", "integer", (col) =>
      col.notNull().references("mediaFiles.id").onDelete("cascade").unique(),
    )
    .addColumn("groupAnchorFileId", "integer", (col) => col.notNull())
    .addColumn("groupMinDistance", "integer", (col) => col.notNull())
    .addColumn("createdAt", "integer", (col) => col.notNull())
    .execute();

  await db.schema
    .createIndex("idxPhashGroupMembersAnchor")
    .ifNotExists()
    .on("phashGroupMembers")
    .column("groupAnchorFileId")
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable("phashGroupMembers").ifExists().execute();
}
