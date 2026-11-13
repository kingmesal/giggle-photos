import { Database as SqliteDatabase } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { CamelCasePlugin, Kysely } from "kysely";
import { BunSqliteDialect } from "kysely-bun-sqlite";
import { initializeDatabase } from "./client";
import { ClipProvider } from "./clip-provider";
import { MediaFileProvider } from "./media-file-provider";
import { ScanFolderProvider } from "./scan-folder-provider";
import type { DatabaseSchema } from "./schema";
import { VideoMetadataProvider } from "./video-metadata-provider";

const MODEL = "test-model@1";
const D = 2;
let raw: SqliteDatabase;
let clip: ClipProvider;
let image: number;
let video: number;
let videoNoMeta: number;

beforeEach(async () => {
  raw = new SqliteDatabase(":memory:");
  raw.run("PRAGMA foreign_keys = ON");
  const k = new Kysely<DatabaseSchema>({
    dialect: new BunSqliteDialect({ database: raw }),
    plugins: [new CamelCasePlugin()],
  });
  await initializeDatabase(k, ":memory:");
  const folder = await new ScanFolderProvider(k).insertScanFolder({ path: "/p" });
  const media = new MediaFileProvider(k);
  const add = async (name: string, fileType: "image" | "video") =>
    (
      await media.insertMediaFile({
        scanFolderId: folder.id,
        path: `/p/${name}`,
        filename: name,
        extension: fileType === "image" ? "jpg" : "mp4",
        fileType,
        size: 1,
        status: "processed",
      })
    ).id;
  image = await add("a.jpg", "image");
  video = await add("b.mp4", "video");
  videoNoMeta = await add("c.mp4", "video");
  await new VideoMetadataProvider(k).insertVideoMetadata({ mediaFileId: video, width: 4, height: 3, duration: 12.5 });
  clip = new ClipProvider(k);
});
afterEach(() => raw.close());

const vec = (x: number) => Float32Array.from([x, 1 - x]);

describe("ClipProvider — video frames (RFD-002 §E)", () => {
  test("videos with a duration and no frames need embedding", async () => {
    expect(await clip.getVideosMissingFrames(MODEL)).toEqual([{ id: video, path: "/p/b.mp4", durationSec: 12.5 }]);
    await clip.upsertEmbeddings([{ mediaFileId: video, frameIndex: 0, modelId: MODEL, embedding: vec(0) }]);
    expect(await clip.getVideosMissingFrames(MODEL)).toEqual([]);
    expect(videoNoMeta).toBeGreaterThan(0);
  });

  test("frames load per video in position order; image matching never sees video frames", async () => {
    await clip.upsertEmbeddings([
      { mediaFileId: image, modelId: MODEL, embedding: vec(0.5) },
      ...[2, 0, 1].map((frameIndex) => ({
        mediaFileId: video,
        frameIndex,
        modelId: MODEL,
        embedding: vec(frameIndex / 10),
      })),
    ]);
    const videos = await clip.loadVideoFrames(MODEL, D);
    expect(videos).toHaveLength(1);
    expect(videos[0]?.durationSec).toBe(12.5);
    expect(videos[0]?.frames.map((f) => Math.round((f[0] as number) * 10))).toEqual([0, 1, 2]);
    const images = await clip.loadEmbeddings(MODEL, D);
    expect(images.ids).toEqual([image]);
  });
});
