import { Database as SqliteDatabase } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { CamelCasePlugin, Kysely } from "kysely";
import { BunSqliteDialect } from "kysely-bun-sqlite";
import { initializeDatabase } from "./client";
import type { DatabaseSchema } from "./schema";

/**
 * Integration tests for CASCADE deletion behavior.
 * Verifies that deleting a scan folder cascades to all downstream records:
 *   scanFolders → mediaFiles → imageMetadata, videoMetadata, phashMatches, fileDecisions, phashGroupMembers
 *
 * IMPORTANT: These tests require PRAGMA foreign_keys = ON.
 * SQLite disables foreign keys by default.
 */

function createTestDb(): { kysely: Kysely<DatabaseSchema>; rawDb: SqliteDatabase } {
  const sqliteDb = new SqliteDatabase(":memory:");
  sqliteDb.run("PRAGMA foreign_keys = ON");
  const kysely = new Kysely<DatabaseSchema>({
    dialect: new BunSqliteDialect({ database: sqliteDb }),
    plugins: [new CamelCasePlugin()],
  });
  return { kysely, rawDb: sqliteDb };
}

/** Helper to count rows in a table using raw SQL (bypasses CamelCasePlugin) */
function countRows(rawDb: SqliteDatabase, tableName: string): number {
  const result = rawDb.prepare(`SELECT COUNT(*) as cnt FROM ${tableName}`).get() as { cnt: number };
  return result.cnt;
}

describe("Cascade Deletion", () => {
  let db: Kysely<DatabaseSchema>;
  let rawDb: SqliteDatabase;

  beforeEach(async () => {
    const dbResult = createTestDb();
    db = dbResult.kysely;
    rawDb = dbResult.rawDb;
    await initializeDatabase(db, ":memory:");
  });

  afterEach(() => {
    if (rawDb) rawDb.close();
    db = null as unknown as Kysely<DatabaseSchema>;
  });

  test("PRAGMA foreign_keys is ON", () => {
    const result = rawDb.prepare("PRAGMA foreign_keys").get() as { foreign_keys: number };
    expect(result.foreign_keys).toBe(1);
  });

  test("deleting a scan folder cascades to media files", async () => {
    // Insert scan folder
    const folder = await db
      .insertInto("scanFolders")
      .values({
        path: "/test/photos",
        priority: 1,
        status: "ready",
        scanSubdirectories: 1,
        includeVideos: 1,
        imageCount: 0,
        videoCount: 0,
        totalSize: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    // Insert media files
    const now = Date.now();
    await db
      .insertInto("mediaFiles")
      .values({
        scanFolderId: folder.id,
        path: "/test/photos/a.jpg",
        filename: "a.jpg",
        extension: "jpg",
        fileType: "image",
        size: 1000,
        status: "processed",
        createdAt: now,
        updatedAt: now,
      })
      .execute();
    await db
      .insertInto("mediaFiles")
      .values({
        scanFolderId: folder.id,
        path: "/test/photos/b.jpg",
        filename: "b.jpg",
        extension: "jpg",
        fileType: "image",
        size: 2000,
        status: "processed",
        createdAt: now,
        updatedAt: now,
      })
      .execute();

    expect(countRows(rawDb, "media_files")).toBe(2);

    // Delete scan folder
    await db.deleteFrom("scanFolders").where("id", "=", folder.id).execute();

    expect(countRows(rawDb, "scan_folders")).toBe(0);
    expect(countRows(rawDb, "media_files")).toBe(0);
  });

  test("deleting a scan folder cascades to image metadata", async () => {
    const folder = await db
      .insertInto("scanFolders")
      .values({
        path: "/test/imgs",
        priority: 1,
        status: "ready",
        scanSubdirectories: 1,
        includeVideos: 1,
        imageCount: 0,
        videoCount: 0,
        totalSize: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    const now = Date.now();
    const file = await db
      .insertInto("mediaFiles")
      .values({
        scanFolderId: folder.id,
        path: "/test/imgs/photo.jpg",
        filename: "photo.jpg",
        extension: "jpg",
        fileType: "image",
        size: 5000,
        status: "processed",
        createdAt: now,
        updatedAt: now,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    await db
      .insertInto("imageMetadata")
      .values({ mediaFileId: file.id, width: 1920, height: 1080, format: "jpeg", createdAt: now, updatedAt: now })
      .execute();

    expect(countRows(rawDb, "image_metadata")).toBe(1);

    await db.deleteFrom("scanFolders").where("id", "=", folder.id).execute();

    expect(countRows(rawDb, "media_files")).toBe(0);
    expect(countRows(rawDb, "image_metadata")).toBe(0);
  });

  test("deleting a scan folder cascades to video metadata", async () => {
    const folder = await db
      .insertInto("scanFolders")
      .values({
        path: "/test/vids",
        priority: 1,
        status: "ready",
        scanSubdirectories: 1,
        includeVideos: 1,
        imageCount: 0,
        videoCount: 0,
        totalSize: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    const now = Date.now();
    const file = await db
      .insertInto("mediaFiles")
      .values({
        scanFolderId: folder.id,
        path: "/test/vids/clip.mp4",
        filename: "clip.mp4",
        extension: "mp4",
        fileType: "video",
        size: 10000,
        status: "processed",
        createdAt: now,
        updatedAt: now,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    await db
      .insertInto("videoMetadata")
      .values({
        mediaFileId: file.id,
        width: 1280,
        height: 720,
        duration: 30.5,
        frameRate: 24,
        codec: "h264",
        createdAt: now,
        updatedAt: now,
      })
      .execute();

    expect(countRows(rawDb, "video_metadata")).toBe(1);

    await db.deleteFrom("scanFolders").where("id", "=", folder.id).execute();

    expect(countRows(rawDb, "media_files")).toBe(0);
    expect(countRows(rawDb, "video_metadata")).toBe(0);
  });

  test("deleting a scan folder cascades to phash matches", async () => {
    const folder = await db
      .insertInto("scanFolders")
      .values({
        path: "/test/phash",
        priority: 1,
        status: "ready",
        scanSubdirectories: 1,
        includeVideos: 1,
        imageCount: 0,
        videoCount: 0,
        totalSize: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    const now = Date.now();
    const file1 = await db
      .insertInto("mediaFiles")
      .values({
        scanFolderId: folder.id,
        path: "/test/phash/a.jpg",
        filename: "a.jpg",
        extension: "jpg",
        fileType: "image",
        size: 1000,
        status: "processed",
        createdAt: now,
        updatedAt: now,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    const file2 = await db
      .insertInto("mediaFiles")
      .values({
        scanFolderId: folder.id,
        path: "/test/phash/b.jpg",
        filename: "b.jpg",
        extension: "jpg",
        fileType: "image",
        size: 2000,
        status: "processed",
        createdAt: now,
        updatedAt: now,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    await db
      .insertInto("phashMatches")
      .values({ mediaFileId1: file1.id, mediaFileId2: file2.id, distance: 3, createdAt: now })
      .execute();

    expect(countRows(rawDb, "phash_matches")).toBe(1);

    await db.deleteFrom("scanFolders").where("id", "=", folder.id).execute();

    expect(countRows(rawDb, "media_files")).toBe(0);
    expect(countRows(rawDb, "phash_matches")).toBe(0);
  });

  test("deleting a scan folder cascades to file decisions", async () => {
    const folder = await db
      .insertInto("scanFolders")
      .values({
        path: "/test/decisions",
        priority: 1,
        status: "ready",
        scanSubdirectories: 1,
        includeVideos: 1,
        imageCount: 0,
        videoCount: 0,
        totalSize: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    const now = Date.now();
    const file = await db
      .insertInto("mediaFiles")
      .values({
        scanFolderId: folder.id,
        path: "/test/decisions/a.jpg",
        filename: "a.jpg",
        extension: "jpg",
        fileType: "image",
        size: 1000,
        status: "processed",
        createdAt: now,
        updatedAt: now,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    await db
      .insertInto("fileDecisions")
      .values({ mediaFileId: file.id, action: "keep", method: "sha256", reviewGroupKey: "group1", createdAt: now })
      .execute();

    expect(countRows(rawDb, "file_decisions")).toBe(1);

    await db.deleteFrom("scanFolders").where("id", "=", folder.id).execute();

    expect(countRows(rawDb, "media_files")).toBe(0);
    expect(countRows(rawDb, "file_decisions")).toBe(0);
  });

  test("deleting a scan folder cascades through the full hierarchy", async () => {
    // Create a complete hierarchy: folder → files → metadata + matches + decisions
    const folder = await db
      .insertInto("scanFolders")
      .values({
        path: "/test/full",
        priority: 1,
        status: "ready",
        scanSubdirectories: 1,
        includeVideos: 1,
        imageCount: 0,
        videoCount: 0,
        totalSize: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    const now = Date.now();
    const img = await db
      .insertInto("mediaFiles")
      .values({
        scanFolderId: folder.id,
        path: "/test/full/photo.jpg",
        filename: "photo.jpg",
        extension: "jpg",
        fileType: "image",
        size: 5000,
        status: "processed",
        createdAt: now,
        updatedAt: now,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    const vid = await db
      .insertInto("mediaFiles")
      .values({
        scanFolderId: folder.id,
        path: "/test/full/clip.mp4",
        filename: "clip.mp4",
        extension: "mp4",
        fileType: "video",
        size: 10000,
        status: "processed",
        createdAt: now,
        updatedAt: now,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    const img2 = await db
      .insertInto("mediaFiles")
      .values({
        scanFolderId: folder.id,
        path: "/test/full/photo2.jpg",
        filename: "photo2.jpg",
        extension: "jpg",
        fileType: "image",
        size: 4000,
        status: "processed",
        createdAt: now,
        updatedAt: now,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    // image metadata
    await db
      .insertInto("imageMetadata")
      .values({ mediaFileId: img.id, width: 1920, height: 1080, format: "jpeg", createdAt: now, updatedAt: now })
      .execute();
    await db
      .insertInto("imageMetadata")
      .values({ mediaFileId: img2.id, width: 1280, height: 720, format: "png", createdAt: now, updatedAt: now })
      .execute();

    // video metadata
    await db
      .insertInto("videoMetadata")
      .values({
        mediaFileId: vid.id,
        width: 1920,
        height: 1080,
        duration: 60,
        frameRate: 30,
        codec: "h264",
        createdAt: now,
        updatedAt: now,
      })
      .execute();

    // phash matches
    await db
      .insertInto("phashMatches")
      .values({ mediaFileId1: img.id, mediaFileId2: img2.id, distance: 2, createdAt: now })
      .execute();

    // file decisions
    await db
      .insertInto("fileDecisions")
      .values({ mediaFileId: img.id, action: "keep", method: "sha256", reviewGroupKey: "g1", createdAt: now })
      .execute();
    await db
      .insertInto("fileDecisions")
      .values({ mediaFileId: img2.id, action: "delete", method: "sha256", reviewGroupKey: "g1", createdAt: now })
      .execute();
    await db
      .insertInto("fileDecisions")
      .values({ mediaFileId: vid.id, action: "keep", method: "content_hash", reviewGroupKey: "g2", createdAt: now })
      .execute();

    // Verify everything exists
    expect(countRows(rawDb, "scan_folders")).toBe(1);
    expect(countRows(rawDb, "media_files")).toBe(3);
    expect(countRows(rawDb, "image_metadata")).toBe(2);
    expect(countRows(rawDb, "video_metadata")).toBe(1);
    expect(countRows(rawDb, "phash_matches")).toBe(1);
    expect(countRows(rawDb, "file_decisions")).toBe(3);

    // Delete the folder — everything should cascade
    await db.deleteFrom("scanFolders").where("id", "=", folder.id).execute();

    expect(countRows(rawDb, "scan_folders")).toBe(0);
    expect(countRows(rawDb, "media_files")).toBe(0);
    expect(countRows(rawDb, "image_metadata")).toBe(0);
    expect(countRows(rawDb, "video_metadata")).toBe(0);
    expect(countRows(rawDb, "phash_matches")).toBe(0);
    expect(countRows(rawDb, "file_decisions")).toBe(0);
  });

  test("cascade only affects the deleted folder, not other folders", async () => {
    const now = Date.now();
    const folder1 = await db
      .insertInto("scanFolders")
      .values({
        path: "/test/keep",
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
      .returningAll()
      .executeTakeFirstOrThrow();
    const folder2 = await db
      .insertInto("scanFolders")
      .values({
        path: "/test/delete",
        priority: 2,
        status: "ready",
        scanSubdirectories: 1,
        includeVideos: 1,
        imageCount: 0,
        videoCount: 0,
        totalSize: 0,
        createdAt: now,
        updatedAt: now,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    await db
      .insertInto("mediaFiles")
      .values({
        scanFolderId: folder1.id,
        path: "/test/keep/a.jpg",
        filename: "a.jpg",
        extension: "jpg",
        fileType: "image",
        size: 1000,
        status: "processed",
        createdAt: now,
        updatedAt: now,
      })
      .execute();
    await db
      .insertInto("mediaFiles")
      .values({
        scanFolderId: folder2.id,
        path: "/test/delete/b.jpg",
        filename: "b.jpg",
        extension: "jpg",
        fileType: "image",
        size: 2000,
        status: "processed",
        createdAt: now,
        updatedAt: now,
      })
      .execute();

    expect(countRows(rawDb, "media_files")).toBe(2);

    // Delete only folder2
    await db.deleteFrom("scanFolders").where("id", "=", folder2.id).execute();

    expect(countRows(rawDb, "scan_folders")).toBe(1);
    expect(countRows(rawDb, "media_files")).toBe(1);

    // Verify the remaining file belongs to folder1
    const remaining = await db.selectFrom("mediaFiles").selectAll().executeTakeFirst();
    expect(remaining?.scanFolderId).toBe(folder1.id);
  });

  test("cross-folder phash match is deleted when either folder is deleted", async () => {
    const now = Date.now();
    const folder1 = await db
      .insertInto("scanFolders")
      .values({
        path: "/test/f1",
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
      .returningAll()
      .executeTakeFirstOrThrow();
    const folder2 = await db
      .insertInto("scanFolders")
      .values({
        path: "/test/f2",
        priority: 2,
        status: "ready",
        scanSubdirectories: 1,
        includeVideos: 1,
        imageCount: 0,
        videoCount: 0,
        totalSize: 0,
        createdAt: now,
        updatedAt: now,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    const file1 = await db
      .insertInto("mediaFiles")
      .values({
        scanFolderId: folder1.id,
        path: "/test/f1/a.jpg",
        filename: "a.jpg",
        extension: "jpg",
        fileType: "image",
        size: 1000,
        status: "processed",
        createdAt: now,
        updatedAt: now,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    const file2 = await db
      .insertInto("mediaFiles")
      .values({
        scanFolderId: folder2.id,
        path: "/test/f2/b.jpg",
        filename: "b.jpg",
        extension: "jpg",
        fileType: "image",
        size: 2000,
        status: "processed",
        createdAt: now,
        updatedAt: now,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    await db
      .insertInto("phashMatches")
      .values({ mediaFileId1: file1.id, mediaFileId2: file2.id, distance: 5, createdAt: now })
      .execute();

    expect(countRows(rawDb, "phash_matches")).toBe(1);

    // Delete folder1 — the cross-folder phash match should be deleted (file1 is gone)
    await db.deleteFrom("scanFolders").where("id", "=", folder1.id).execute();

    expect(countRows(rawDb, "phash_matches")).toBe(0);
    // file2 in folder2 should still exist
    expect(countRows(rawDb, "media_files")).toBe(1);
  });

  test("without PRAGMA foreign_keys, cascade does NOT work", async () => {
    // This test proves the bug: without PRAGMA foreign_keys = ON, cascade is inert
    const rawDbNoPragma = new SqliteDatabase(":memory:");
    // Intentionally NOT setting PRAGMA foreign_keys = ON
    const dbNoPragma = new Kysely<DatabaseSchema>({
      dialect: new BunSqliteDialect({ database: rawDbNoPragma }),
      plugins: [new CamelCasePlugin()],
    });

    try {
      await initializeDatabase(dbNoPragma, ":memory:");

      const now = Date.now();
      const folder = await dbNoPragma
        .insertInto("scanFolders")
        .values({
          path: "/test/no-pragma",
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
        .returningAll()
        .executeTakeFirstOrThrow();

      await dbNoPragma
        .insertInto("mediaFiles")
        .values({
          scanFolderId: folder.id,
          path: "/test/no-pragma/a.jpg",
          filename: "a.jpg",
          extension: "jpg",
          fileType: "image",
          size: 1000,
          status: "processed",
          createdAt: now,
          updatedAt: now,
        })
        .execute();

      const filesBefore = rawDbNoPragma.prepare("SELECT COUNT(*) as cnt FROM media_files").get() as { cnt: number };
      expect(filesBefore.cnt).toBe(1);

      // Delete the folder without PRAGMA foreign_keys
      await dbNoPragma.deleteFrom("scanFolders").where("id", "=", folder.id).execute();

      // Media files should still exist (cascade didn't fire!)
      const filesAfter = rawDbNoPragma.prepare("SELECT COUNT(*) as cnt FROM media_files").get() as { cnt: number };
      expect(filesAfter.cnt).toBe(1); // Bug: orphaned records remain
    } finally {
      rawDbNoPragma.close();
    }
  });
});
