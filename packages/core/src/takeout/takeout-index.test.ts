import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database as SqliteDatabase } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { CamelCasePlugin, Kysely } from "kysely";
import { BunSqliteDialect } from "kysely-bun-sqlite";
import { initializeDatabase } from "../db/client";
import { MediaFileProvider } from "../db/media-file-provider";
import { ScanFolderProvider } from "../db/scan-folder-provider";
import type { DatabaseSchema } from "../db/schema";
import { TakeoutProvider } from "../db/takeout-provider";
import { SYNTHETIC_TAKEOUT } from "./fixtures/synthetic-takeout";
import { indexTakeout, type TakeoutIndexDb, type TakeoutIndexResult } from "./takeout-index";

// The synthetic Takeout written to disk, indexed into a real in-memory database.
const dir = mkdtempSync(join(tmpdir(), "takeout-index-"));
const root = join(dir, "Takeout", "Google Photos");
const rawDb = new SqliteDatabase(":memory:");
rawDb.run("PRAGMA foreign_keys = ON");
const kysely = new Kysely<DatabaseSchema>({
  dialect: new BunSqliteDialect({ database: rawDb }),
  plugins: [new CamelCasePlugin()],
});
const providers = {
  scan: new ScanFolderProvider(kysely),
  media: new MediaFileProvider(kysely),
  takeout: new TakeoutProvider(kysely),
};
const db = {
  getScanFolderProvider: () => providers.scan,
  getMediaFileProvider: () => providers.media,
  getTakeoutProvider: () => providers.takeout,
} as unknown as TakeoutIndexDb;
const mediaIds = new Map<string, number>(); // "folder/name" → id
let result: TakeoutIndexResult;

function write(path: string, content: string | Uint8Array) {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content);
}

beforeAll(async () => {
  await initializeDatabase(kysely, ":memory:");
  const folder = await providers.scan.insertScanFolder({ path: dir });
  const add = async (path: string) => {
    write(path, new Uint8Array([0xff, 0xd8, 0xff]));
    const name = path.split("/").pop() as string;
    const media = await providers.media.insertMediaFile({
      scanFolderId: folder.id,
      path,
      filename: name,
      extension: name.split(".").pop() as string,
      fileType: /\.(mp4|mov)$/i.test(name) ? "video" : "image",
      size: 3,
    });
    return media.id;
  };
  for (const f of Object.values(SYNTHETIC_TAKEOUT)) {
    for (const name of f.media) mediaIds.set(`${f.name}/${name}`, await add(join(root, f.name, name)));
    for (const sc of f.sidecars) {
      const taken = sc.takenYear ? Date.UTC(sc.takenYear, 5, 1) / 1000 : 1_680_000_000;
      write(
        join(root, f.name, sc.name),
        JSON.stringify({
          title: sc.title,
          photoTakenTime: { timestamp: String(taken) },
          url: "https://photos.google.com/x",
        }),
      );
    }
    if (f.albumTitle)
      write(join(root, f.name, "metadata.json"), JSON.stringify({ title: f.albumTitle, access: "protected" }));
  }
  write(join(root, "print-subscriptions.json"), JSON.stringify({ subscriptions: [] }));
  write(join(root, "Photos from 2023", "broken.jpg.json"), "{ not json");
  mediaIds.set("outside", await add(join(dir, "Phone backup", "IMG_9999.jpg")));
  result = await indexTakeout(folder.id, db);
});
afterAll(() => {
  rawDb.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("indexTakeout (synthetic Takeout on disk)", () => {
  test("finds one Google Photos root and no pre-flight warnings", () => {
    expect(result.roots).toEqual([root]);
    expect(result.warnings).toEqual([]);
  });

  test("summary counts folders, sidecars by kind and rule, gaps and pairs", () => {
    expect(result.summary).toEqual({
      folders: { year: 2, album: 2, special: 1 },
      sidecars: { media: 15, album_metadata: 2, other: 1, unparseable: 1 },
      mediaSidecarsMatched: 14,
      mediaSidecarsUnmatched: 1,
      byMethod: { name_exact: 10, name_truncated: 1, edited_name: 1, album_reference: 2 },
      mediaWithoutSidecar: 1,
      pairs: { motion: 1, edited: 1 },
    });
  });

  test("album titles come from metadata.json", async () => {
    const albums = (await providers.takeout.getFolders()).filter((f) => f.kind === "album");
    expect(albums.map((a) => a.albumTitle).sort()).toEqual(["Family ❤", "Trip to Lisbon"]);
  });

  test("an album-only sidecar records album membership on the year-folder photo", async () => {
    const sidecars = await providers.takeout.getSidecarsForMedia(
      mediaIds.get("Photos from 2024/FAMILY_0001.jpg") as number,
    );
    expect(sidecars.map((s) => s.matchMethod).sort()).toEqual(["album_reference", "name_exact"]);
  });

  test("the drill-down lists name the gaps", async () => {
    expect((await providers.takeout.listMediaWithoutSidecar()).map((m) => m.path)).toEqual([
      join(root, "Photos from 2023", "NOSIDECAR_0001.jpg"),
    ]);
    expect((await providers.takeout.listUnmatchedSidecars()).map((s) => s.path)).toEqual([
      join(root, "Photos from 2023", "GONE_0001.jpg.json"),
    ]);
  });

  test("files outside the Takeout are left alone", async () => {
    const outside = await providers.media.getMediaFileById(mediaIds.get("outside") as number);
    expect(outside?.takeoutFolderId).toBeNull();
  });

  test("re-indexing gives the same result", async () => {
    const again = await indexTakeout((await providers.scan.getAllScanFolders())[0]?.id as number, db);
    expect(again.summary).toEqual(result.summary);
  });

  test("warns when parts were extracted into separate trees", async () => {
    mkdirSync(join(dir, "Takeout 2", "Google Photos"), { recursive: true });
    const second = await indexTakeout((await providers.scan.getAllScanFolders())[0]?.id as number, db);
    expect(second.warnings[0]).toMatch(/Found 2 Google Photos folders/);
    rmSync(join(dir, "Takeout 2"), { recursive: true });
  });
});
