import { Database as SqliteDatabase } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { CamelCasePlugin, Kysely } from "kysely";
import { BunSqliteDialect } from "kysely-bun-sqlite";
import { initializeDatabase } from "../db/client";
import type { DatabaseProvider } from "../db/database-provider";
import { MediaFileProvider } from "../db/media-file-provider";
import { ScanFolderProvider } from "../db/scan-folder-provider";
import type { DatabaseSchema } from "../db/schema";
import type { TakeoutSummary } from "../db/takeout-provider";
import { TakeoutProvider } from "../db/takeout-provider";
import { compareImport, getLibraryCounts, parseImmichGoReport } from "./import-check";

// Same layout as immich-go v0.32 GenerateEventReport: fmt "  %-35s: %7d  (%s)".
const pad = (name: string, n: number, size = "") =>
  `  ${name.padEnd(35)}: ${String(n).padStart(7)}${size ? `  (${size})` : ""}`;
const REPORT = [
  "",
  "Event Report:",
  "=============",
  "",
  "Discovery (Assets):",
  pad("discovered image", 120, "1.2 GB"),
  pad("discovered video", 8, "300 MB"),
  "",
  "Discovery (Non-Assets):",
  pad("discovered sidecar", 110, "200 KB"),
  pad("discovered metadata", 4, "1 KB"),
  "",
  "Asset Lifecycle (DISCARDED):",
  pad("discarded local duplicate", 15),
  pad("missing metadata", 3),
  pad("live photo", 6),
].join("\n");

const SUMMARY: TakeoutSummary = {
  folders: { year: 2, album: 3, special: 0 },
  sidecars: { media: 110, album_metadata: 3, other: 1, unparseable: 0 },
  mediaSidecarsMatched: 108,
  mediaSidecarsUnmatched: 2,
  byMethod: {},
  mediaWithoutSidecar: 3,
  pairs: { motion: 6, edited: 1 },
};

describe("parseImmichGoReport", () => {
  test("reads every event line of the report, ignoring headings and sizes", () => {
    expect(parseImmichGoReport(REPORT)).toEqual({
      "discovered image": 120,
      "discovered video": 8,
      "discovered sidecar": 110,
      "discovered metadata": 4,
      "discarded local duplicate": 15,
      "missing metadata": 3,
      "live photo": 6,
    });
  });

  test("nothing recognisable → empty", () => {
    expect(parseImmichGoReport("No events recorded\n")).toEqual({});
  });
});

describe("compareImport", () => {
  const counts = { images: 120, videos: 9, albumsWithFiles: 2, albumsTotal: 3 };

  test("exact rows match or differ; the rest are information", () => {
    const { rows } = compareImport(counts, SUMMARY, parseImmichGoReport(REPORT));
    const by = Object.fromEntries(rows.map((r) => [r.label, [r.app, r.immichGo, r.status]]));
    expect(by).toEqual({
      Photos: [120, 120, "match"],
      Videos: [9, 8, "differs"],
      "JSON sidecars": [114, 114, "info"],
      "Without metadata": [3, 3, "info"],
      "Live photos": [6, 6, "info"],
      "Album copies merged": [null, 15, "info"],
      "Albums with files": [2, null, "differs"],
    });
  });

  test("without a report, immich-go columns are empty and nothing is judged", () => {
    const { rows } = compareImport(counts, SUMMARY, {});
    expect(rows.every((r) => r.immichGo === null)).toBe(true);
    expect(rows.find((r) => r.label === "Photos")?.status).toBe("info");
  });

  test("immich-go problems get their own row", () => {
    const { rows } = compareImport(counts, SUMMARY, { "discovered image": 1, "file access error": 2 });
    expect(rows.at(-1)).toMatchObject({ label: "Problems", immichGo: 2, status: "differs" });
  });
});

describe("getLibraryCounts", () => {
  test("counts media in Takeout scan folders and albums that still have files", async () => {
    const raw = new SqliteDatabase(":memory:");
    const k = new Kysely<DatabaseSchema>({
      dialect: new BunSqliteDialect({ database: raw }),
      plugins: [new CamelCasePlugin()],
    });
    await initializeDatabase(k, ":memory:");
    const scan = new ScanFolderProvider(k);
    const takeoutFolder = await scan.insertScanFolder({ path: "/t" });
    const plain = await scan.insertScanFolder({ path: "/other" });
    const media = new MediaFileProvider(k);
    const add = async (scanFolderId: number, path: string, fileType: "image" | "video") =>
      (
        await media.insertMediaFile({
          scanFolderId,
          path,
          filename: path.split("/").pop() as string,
          extension: "jpg",
          fileType,
          size: 1,
          status: "processed",
        })
      ).id;
    const a = await add(takeoutFolder.id, "/t/GP/Trip/a.jpg", "image");
    const v = await add(takeoutFolder.id, "/t/GP/Photos from 2023/v.mp4", "video");
    await add(plain.id, "/other/x.jpg", "image");
    const folder = (key: string, kind: "album" | "year", mediaFileIds: number[]) => ({
      key,
      folder: { rootPath: "/t/GP", path: `/t/GP/${key}`, kind, albumTitle: kind === "album" ? key : null },
      mediaFileIds,
    });
    await new TakeoutProvider(k).replaceIndex(takeoutFolder.id, {
      folders: [folder("Trip", "album", [a]), folder("Empty", "album", []), folder("Photos from 2023", "year", [v])],
      sidecars: [],
      pairs: [],
    });
    const db = { getClient: () => ({ getDb: () => k }) } as unknown as Pick<DatabaseProvider, "getClient">;
    expect(await getLibraryCounts(db)).toEqual({ images: 1, videos: 1, albumsWithFiles: 1, albumsTotal: 2 });
    raw.close();
  });
});
