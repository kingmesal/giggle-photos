import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database as SqliteDatabase } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { ExifTool } from "exiftool-vendored";
import { CamelCasePlugin, Kysely } from "kysely";
import { BunSqliteDialect } from "kysely-bun-sqlite";
import sharp from "sharp";
import { initializeDatabase } from "../db/client";
import { ImageMetadataProvider } from "../db/image-metadata-provider";
import { MediaFileProvider } from "../db/media-file-provider";
import { ScanFolderProvider } from "../db/scan-folder-provider";
import type { DatabaseSchema } from "../db/schema";
import { TakeoutProvider } from "../db/takeout-provider";
import { VideoMetadataProvider } from "../db/video-metadata-provider";
import { computeSha256 } from "../scan/hash-sha256";
import { applyCaptureDates, captureDateXmp, xmpDate } from "./capture-date-writer";
import { findCaptureDateProposals, proposeDate } from "./capture-dates";

describe("proposeDate (pure)", () => {
  const file = (path: string) => ({ id: 1, path, fileType: "image" as const });
  test("Google JSON beats the file name, which beats the folder", () => {
    const json = new Date("2019-05-12T21:30:00Z");
    expect(proposeDate(file("/l/2018/IMG_20190101_101010.jpg"), json)).toMatchObject({
      source: "sidecar",
      takenAt: "2019-05-12T21:30:00.000Z",
      precision: "exact",
    });
    expect(proposeDate(file("/l/2018/IMG_20190101_101010.jpg"), null)).toMatchObject({
      source: "filename",
      takenAt: "2019-01-01T10:10:10",
    });
    expect(proposeDate(file("/l/Photos from 2018/IMG_0001.jpg"), null)).toMatchObject({
      source: "folder",
      takenAt: "2018-07-01T12:00:00",
      precision: "year",
    });
    expect(proposeDate(file("/l/misc/IMG_0001.jpg"), null)).toBeNull();
  });

  test("XMP dates: exact instants keep the UTC offset; wall times carry no zone", () => {
    const wall = proposeDate(file("/l/2019-05-12 Trip/a.jpg"), null);
    expect(wall && xmpDate(wall)).toBe("2019-05-12T12:00:00");
    const exact = proposeDate(file("/l/a.jpg"), new Date("2019-05-12T21:30:00Z"));
    expect(exact && xmpDate(exact)).toBe("2019-05-12T21:30:00+00:00");
    expect(exact && captureDateXmp(exact)).toContain('xmp:CreatorTool="Giggle Photos"');
  });
});

// End to end on real files: sidecars are written next to the originals, the originals are not
// touched, and ExifTool (what Immich reads metadata with) sees the dates.
let base: string;
let raw: SqliteDatabase;
let db: Parameters<typeof applyCaptureDates>[0];
let media: MediaFileProvider;
const ids: Record<string, number> = {};
const shaBefore: Record<string, string> = {};

beforeAll(async () => {
  base = mkdtempSync(join(tmpdir(), "capture-dates-"));
  raw = new SqliteDatabase(":memory:");
  const k = new Kysely<DatabaseSchema>({
    dialect: new BunSqliteDialect({ database: raw }),
    plugins: [new CamelCasePlugin()],
  });
  await initializeDatabase(k, ":memory:");
  const folder = await new ScanFolderProvider(k).insertScanFolder({ path: base });
  media = new MediaFileProvider(k);
  const images = new ImageMetadataProvider(k);
  const videos = new VideoMetadataProvider(k);
  const jpeg = await sharp({ create: { width: 64, height: 48, channels: 3, background: "#468" } })
    .jpeg()
    .toBuffer();
  const add = async (rel: string, fileType: "image" | "video", dateTaken: Date | null = null) => {
    const path = join(base, rel);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, jpeg);
    shaBefore[rel] = await computeSha256(path);
    const f = await media.insertMediaFile({
      scanFolderId: folder.id,
      path,
      filename: rel.split("/").pop() as string,
      extension: rel.split(".").pop() as string,
      fileType,
      size: jpeg.length,
      status: "processed",
      sha256Hash: shaBefore[rel],
    });
    if (fileType === "image") {
      await images.insertImageMetadata({
        mediaFileId: f.id,
        width: 64,
        height: 48,
        format: "jpeg",
        hasAlpha: false,
        dateTaken,
      });
    } else {
      await videos.insertVideoMetadata({ mediaFileId: f.id, width: 64, height: 48, duration: 1 });
    }
    ids[rel] = f.id;
  };
  await add("2019-05-12 Trip/a.jpg", "image");
  await add("Photos from 2018/b.jpg", "image");
  await add("misc/c.jpg", "image"); // dated only by its JSON
  await add("misc/d.jpg", "image"); // no source at all
  await add("2017/e.jpg", "image", new Date("2017-03-03T03:03:03Z")); // already dated
  await add("2016-01-01/f.jpg", "image"); // someone else's XMP is already there
  writeFileSync(join(base, "2016-01-01/f.jpg.xmp"), "<x:xmpmeta xmlns:x='adobe:ns:meta/'/>");
  await add("2020-02-02 Clip/VID_20200304_050607.mp4", "video");
  await new TakeoutProvider(k).replaceIndex(folder.id, {
    folders: [],
    pairs: [],
    sidecars: [
      {
        folderKey: null,
        path: join(base, "misc/c.jpg.json"),
        kind: "media",
        mediaFileId: ids["misc/c.jpg"] as number,
        matchMethod: "name_exact",
        photoTakenTime: new Date("2015-08-09T10:11:12Z"),
      },
    ],
  });
  db = {
    getClient: () => ({ getDb: () => k }),
    getImageMetadataProvider: () => images,
    getVideoMetadataProvider: () => videos,
  } as unknown as typeof db;
});
afterAll(() => {
  raw.close();
  rmSync(base, { recursive: true, force: true });
});

describe("capture dates on real files", () => {
  test("proposals: only undated files, best source each; undatable listed", async () => {
    const report = await findCaptureDateProposals(db);
    const by = Object.fromEntries(report.proposals.map((p) => [p.path.replace(`${base}/`, ""), [p.source, p.takenAt]]));
    expect(by["2019-05-12 Trip/a.jpg"]).toEqual(["folder", "2019-05-12T12:00:00"]);
    expect(by["Photos from 2018/b.jpg"]).toEqual(["folder", "2018-07-01T12:00:00"]);
    expect(by["misc/c.jpg"]).toEqual(["sidecar", "2015-08-09T10:11:12.000Z"]);
    expect(by["2017/e.jpg"]).toBeUndefined();
    expect(report.undatable.map((u) => u.path.replace(`${base}/`, ""))).toEqual(["misc/d.jpg"]);
  });

  test("apply writes sidecars, leaves originals and other apps' sidecars alone, records the date", async () => {
    const result = await applyCaptureDates(db);
    expect(result).toMatchObject({ written: 4, skipped: 1, failed: 0 });
    expect(result.errors[0]?.path).toEndWith("f.jpg.xmp");
    expect(readFileSync(join(base, "2016-01-01/f.jpg.xmp"), "utf-8")).toBe("<x:xmpmeta xmlns:x='adobe:ns:meta/'/>");
    for (const rel of Object.keys(shaBefore)) {
      expect({ rel, sha: await computeSha256(join(base, rel)) }).toEqual({ rel, sha: shaBefore[rel] as string });
    }
    expect(readdirSync(join(base, "2019-05-12 Trip")).sort()).toEqual(["a.jpg", "a.jpg.xmp"]);
    const meta = await db.getImageMetadataProvider().getByMediaFileIds([ids["misc/c.jpg"] as number]);
    expect(meta[0]?.dateTaken?.toISOString()).toBe("2015-08-09T10:11:12.000Z");
    // Dated now: only the file with a foreign sidecar is still proposed.
    const again = await findCaptureDateProposals(db);
    expect(again.proposals.map((p) => p.path.replace(`${base}/`, ""))).toEqual(["2016-01-01/f.jpg"]);
  });

  test("ExifTool (as Immich uses it) reads the dates from the sidecars", async () => {
    const et = new ExifTool({ maxProcs: 1 });
    try {
      const a = await et.read(join(base, "2019-05-12 Trip/a.jpg.xmp"));
      expect(String(a.DateTimeOriginal)).toStartWith("2019-05-12T12:00:00");
      const c = await et.read(join(base, "misc/c.jpg.xmp"));
      expect(String(c.DateTimeOriginal)).toBe("2015-08-09T10:11:12Z"); // the same UTC instant
      const v = await et.read(join(base, "2020-02-02 Clip/VID_20200304_050607.mp4.xmp"));
      expect(String(v.DateTimeOriginal)).toStartWith("2020-03-04T05:06:07");
    } finally {
      await et.end();
    }
  }, 30_000);

  test("a second run rewrites its own sidecars without complaint", async () => {
    await media.getMediaFileById(1);
    const images = db.getImageMetadataProvider();
    const meta = await images.getByMediaFileIds([ids["2019-05-12 Trip/a.jpg"] as number]);
    if (meta[0]) await images.updateImageMetadata({ id: meta[0].id, dateTaken: null }); // e.g. after a rescan
    const result = await applyCaptureDates(db, { fileIds: [ids["2019-05-12 Trip/a.jpg"] as number] });
    expect(result).toMatchObject({ written: 1, skipped: 0, failed: 0 });
  });
});
