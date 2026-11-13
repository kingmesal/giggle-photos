import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database as SqliteDatabase } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import exifr from "exifr";
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
import { applyCaptureDates, captureDateTags } from "./capture-date-writer";
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

  test("tags: photos get EXIF dates (UTC offset when exact); videos get QuickTime dates", () => {
    const p = proposeDate(file("/l/2019-05-12 Trip/a.jpg"), null);
    expect(p && captureDateTags(p)).toEqual({
      DateTimeOriginal: "2019:05:12 12:00:00",
      CreateDate: "2019:05:12 12:00:00",
    });
    const exact = proposeDate(file("/l/a.jpg"), new Date("2019-05-12T21:30:00Z"));
    expect(exact && captureDateTags(exact)).toMatchObject({
      DateTimeOriginal: "2019:05:12 21:30:00",
      OffsetTimeOriginal: "+00:00",
    });
    const video = proposeDate({ id: 2, path: "/l/VID_20200304_050607.mp4", fileType: "video" }, null);
    expect(video && captureDateTags(video)).toEqual({
      CreateDate: "2020:03:04 05:06:07",
      MediaCreateDate: "2020:03:04 05:06:07",
      TrackCreateDate: "2020:03:04 05:06:07",
    });
  });
});

// End to end on real files: the dates land in the files, nothing else is left behind, and the
// database follows (new SHA-256, dateTaken).
let base: string;
let raw: SqliteDatabase;
let db: Parameters<typeof applyCaptureDates>[0];
const ids: Record<string, number> = {};
const ffmpeg = Bun.which("ffmpeg");

beforeAll(async () => {
  base = mkdtempSync(join(tmpdir(), "capture-dates-"));
  raw = new SqliteDatabase(":memory:");
  const k = new Kysely<DatabaseSchema>({
    dialect: new BunSqliteDialect({ database: raw }),
    plugins: [new CamelCasePlugin()],
  });
  await initializeDatabase(k, ":memory:");
  const folder = await new ScanFolderProvider(k).insertScanFolder({ path: base });
  const media = new MediaFileProvider(k);
  const images = new ImageMetadataProvider(k);
  const jpeg = await sharp({ create: { width: 64, height: 48, channels: 3, background: "#468" } })
    .jpeg()
    .toBuffer();
  const add = async (rel: string, fileType: "image" | "video", bytes: Uint8Array, dateTaken: Date | null = null) => {
    const path = join(base, rel);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, bytes);
    const f = await media.insertMediaFile({
      scanFolderId: folder.id,
      path,
      filename: rel.split("/").pop() as string,
      extension: rel.split(".").pop() as string,
      fileType,
      size: bytes.length,
      status: "processed",
      sha256Hash: await computeSha256(path),
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
    }
    ids[rel] = f.id;
  };
  await add("2019-05-12 Trip/a.jpg", "image", jpeg);
  await add("Photos from 2018/b.jpg", "image", jpeg);
  await add("misc/c.jpg", "image", jpeg); // dated only by its JSON
  await add("misc/d.jpg", "image", jpeg); // no source at all
  await add("2017/e.jpg", "image", jpeg, new Date("2017-03-03T03:03:03Z")); // already dated
  await add("2016-01-01/broken.jpg", "image", new TextEncoder().encode("not a jpeg"));
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
  if (ffmpeg) {
    const video = join(base, "v.mp4");
    const p = Bun.spawn([
      ffmpeg,
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "testsrc=duration=1:size=64x48:rate=5",
      "-pix_fmt",
      "yuv420p",
      video,
    ]);
    await p.exited;
    const bytes = new Uint8Array(await Bun.file(video).arrayBuffer());
    rmSync(video);
    await add("2020-02-02 Clip/VID_20200304_050607.mp4", "video", bytes);
    await new VideoMetadataProvider(k).insertVideoMetadata({
      mediaFileId: ids["2020-02-02 Clip/VID_20200304_050607.mp4"] as number,
      width: 64,
      height: 48,
      duration: 1,
    });
  }
  db = {
    getClient: () => ({ getDb: () => k }),
    getMediaFileProvider: () => media,
    getImageMetadataProvider: () => images,
    getVideoMetadataProvider: () => new VideoMetadataProvider(k),
  } as unknown as typeof db;
}, 60_000);
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

  test("apply writes into the files in place, updates SHA-256 and dateTaken; failures are reported", async () => {
    const before = await computeSha256(join(base, "2019-05-12 Trip/a.jpg"));
    const result = await applyCaptureDates(db);
    expect(result.failed).toBe(1);
    expect(result.errors[0]?.path).toEndWith("broken.jpg");
    expect(result.written).toBe(ffmpeg ? 4 : 3);

    const a = await exifr.parse(join(base, "2019-05-12 Trip/a.jpg"), {
      pick: ["DateTimeOriginal"],
      reviveValues: false,
    });
    expect(a?.DateTimeOriginal).toBe("2019:05:12 12:00:00");
    const c = await exifr.parse(join(base, "misc/c.jpg"), {
      pick: ["DateTimeOriginal", "OffsetTimeOriginal"],
      reviveValues: false,
    });
    expect(c).toMatchObject({ DateTimeOriginal: "2015:08:09 10:11:12", OffsetTimeOriginal: "+00:00" });

    // No backup copies (maintainer's choice), and the database follows the new bytes.
    expect(readdirSync(join(base, "2019-05-12 Trip"))).toEqual(["a.jpg"]);
    const file = await db.getMediaFileProvider().getMediaFileById(ids["2019-05-12 Trip/a.jpg"] as number);
    expect(file?.sha256Hash).toBe(await computeSha256(join(base, "2019-05-12 Trip/a.jpg")));
    expect(file?.sha256Hash).not.toBe(before);
    const meta = await db.getImageMetadataProvider().getByMediaFileIds([ids["misc/c.jpg"] as number]);
    expect(meta[0]?.dateTaken?.toISOString()).toBe("2015-08-09T10:11:12.000Z");

    // Dated now, so a second pass proposes nothing for them.
    const again = await findCaptureDateProposals(db);
    expect(again.proposals.map((p) => p.path.replace(`${base}/`, ""))).toEqual(["2016-01-01/broken.jpg"]);
  }, 60_000);

  test.skipIf(!ffmpeg)("videos get QuickTime CreateDate", async () => {
    const path = join(base, "2020-02-02 Clip/VID_20200304_050607.mp4");
    expect(existsSync(path)).toBe(true);
    const probe = Bun.spawnSync(["ffprobe", "-v", "quiet", "-print_format", "json", "-show_format", path]);
    const tags = JSON.parse(probe.stdout.toString()).format.tags as Record<string, string>;
    expect(tags.creation_time).toStartWith("2020-03-04T05:06:07");
  });
});
