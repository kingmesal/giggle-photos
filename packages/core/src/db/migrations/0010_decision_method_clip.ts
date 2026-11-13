// ⚠️ FRAGILE: See _FRAGILE.md — rebuilds fileDecisions (user review decisions).
import type { Kysely } from "kysely";
import { sql } from "kysely";

/**
 * Allow `method = 'clip'` on fileDecisions (RFD-002 §F: CLIP review groups, key `clip:{anchor}`).
 * SQLite cannot alter a CHECK constraint, so the table is rebuilt: create the new shape, copy every
 * row, drop the old table (and its indexes), rename, and recreate the indexes. Nothing references
 * fileDecisions, so the swap is safe with foreign keys on.
 */
const COLUMNS = ["id", "mediaFileId", "action", "method", "reviewGroupKey", "createdAt"] as const;

// biome-ignore lint/suspicious/noExplicitAny: migrations run against an untyped schema
async function rebuild(db: Kysely<any>, methods: readonly string[]): Promise<void> {
  const allowed = sql.join(methods.map((m) => sql.lit(m)));
  await db.schema
    .createTable("fileDecisionsNext")
    .addColumn("id", "integer", (col) => col.primaryKey().autoIncrement())
    .addColumn("mediaFileId", "integer", (col) => col.notNull().references("mediaFiles.id").onDelete("cascade"))
    .addColumn("action", "text", (col) => col.notNull().check(sql`action IN ('keep', 'delete')`))
    .addColumn("method", "text", (col) => col.notNull().check(sql`method IN (${allowed})`))
    .addColumn("reviewGroupKey", "text", (col) => col.notNull())
    .addColumn("createdAt", "integer", (col) => col.notNull())
    .addUniqueConstraint("uqFileDecisionPerGroupNext", ["mediaFileId", "reviewGroupKey"])
    .execute();
  await db
    .insertInto("fileDecisionsNext")
    .columns([...COLUMNS])
    .expression(
      db
        .selectFrom("fileDecisions")
        .select([...COLUMNS])
        .where("method", "in", [...methods]),
    )
    .execute();
  await db.schema.dropTable("fileDecisions").execute();
  await db.schema.alterTable("fileDecisionsNext").renameTo("fileDecisions").execute();

  const index = (name: string, columns: string[]) =>
    db.schema.createIndex(name).ifNotExists().on("fileDecisions").columns(columns).execute();
  await index("idxFileDecisionsAction", ["action"]);
  await index("idxFileDecisionsMethod", ["method"]);
  await index("idxFileDecisionsReviewGroupKey", ["reviewGroupKey"]);
  await index("idxFileDecisionsMediaFileAction", ["mediaFileId", "action"]);
}

export async function up(db: Kysely<unknown>): Promise<void> {
  await rebuild(db, ["sha256", "content_hash", "phash", "clip"]);
}

/** Back to the old constraint; CLIP decisions are dropped (they cannot be stored there). */
export async function down(db: Kysely<unknown>): Promise<void> {
  await rebuild(db, ["sha256", "content_hash", "phash"]);
}
