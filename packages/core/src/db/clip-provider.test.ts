import { Database as SqliteDatabase } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { CamelCasePlugin, Kysely } from "kysely";
import { BunSqliteDialect } from "kysely-bun-sqlite";
import { initializeDatabase } from "./client";
import { ClipProvider } from "./clip-provider";
import type { DatabaseSchema } from "./schema";

const MODEL = "test-model@1";
const D = 4;
let rawDb: SqliteDatabase;
let db: Kysely<DatabaseSchema>;
let clip: ClipProvider;
let ids: number[];

beforeEach(async () => {
  rawDb = new SqliteDatabase(":memory:");
  rawDb.run("PRAGMA foreign_keys = ON");
  db = new Kysely<DatabaseSchema>({
    dialect: new BunSqliteDialect({ database: rawDb }),
    plugins: [new CamelCasePlugin()],
  });
  await initializeDatabase(db, ":memory:");
  clip = new ClipProvider(db);
  const now = Date.now();
  const folder = await db
    .insertInto("scanFolders")
    .values({
      path: "/p",
      priority: 1,
      status: "ready",
      scanSubdirectories: 1,
      includeVideos: 1,
      imageCount: 0,
      videoCount: 0,
      totalSize: 0,
      createdAt: now,
      updatedAt: now,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  ids = [];
  for (const [i, status] of (["hashed", "hashed", "processed", "pending", "hashed"] as const).entries()) {
    const fileType = i === 4 ? "video" : "image";
    const row = await db
      .insertInto("mediaFiles")
      .values({
        scanFolderId: Number(folder.id),
        path: `/p/${i}`,
        filename: `${i}`,
        extension: "jpg",
        fileType,
        size: 1,
        status,
        createdAt: now,
        updatedAt: now,
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    ids.push(Number(row.id));
  }
});
afterEach(() => rawDb.close());

const vec = (...v: number[]) => Float32Array.from(v);

describe("ClipProvider", () => {
  test("embeddings round-trip as float32 BLOBs, ordered by file id", async () => {
    await clip.upsertEmbeddings([
      { mediaFileId: ids[1] as number, modelId: MODEL, embedding: vec(0, 1, 0, 0) },
      { mediaFileId: ids[0] as number, modelId: MODEL, embedding: vec(0.5, 0.5, 0.5, 0.5) },
    ]);
    const { ids: loaded, vectors } = await clip.loadEmbeddings(MODEL, D);
    expect(loaded).toEqual([ids[0], ids[1]]);
    expect(Array.from(vectors)).toEqual([0.5, 0.5, 0.5, 0.5, 0, 1, 0, 0]);
  });

  test("upsert replaces an existing embedding for the same file, frame and model", async () => {
    await clip.upsertEmbeddings([{ mediaFileId: ids[0] as number, modelId: MODEL, embedding: vec(1, 0, 0, 0) }]);
    await clip.upsertEmbeddings([{ mediaFileId: ids[0] as number, modelId: MODEL, embedding: vec(0, 0, 0, 1) }]);
    expect(await clip.countEmbeddings(MODEL)).toBe(1);
    expect(Array.from((await clip.loadEmbeddings(MODEL, D)).vectors)).toEqual([0, 0, 0, 1]);
  });

  test("missing embeddings: analysed images only, per model", async () => {
    await clip.upsertEmbeddings([{ mediaFileId: ids[0] as number, modelId: MODEL, embedding: vec(1, 0, 0, 0) }]);
    const missing = await clip.getImagesMissingEmbedding(MODEL);
    // ids[1] hashed, ids[2] processed; ids[3] is still pending, ids[4] is a video.
    expect(missing.map((m) => m.id)).toEqual([ids[1], ids[2]]);
    expect((await clip.getImagesMissingEmbedding("other-model")).map((m) => m.id)).toEqual([ids[0], ids[1], ids[2]]);
  });

  test("matches are replaced per model, normalised, and filtered by the review threshold", async () => {
    await clip.replaceMatches(MODEL, [
      { mediaFileId1: ids[2] as number, mediaFileId2: ids[0] as number, distance: 0.05 },
      { mediaFileId1: ids[0] as number, mediaFileId2: ids[1] as number, distance: 0.01 },
    ]);
    const close = await clip.getMatches(MODEL, 0.02);
    expect(close.map((m) => [m.mediaFileId1, m.mediaFileId2])).toEqual([[ids[0], ids[1]]]);
    expect((await clip.getMatches(MODEL, 0.12)).map((m) => m.mediaFileId1 < m.mediaFileId2)).toEqual([true, true]);
    await clip.replaceMatches(MODEL, []);
    expect(await clip.countMatches(MODEL, 2)).toBe(0);
  });

  test("deleting a media file removes its embedding and matches", async () => {
    await clip.upsertEmbeddings([{ mediaFileId: ids[0] as number, modelId: MODEL, embedding: vec(1, 0, 0, 0) }]);
    await clip.replaceMatches(MODEL, [
      { mediaFileId1: ids[0] as number, mediaFileId2: ids[1] as number, distance: 0.01 },
    ]);
    await db
      .deleteFrom("mediaFiles")
      .where("id", "=", ids[0] as number)
      .execute();
    expect(await clip.countEmbeddings(MODEL)).toBe(0);
    expect(await clip.countMatches(MODEL, 2)).toBe(0);
  });

  test("invalid distances are rejected before reaching the database", async () => {
    await expect(
      clip.replaceMatches(MODEL, [{ mediaFileId1: ids[0] as number, mediaFileId2: ids[1] as number, distance: 3 }]),
    ).rejects.toThrow();
  });
});
