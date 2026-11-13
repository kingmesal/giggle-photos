import { Database as SqliteDatabase } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { CamelCasePlugin, Kysely } from "kysely";
import { BunSqliteDialect } from "kysely-bun-sqlite";
import { initializeDatabase } from "./client";
import type { DatabaseSchema } from "./schema";
import { type TakeoutIndexInput, TakeoutProvider } from "./takeout-provider";

// Real in-memory SQLite with all migrations: exercises 0008_takeout and its constraints.
let rawDb: SqliteDatabase;
let db: Kysely<DatabaseSchema>;
let provider: TakeoutProvider;
let scanFolderId: number;
const ids: Record<string, number> = {};

const ROOT = "/t/Takeout/Google Photos";
const NAMES = [
  "2023/IMG_1.jpg",
  "2023/IMG_1-edited.jpg",
  "2023/IMG_2.HEIC",
  "2023/IMG_2.MP4",
  "2023/LONE.jpg",
  "Trip/IMG_1.jpg",
];

beforeEach(async () => {
  rawDb = new SqliteDatabase(":memory:");
  rawDb.run("PRAGMA foreign_keys = ON");
  db = new Kysely<DatabaseSchema>({
    dialect: new BunSqliteDialect({ database: rawDb }),
    plugins: [new CamelCasePlugin()],
  });
  await initializeDatabase(db, ":memory:");
  provider = new TakeoutProvider(db);
  const now = Date.now();
  const folder = await db
    .insertInto("scanFolders")
    .values({
      path: "/t",
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
  scanFolderId = Number(folder.id);
  for (const name of NAMES) {
    const filename = name.split("/")[1] as string;
    const row = await db
      .insertInto("mediaFiles")
      .values({
        scanFolderId,
        path: `${ROOT}/${name}`,
        filename,
        extension: filename.split(".")[1] as string,
        fileType: filename.endsWith("MP4") ? "video" : "image",
        size: 1,
        status: "pending",
        createdAt: now,
        updatedAt: now,
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    ids[name] = Number(row.id);
  }
});
afterEach(() => rawDb.close());

const sidecar = (path: string, folderKey: string | null, mediaFileId: number | null, matchMethod: string | null) => ({
  folderKey,
  path,
  kind: "media" as const,
  title:
    path
      .split("/")
      .pop()
      ?.replace(/\.json$/, "") ?? null,
  photoTakenTime: new Date("2023-05-01T10:00:00Z"),
  people: ["Person A"],
  trashed: false,
  archived: true,
  favorited: false,
  mediaFileId,
  matchMethod: matchMethod as "name_exact" | null,
});

function index(): TakeoutIndexInput {
  return {
    folders: [
      {
        key: "2023",
        folder: { rootPath: ROOT, path: `${ROOT}/Photos from 2023`, kind: "year", year: 2023, albumTitle: null },
        mediaFileIds: NAMES.filter((n) => n.startsWith("2023/")).map((n) => ids[n] as number),
      },
      {
        key: "trip",
        folder: { rootPath: ROOT, path: `${ROOT}/Trip`, kind: "album", year: null, albumTitle: "Trip ❤" },
        mediaFileIds: [ids["Trip/IMG_1.jpg"] as number],
      },
    ],
    sidecars: [
      sidecar(`${ROOT}/2023/IMG_1.jpg.json`, "2023", ids["2023/IMG_1.jpg"] as number, "name_exact"),
      sidecar(`${ROOT}/2023/IMG_2.HEIC.json`, "2023", ids["2023/IMG_2.HEIC"] as number, "name_exact"),
      sidecar(`${ROOT}/Trip/IMG_1.jpg.json`, "trip", ids["Trip/IMG_1.jpg"] as number, "name_exact"),
      sidecar(`${ROOT}/2023/GONE.jpg.json`, "2023", null, null),
      { ...sidecar(`${ROOT}/Trip/metadata.json`, "trip", null, null), kind: "album_metadata" as const },
    ],
    pairs: [
      {
        kind: "edited",
        primaryFileId: ids["2023/IMG_1.jpg"] as number,
        secondaryFileId: ids["2023/IMG_1-edited.jpg"] as number,
      },
      {
        kind: "motion",
        primaryFileId: ids["2023/IMG_2.HEIC"] as number,
        secondaryFileId: ids["2023/IMG_2.MP4"] as number,
      },
    ],
  };
}

describe("TakeoutProvider", () => {
  test("replaceIndex stores folders, assigns media, and the summary counts everything", async () => {
    await provider.replaceIndex(scanFolderId, index());
    expect(await provider.getSummary()).toEqual({
      folders: { year: 1, album: 1, special: 0 },
      sidecars: { media: 4, album_metadata: 1, other: 0, unparseable: 0 },
      mediaSidecarsMatched: 3,
      mediaSidecarsUnmatched: 1,
      byMethod: { name_exact: 3 },
      mediaWithoutSidecar: 1, // LONE.jpg; the edited copy and the video inherit through pairs
      pairs: { motion: 1, edited: 1 },
    });
    expect((await provider.listMediaWithoutSidecar()).map((m) => m.path)).toEqual([`${ROOT}/2023/LONE.jpg`]);
    expect((await provider.listUnmatchedSidecars()).map((s) => s.path)).toEqual([`${ROOT}/2023/GONE.jpg.json`]);
    const assigned = await db
      .selectFrom("mediaFiles")
      .select("takeoutFolderId")
      .where("takeoutFolderId", "is not", null)
      .execute();
    expect(assigned).toHaveLength(NAMES.length);
  });

  test("sidecar fields round-trip (dates, booleans, people)", async () => {
    await provider.replaceIndex(scanFolderId, index());
    const [stored] = await provider.getSidecarsForMedia(ids["2023/IMG_1.jpg"] as number);
    expect(stored).toMatchObject({ archived: true, trashed: false, people: ["Person A"], matchMethod: "name_exact" });
    expect(stored?.photoTakenTime?.toISOString()).toBe("2023-05-01T10:00:00.000Z");
    expect((await provider.getFolders()).find((f) => f.kind === "album")?.albumTitle).toBe("Trip ❤");
  });

  test("re-indexing replaces rather than duplicates", async () => {
    await provider.replaceIndex(scanFolderId, index());
    await provider.replaceIndex(scanFolderId, index());
    const summary = await provider.getSummary();
    expect(summary.sidecars.media).toBe(4);
    expect(summary.pairs).toEqual({ motion: 1, edited: 1 });
  });

  test("deleting a media file nulls its sidecar link and removes its pairs", async () => {
    await provider.replaceIndex(scanFolderId, index());
    await db
      .deleteFrom("mediaFiles")
      .where("id", "=", ids["2023/IMG_1.jpg"] as number)
      .execute();
    expect((await provider.getSummary()).mediaSidecarsUnmatched).toBe(2);
    expect(await provider.getPairsForMedia(ids["2023/IMG_1-edited.jpg"] as number)).toEqual([]);
  });

  test("deleting the scan folder cascades to all Takeout rows", async () => {
    await provider.replaceIndex(scanFolderId, index());
    await db.deleteFrom("scanFolders").where("id", "=", scanFolderId).execute();
    for (const table of ["takeout_folders", "sidecars", "media_pairs"]) {
      expect((rawDb.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n).toBe(0);
    }
  });

  test("invalid data is rejected by Zod before it reaches the database", async () => {
    const bad = index();
    (bad.sidecars[0] as { geoLat: number }).geoLat = 123; // outside -90..90
    await expect(provider.replaceIndex(scanFolderId, bad)).rejects.toThrow();
    expect((await provider.getSummary()).sidecars.media).toBe(0); // the transaction rolled back
  });
});
