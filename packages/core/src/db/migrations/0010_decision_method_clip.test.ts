import { Database as SqliteDatabase } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { CamelCasePlugin, Kysely, Migrator } from "kysely";
import { BunSqliteDialect } from "kysely-bun-sqlite";
import { migrations } from "./index";

// biome-ignore lint/suspicious/noExplicitAny: exercising migrations on an untyped schema
let db: Kysely<any>;
let raw: SqliteDatabase;
let migrator: Migrator;

const decision = (mediaFileId: number, method: string, reviewGroupKey: string) =>
  db
    .insertInto("fileDecisions")
    .values({ mediaFileId, action: "delete", method, reviewGroupKey, createdAt: 1 })
    .execute();

beforeEach(async () => {
  raw = new SqliteDatabase(":memory:");
  raw.run("PRAGMA foreign_keys = ON");
  db = new Kysely({ dialect: new BunSqliteDialect({ database: raw }), plugins: [new CamelCasePlugin()] });
  migrator = new Migrator({ db, provider: { getMigrations: () => Promise.resolve(migrations) } });
  expect((await migrator.migrateTo("0009_clip")).error).toBeUndefined();
  await db.insertInto("scanFolders").values({ path: "/lib", priority: 1, createdAt: 1, updatedAt: 1 }).execute();
  for (const id of [1, 2]) {
    await db
      .insertInto("mediaFiles")
      .values({
        id,
        scanFolderId: 1,
        path: `/lib/${id}.jpg`,
        filename: `${id}.jpg`,
        extension: "jpg",
        fileType: "image",
        size: 1,
        status: "processed",
        createdAt: 1,
        updatedAt: 1,
      })
      .execute();
  }
});
afterEach(() => raw.close());

describe("0010_decision_method_clip", () => {
  test("before: clip decisions are refused by the CHECK constraint", async () => {
    await expect(decision(1, "clip", "clip:1")).rejects.toThrow(/CHECK/);
  });

  test("up keeps every existing decision, accepts clip, and recreates the indexes", async () => {
    await decision(1, "sha256", "abc");
    await decision(2, "phash", "phash:1");
    expect((await migrator.migrateToLatest()).error).toBeUndefined();
    await decision(1, "clip", "clip:1");
    const rows = await db.selectFrom("fileDecisions").select(["mediaFileId", "method", "reviewGroupKey"]).execute();
    expect(rows).toEqual([
      { mediaFileId: 1, method: "sha256", reviewGroupKey: "abc" },
      { mediaFileId: 2, method: "phash", reviewGroupKey: "phash:1" },
      { mediaFileId: 1, method: "clip", reviewGroupKey: "clip:1" },
    ]);
    await expect(decision(1, "clip", "clip:1")).rejects.toThrow(/UNIQUE/);
    await expect(decision(1, "bogus", "x")).rejects.toThrow(/CHECK/);
    const indexes = raw
      .query("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'file_decisions' AND sql IS NOT NULL")
      .all()
      .map((r) => (r as { name: string }).name)
      .sort();
    expect(indexes).toEqual([
      "idx_file_decisions_action",
      "idx_file_decisions_media_file_action",
      "idx_file_decisions_method",
      "idx_file_decisions_review_group_key",
    ]);
  });

  test("decisions still cascade away with their file", async () => {
    expect((await migrator.migrateToLatest()).error).toBeUndefined();
    await decision(1, "clip", "clip:1");
    await db.deleteFrom("mediaFiles").where("id", "=", 1).execute();
    expect(await db.selectFrom("fileDecisions").select("id").execute()).toEqual([]);
  });

  test("down drops clip decisions and keeps the rest", async () => {
    expect((await migrator.migrateToLatest()).error).toBeUndefined();
    await decision(1, "sha256", "abc");
    await decision(2, "clip", "clip:1");
    expect((await migrator.migrateDown()).error).toBeUndefined();
    const rows = await db.selectFrom("fileDecisions").select(["mediaFileId", "method"]).execute();
    expect(rows).toEqual([{ mediaFileId: 1, method: "sha256" }]);
  });
});
