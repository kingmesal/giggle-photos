import type { Kysely } from "kysely";
import { sql } from "kysely";

/**
 * Pairwise pHash distance table.
 * Stores raw hamming distances between perceptual hashes.
 * Enforces mediaFileId1 < mediaFileId2 so each pair is stored exactly once.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("phashMatches")
    .ifNotExists()
    .addColumn("id", "integer", (col) => col.primaryKey().autoIncrement())
    .addColumn("mediaFileId1", "integer", (col) => col.notNull().references("mediaFiles.id").onDelete("cascade"))
    .addColumn("mediaFileId2", "integer", (col) => col.notNull().references("mediaFiles.id").onDelete("cascade"))
    .addColumn("distance", "integer", (col) => col.notNull().check(sql`distance >= 0 AND distance <= 64`))
    .addColumn("createdAt", "integer", (col) => col.notNull())
    .addCheckConstraint("ckPhashMatchesOrdering", sql`media_file_id1 < media_file_id2`)
    .addUniqueConstraint("uqPhashMatchesPair", ["mediaFileId1", "mediaFileId2"])
    .execute();

  // Index for looking up matches by first file
  await db.schema
    .createIndex("idxPhashMatchesMediaFileId1")
    .ifNotExists()
    .on("phashMatches")
    .column("mediaFileId1")
    .execute();

  // Index for looking up matches by second file
  await db.schema
    .createIndex("idxPhashMatchesMediaFileId2")
    .ifNotExists()
    .on("phashMatches")
    .column("mediaFileId2")
    .execute();

  // Index for querying by distance threshold
  await db.schema.createIndex("idxPhashMatchesDistance").ifNotExists().on("phashMatches").column("distance").execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable("phashMatches").ifExists().execute();
}
