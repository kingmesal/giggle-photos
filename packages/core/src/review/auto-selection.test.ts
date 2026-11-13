import { Database as SqliteDatabase } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { CamelCasePlugin, Kysely } from "kysely";
import { BunSqliteDialect } from "kysely-bun-sqlite";
import { initializeDatabase } from "../db/client";
import type { DatabaseSchema } from "../db/schema";
import { TakeoutProvider } from "../db/takeout-provider";
import type { MediaFile } from "../zod/media-file";
import { computeAutoSelection } from "./auto-selection";
import type { FileWithReviewContext } from "./review-queries";

// Real in-memory DB: Takeout context comes from the actual tables and queries.
const rawDb = new SqliteDatabase(":memory:");
rawDb.run("PRAGMA foreign_keys = ON");
const db = new Kysely<DatabaseSchema>({
  dialect: new BunSqliteDialect({ database: rawDb }),
  plugins: [new CamelCasePlugin()],
});
const takeout = new TakeoutProvider(db);
const ROOT = "/t/Takeout/Google Photos";
const ids: Record<string, number> = {};
const ctx = (name: string, over: Partial<FileWithReviewContext> = {}): FileWithReviewContext => ({
  file: { id: ids[name], size: 1000 } as MediaFile,
  metadata: null,
  folderPriority: 3,
  decision: null,
  ...over,
});

beforeAll(async () => {
  await initializeDatabase(db, ":memory:");
  const now = Date.now();
  const folder = await db
    .insertInto("scanFolders")
    .values({
      path: "/t",
      priority: 3,
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
  for (const name of [
    "year/A.jpg",
    "albumX/A.jpg",
    "albumY/A.jpg",
    "backup/A.jpg",
    "year/B.jpg",
    "year/B-edited.jpg",
  ]) {
    const row = await db
      .insertInto("mediaFiles")
      .values({
        scanFolderId: Number(folder.id),
        path: `/t/${name}`,
        filename: name.split("/")[1] as string,
        extension: "jpg",
        fileType: "image",
        size: 1000,
        status: "processed",
        createdAt: now,
        updatedAt: now,
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    ids[name] = Number(row.id);
  }
  const sidecar = (path: string, folderKey: string, media: string) => ({
    folderKey,
    path,
    kind: "media" as const,
    title: "x",
    mediaFileId: ids[media] as number,
    matchMethod: "name_exact" as const,
  });
  await takeout.replaceIndex(Number(folder.id), {
    folders: [
      {
        key: "year",
        folder: { rootPath: ROOT, path: `${ROOT}/Photos from 2023`, kind: "year", year: 2023, albumTitle: null },
        mediaFileIds: [ids["year/A.jpg"], ids["year/B.jpg"], ids["year/B-edited.jpg"]] as number[],
      },
      {
        key: "x",
        folder: { rootPath: ROOT, path: `${ROOT}/X`, kind: "album", year: null, albumTitle: "X" },
        mediaFileIds: [ids["albumX/A.jpg"] as number],
      },
      {
        key: "y",
        folder: { rootPath: ROOT, path: `${ROOT}/Y`, kind: "album", year: null, albumTitle: "Y" },
        mediaFileIds: [ids["albumY/A.jpg"] as number],
      },
    ],
    sidecars: [
      sidecar(`${ROOT}/2023/A.jpg.json`, "year", "year/A.jpg"),
      sidecar(`${ROOT}/X/A.jpg.json`, "x", "albumX/A.jpg"),
      sidecar(`${ROOT}/Y/A.jpg.json`, "y", "albumY/A.jpg"),
      sidecar(`${ROOT}/2023/B.jpg.json`, "year", "year/B.jpg"),
    ],
    pairs: [
      {
        kind: "edited",
        primaryFileId: ids["year/B.jpg"] as number,
        secondaryFileId: ids["year/B-edited.jpg"] as number,
      },
    ],
  });
});
afterAll(() => rawDb.close());

describe("computeAutoSelection with real Takeout context", () => {
  test("exact duplicates: both album copies kept, year and non-Google copies offered for deletion", async () => {
    const files = ["year/A.jpg", "albumX/A.jpg", "albumY/A.jpg", "backup/A.jpg"].map((n) => ctx(n));
    const s = await computeAutoSelection(takeout, "sha256", files);
    expect(s.keepFileIds).toEqual(
      [ids["albumX/A.jpg"], ids["albumY/A.jpg"]].sort((a, b) => (a as number) - (b as number)),
    );
    expect(s.fileId).toBe(s.keepFileIds[0] as number);
  });

  test("without album copies, the Google copy beats the non-Google one even at lower folder priority", async () => {
    const s = await computeAutoSelection(takeout, "content_hash", [
      ctx("year/A.jpg", { folderPriority: 5 }),
      ctx("backup/A.jpg", { folderPriority: 1 }),
    ]);
    expect(s.keepFileIds).toEqual([ids["year/A.jpg"] as number]);
  });

  test("an edited copy inherits its original's sidecar and both are kept when grouped together", async () => {
    const context = await takeout.getPreselectContext([ids["year/B-edited.jpg"] as number]);
    expect(context.get(ids["year/B-edited.jpg"] as number)).toMatchObject({
      hasSidecar: true,
      editedPartnerId: ids["year/B.jpg"],
    });
    const s = await computeAutoSelection(takeout, "phash", [
      ctx("year/B.jpg"),
      ctx("year/B-edited.jpg"),
      ctx("backup/A.jpg"),
    ]);
    expect(s.keepFileIds).toEqual([ids["year/B.jpg"], ids["year/B-edited.jpg"]] as number[]);
  });

  test("clip groups get no suggestion", async () => {
    expect(await computeAutoSelection(takeout, "clip", [ctx("year/A.jpg"), ctx("albumX/A.jpg")])).toEqual({
      fileId: 0,
      keepFileIds: [],
      reason: "Visual matches are for review only",
    });
  });
});
