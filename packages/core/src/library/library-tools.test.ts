import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database as SqliteDatabase } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { CamelCasePlugin, Kysely } from "kysely";
import { BunSqliteDialect } from "kysely-bun-sqlite";
import { initializeDatabase } from "../db/client";
import { ImageMetadataProvider } from "../db/image-metadata-provider";
import { MediaFileProvider } from "../db/media-file-provider";
import { ScanFolderProvider } from "../db/scan-folder-provider";
import type { DatabaseSchema } from "../db/schema";
import { TakeoutProvider } from "../db/takeout-provider";
import { VideoMetadataProvider } from "../db/video-metadata-provider";
import { readSidecar, xmpPath } from "./sidecar-file";
import { previewJsonToXmp, runJsonToXmp } from "./tool-json-to-xmp";
import { previewRemoveJson, type RemoveFile, runRemoveJson } from "./tool-remove-json";
import { previewXmpFromFiles, runXmpFromFiles } from "./tool-xmp-from-files";

// A small library on disk: a Takeout photo with JSON (and its motion video), a photo with its own
// EXIF date and GPS, an undated photo in a dated folder, an album JSON, and a foreign sidecar.
let base: string;
let raw: SqliteDatabase;
let db: Parameters<typeof runJsonToXmp>[0] & Parameters<typeof runRemoveJson>[0];
let takeout: TakeoutProvider;
const P = (rel: string) => join(base, rel);
const sidecarFields = async (rel: string) => {
  const s = await readSidecar(P(rel));
  return s.exists && s.ours ? s.fields : null;
};

beforeEach(async () => {
  base = mkdtempSync(join(tmpdir(), "library-tools-"));
  raw = new SqliteDatabase(":memory:");
  const k = new Kysely<DatabaseSchema>({
    dialect: new BunSqliteDialect({ database: raw }),
    plugins: [new CamelCasePlugin()],
  });
  await initializeDatabase(k, ":memory:");
  const folder = await new ScanFolderProvider(k).insertScanFolder({ path: base });
  const media = new MediaFileProvider(k);
  const images = new ImageMetadataProvider(k);
  const ids: Record<string, number> = {};
  const add = async (rel: string, meta: Record<string, unknown> | null, fileType: "image" | "video" = "image") => {
    mkdirSync(join(P(rel), ".."), { recursive: true });
    writeFileSync(P(rel), "bytes");
    const f = await media.insertMediaFile({
      scanFolderId: folder.id,
      path: P(rel),
      filename: rel.split("/").pop() as string,
      extension: "jpg",
      fileType,
      size: 5,
      status: "processed",
    });
    ids[rel] = f.id;
    if (fileType === "video")
      await new VideoMetadataProvider(k).insertVideoMetadata({ mediaFileId: f.id, width: 4, height: 3, duration: 2 });
    else if (meta)
      await images.insertImageMetadata({
        mediaFileId: f.id,
        width: 4,
        height: 3,
        format: "jpeg",
        hasAlpha: false,
        ...meta,
      });
  };
  await add("Takeout/Photos from 2019/PXL_1.jpg", {
    cameraMake: "Google",
    cameraModel: "Pixel 8",
    dateTaken: new Date(2019, 4, 12, 14, 30, 0),
  });
  await add("Takeout/Photos from 2019/PXL_1.mp4", null, "video");
  await add("Mine/2018-03-04 Party/a.jpg", {
    dateTaken: new Date(2018, 2, 4, 20, 15, 0),
    gpsLatitude: 40.5,
    gpsLongitude: -73.25,
  });
  await add("Mine/2017-06 Trip/b.jpg", {});
  await add("Mine/2016-01-01/foreign.jpg", {});
  writeFileSync(xmpPath(P("Mine/2016-01-01/foreign.jpg")), "<x:xmpmeta xmlns:x='adobe:ns:meta/'/>");
  mkdirSync(P("Takeout/Trip"), { recursive: true });
  for (const j of ["Takeout/Photos from 2019/PXL_1.jpg.json", "Takeout/Trip/metadata.json"]) writeFileSync(P(j), "{}");
  takeout = new TakeoutProvider(k);
  await takeout.replaceIndex(folder.id, {
    folders: [],
    sidecars: [
      {
        folderKey: null,
        path: P("Takeout/Photos from 2019/PXL_1.jpg.json"),
        kind: "media",
        mediaFileId: ids["Takeout/Photos from 2019/PXL_1.jpg"] as number,
        matchMethod: "name_exact",
        photoTakenTime: new Date("2019-05-12T21:30:00Z"),
        geoLat: 0,
        geoLon: 0,
        description: "Beach",
        favorited: true,
        people: ["Heather"],
      },
      {
        folderKey: null,
        path: P("Takeout/Trip/metadata.json"),
        kind: "album_metadata",
        title: "Trip",
        mediaFileId: null,
        matchMethod: null,
      },
    ],
    pairs: [
      {
        kind: "motion",
        primaryFileId: ids["Takeout/Photos from 2019/PXL_1.jpg"] as number,
        secondaryFileId: ids["Takeout/Photos from 2019/PXL_1.mp4"] as number,
      },
    ],
  });
  db = { getClient: () => ({ getDb: () => k }), getTakeoutProvider: () => takeout } as unknown as typeof db;
});
afterEach(() => {
  raw.close();
  rmSync(base, { recursive: true, force: true });
});

describe("tool 1: XMP from the files' own metadata", () => {
  test("own date, GPS and camera; a missing date from the folder; previews count it all", async () => {
    const preview = await previewXmpFromFiles(db);
    expect(preview).toMatchObject({ files: 5, embeddedDate: 2, folderDate: 3, noDate: 0, withGps: 1 });
    const r = await runXmpFromFiles(db);
    expect(r).toMatchObject({ written: 4, skipped: 1, failed: 0 });
    expect(await sidecarFields("Mine/2018-03-04 Party/a.jpg")).toEqual({
      dateTaken: { value: "2018-03-04T20:15:00", source: "embedded" },
      gps: { value: { lat: 40.5, lon: -73.25 }, source: "embedded" },
    });
    expect((await sidecarFields("Mine/2017-06 Trip/b.jpg"))?.dateTaken).toEqual({
      value: "2017-06-15T12:00:00",
      source: "folder",
    });
    expect(readFileSync(xmpPath(P("Mine/2016-01-01/foreign.jpg")), "utf-8")).toBe(
      "<x:xmpmeta xmlns:x='adobe:ns:meta/'/>",
    );
    expect(readFileSync(P("Mine/2018-03-04 Party/a.jpg"), "utf-8")).toBe("bytes"); // originals untouched
    expect(await runXmpFromFiles(db)).toMatchObject({ written: 0, unchanged: 4 }); // idempotent
  });
});

describe("tool 2: Google JSON to XMP", () => {
  test("date, description, favourite and people; 0,0 GPS ignored; the motion video inherits", async () => {
    expect(await previewJsonToXmp(db)).toEqual({
      files: 2,
      inherited: 1,
      withDate: 2,
      withGps: 0,
      withDescription: 2,
      withPeople: 2,
      favorites: 2,
    });
    expect(await runJsonToXmp(db)).toMatchObject({ written: 2, failed: 0 });
    const f = await sidecarFields("Takeout/Photos from 2019/PXL_1.jpg");
    expect(f).toEqual({
      dateTaken: { value: "2019-05-12T21:30:00+00:00", source: "json" },
      description: { value: "Beach", source: "json" },
      rating: { value: 5, source: "json" },
      people: { value: ["Heather"], source: "json" },
    });
    expect((await sidecarFields("Takeout/Photos from 2019/PXL_1.mp4"))?.dateTaken?.source).toBe("json");
  });

  test("either order gives the same sidecar: JSON beats the file's own date, camera is kept", async () => {
    await runXmpFromFiles(db);
    await runJsonToXmp(db);
    const a = await sidecarFields("Takeout/Photos from 2019/PXL_1.jpg");
    rmSync(xmpPath(P("Takeout/Photos from 2019/PXL_1.jpg")));
    await runJsonToXmp(db);
    await runXmpFromFiles(db);
    const b = await sidecarFields("Takeout/Photos from 2019/PXL_1.jpg");
    expect(a).toEqual(b);
    expect(a?.dateTaken?.source).toBe("json");
    expect(a?.cameraModel).toEqual({ value: "Pixel 8", source: "embedded" });
  });
});

describe("tool 3: remove Google JSON", () => {
  const removed: string[] = [];
  const remove: RemoveFile = async (path) => {
    removed.push(path);
    rmSync(path);
    return { success: true };
  };

  test("only JSON already converted to our XMP by default; album JSON on request", async () => {
    removed.length = 0;
    expect(await previewRemoveJson(db)).toEqual({ converted: 0, notConverted: 1, albumAndOther: 1 });
    expect(await runRemoveJson(db, {}, remove, "delete")).toMatchObject({ removed: 0 });
    await runJsonToXmp(db);
    expect(await previewRemoveJson(db)).toEqual({ converted: 1, notConverted: 0, albumAndOther: 1 });
    expect(await runRemoveJson(db, {}, remove, "delete")).toMatchObject({ removed: 1, failed: 0 });
    expect(existsSync(P("Takeout/Photos from 2019/PXL_1.jpg.json"))).toBe(false);
    expect(existsSync(P("Takeout/Trip/metadata.json"))).toBe(true);
    expect(await runRemoveJson(db, { includeAlbumAndOther: true }, remove, "delete")).toMatchObject({ removed: 1 });
    expect(await previewRemoveJson(db)).toEqual({ converted: 0, notConverted: 0, albumAndOther: 0 });
  });

  test("a failed removal is reported and its record kept", async () => {
    const fail: RemoveFile = async () => ({ success: false, error: "read-only" });
    const r = await runRemoveJson(db, { includeNotConverted: true, includeAlbumAndOther: true }, fail, "trash");
    expect(r).toMatchObject({ removed: 0, failed: 2, mode: "trash" });
    expect((await previewRemoveJson(db)).notConverted).toBe(1);
  });
});
