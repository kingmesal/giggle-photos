import type { Kysely } from "kysely";
import { sql } from "kysely";

/**
 * File decisions table.
 * Stores per-file-per-group user decisions (keep / delete).
 * UNIQUE on (mediaFileId, reviewGroupKey) ensures one decision per file per logical group.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("fileDecisions")
    .ifNotExists()
    .addColumn("id", "integer", (col) => col.primaryKey().autoIncrement())
    .addColumn("mediaFileId", "integer", (col) => col.notNull().references("mediaFiles.id").onDelete("cascade"))
    .addColumn("action", "text", (col) => col.notNull().check(sql`action IN ('keep', 'delete')`))
    .addColumn("method", "text", (col) => col.notNull().check(sql`method IN ('sha256', 'content_hash', 'phash')`))
    .addColumn("reviewGroupKey", "text", (col) => col.notNull())
    .addColumn("createdAt", "integer", (col) => col.notNull())
    .addUniqueConstraint("uqFileDecisionPerGroup", ["mediaFileId", "reviewGroupKey"])
    .execute();

  // Index for filtering by action (e.g., get all 'delete' decisions)
  await db.schema.createIndex("idxFileDecisionsAction").ifNotExists().on("fileDecisions").column("action").execute();

  // Index for filtering by method
  await db.schema.createIndex("idxFileDecisionsMethod").ifNotExists().on("fileDecisions").column("method").execute();

  // Index for filtering by reviewGroupKey
  await db.schema
    .createIndex("idxFileDecisionsReviewGroupKey")
    .ifNotExists()
    .on("fileDecisions")
    .column("reviewGroupKey")
    .execute();

  // Compound index for efficient cross-group exclusion queries
  await db.schema
    .createIndex("idxFileDecisionsMediaFileAction")
    .ifNotExists()
    .on("fileDecisions")
    .columns(["mediaFileId", "action"])
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable("fileDecisions").ifExists().execute();
}
