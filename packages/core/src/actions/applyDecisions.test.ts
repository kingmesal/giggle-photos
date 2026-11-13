import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database as SqliteDatabase } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { CamelCasePlugin, Kysely } from "kysely";
import { BunSqliteDialect } from "kysely-bun-sqlite";
import { initializeDatabase } from "../db/client";
import { FileDecisionProvider } from "../db/file-decision-provider";
import { MediaFileProvider } from "../db/media-file-provider";
import { PhashGroupProvider } from "../db/phash-group-provider";
import { ScanFolderProvider } from "../db/scan-folder-provider";
import type { DatabaseSchema } from "../db/schema";
import { TakeoutProvider } from "../db/takeout-provider";
import { type ApplyDb, applyDeletions } from "./applyDecisions";
import { restoreQuarantine } from "./quarantine";

// Real files in a temp library + a real in-memory database. ⚠️ FRAGILE area: every rule covered.
let base: string;
let library: string;
let quarantine: string;
let rawDb: SqliteDatabase;
let db: ApplyDb;
let decisions: FileDecisionProvider;
let media: MediaFileProvider;
const ids: Record<string, number> = {};
const Y = "Takeout/Google Photos/Photos from 2023";
const A = "Takeout/Google Photos/Trip";

async function addFile(scanFolderId: number, rel: string, sha: string) {
  const path = join(library, rel);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, rel);
  const f = await media.insertMediaFile({
    scanFolderId,
    path,
    filename: rel.split("/").pop() as string,
    extension: "jpg",
    fileType: rel.endsWith(".mp4") ? "video" : "image",
    size: rel.length,
    status: "processed",
    sha256Hash: sha,
  });
  ids[rel] = f.id;
}

beforeEach(async () => {
  base = mkdtempSync(join(tmpdir(), "apply-"));
  library = join(base, "library");
  quarantine = join(base, "quarantine");
  rawDb = new SqliteDatabase(":memory:");
  rawDb.run("PRAGMA foreign_keys = ON");
  const kysely = new Kysely<DatabaseSchema>({
    dialect: new BunSqliteDialect({ database: rawDb }),
    plugins: [new CamelCasePlugin()],
  });
  await initializeDatabase(kysely, ":memory:");
  const providers = {
    decisions: new FileDecisionProvider(kysely),
    media: new MediaFileProvider(kysely),
    phash: new PhashGroupProvider(kysely),
    takeout: new TakeoutProvider(kysely),
    scan: new ScanFolderProvider(kysely),
  };
  decisions = providers.decisions;
  media = providers.media;
  db = {
    getFileDecisionProvider: () => providers.decisions,
    getMediaFileProvider: () => providers.media,
    getPhashGroupProvider: () => providers.phash,
    getTakeoutProvider: () => providers.takeout,
    getScanFolderProvider: () => providers.scan,
  } as unknown as ApplyDb;
  const folder = await providers.scan.insertScanFolder({ path: library });

  // Group "shaA": year copy + album copy. Group "shaB": still (in a motion pair with a video) + album
  // copy (with its own video, so the year video is not the last copy).
  // Group "shaC": two files, both marked delete. Group "shaD": a file marked delete AND keep.
  for (const [rel, sha] of [
    [`${Y}/A.jpg`, "shaA"],
    [`${A}/A.jpg`, "shaA"],
    [`${Y}/B.jpg`, "shaB"],
    [`${Y}/B.mp4`, "shaBv"],
    [`${A}/B.jpg`, "shaB"],
    [`${A}/B.mp4`, "shaBv"], // the album copy has its own companion video, as in a real Takeout
    [`${Y}/C1.jpg`, "shaC"],
    [`${Y}/C2.jpg`, "shaC"],
    [`${Y}/D.jpg`, "shaD"],
    [`${A}/D.jpg`, "shaD"],
  ] as const) {
    await addFile(folder.id, rel, sha);
  }
  writeFileSync(join(library, `${Y}/A.jpg.json`), "{}");
  writeFileSync(join(library, `${Y}/B.jpg.json`), "{}");
  await providers.takeout.replaceIndex(folder.id, {
    folders: [],
    sidecars: [
      {
        folderKey: null,
        path: join(library, `${Y}/A.jpg.json`),
        kind: "media",
        mediaFileId: ids[`${Y}/A.jpg`] as number,
        matchMethod: "name_exact",
      },
      {
        folderKey: null,
        path: join(library, `${Y}/B.jpg.json`),
        kind: "media",
        mediaFileId: ids[`${Y}/B.jpg`] as number,
        matchMethod: "name_exact",
      },
    ],
    pairs: [
      { kind: "motion", primaryFileId: ids[`${Y}/B.jpg`] as number, secondaryFileId: ids[`${Y}/B.mp4`] as number },
      { kind: "motion", primaryFileId: ids[`${A}/B.jpg`] as number, secondaryFileId: ids[`${A}/B.mp4`] as number },
    ],
  });
  const decide = (rel: string, action: "keep" | "delete", key: string) =>
    decisions.insertFileDecision({ mediaFileId: ids[rel] as number, action, method: "sha256", reviewGroupKey: key });
  await decide(`${Y}/A.jpg`, "delete", "shaA");
  await decide(`${A}/A.jpg`, "keep", "shaA");
  await decide(`${Y}/B.jpg`, "delete", "shaB");
  await decide(`${A}/B.jpg`, "keep", "shaB");
  await decide(`${Y}/C1.jpg`, "delete", "shaC");
  await decide(`${Y}/C2.jpg`, "delete", "shaC");
  await decide(`${Y}/D.jpg`, "delete", "shaD");
  await decide(`${Y}/D.jpg`, "keep", "shaD-other");
});
afterEach(() => {
  rawDb.close();
  rmSync(base, { recursive: true, force: true });
});

const at = (rel: string) => join(library, rel);
const inQuarantine = (rel: string) => join(quarantine, rel);

describe("applyDeletions", () => {
  test("dry run returns the plan and changes nothing", async () => {
    const r = await applyDeletions({ dryRun: true, quarantineRoot: quarantine }, db);
    expect(r.mode).toBe("quarantine");
    expect(r.plan.remove.map((x) => [x.path.replace(`${library}/`, ""), x.because, x.sidecars])).toEqual([
      [`${Y}/A.jpg`, "decision", 1],
      [`${Y}/B.jpg`, "decision", 1],
      [`${Y}/B.mp4`, "motion_partner", 0],
      [`${Y}/C2.jpg`, "decision", 0],
    ]);
    expect(r.plan.skipped.map((s) => [s.path.replace(`${library}/`, ""), s.reason])).toEqual([
      [`${Y}/D.jpg`, "Also marked keep in another group"],
      [`${Y}/C1.jpg`, "Last copy in group shaC: kept"],
    ]);
    expect(existsSync(at(`${Y}/A.jpg`))).toBe(true);
    expect(existsSync(quarantine)).toBe(false);
    expect(await media.getMediaFileById(ids[`${Y}/A.jpg`] as number)).not.toBeNull();
  });

  test("quarantine moves exactly the planned files and their sidecars, mirroring the layout", async () => {
    const r = await applyDeletions({ quarantineRoot: quarantine }, db);
    expect({ success: r.success, failed: r.failed, skipped: r.skipped, sidecars: r.sidecarsRemoved }).toEqual({
      success: 4,
      failed: 0,
      skipped: 2,
      sidecars: 2,
    });
    for (const rel of [`${Y}/A.jpg`, `${Y}/A.jpg.json`, `${Y}/B.jpg`, `${Y}/B.jpg.json`, `${Y}/B.mp4`, `${Y}/C2.jpg`]) {
      expect({ rel, gone: !existsSync(at(rel)), quarantined: existsSync(inQuarantine(rel)) }).toEqual({
        rel,
        gone: true,
        quarantined: true,
      });
    }
    // Kept files, the last copy and the conflicted file are untouched.
    for (const rel of [`${A}/A.jpg`, `${A}/B.jpg`, `${A}/B.mp4`, `${Y}/C1.jpg`, `${Y}/D.jpg`, `${A}/D.jpg`]) {
      expect({ rel, present: existsSync(at(rel)) }).toEqual({ rel, present: true });
    }
    expect(readFileSync(inQuarantine(`${Y}/A.jpg`), "utf-8")).toBe(`${Y}/A.jpg`);
    // Records removed only for removed files.
    expect(await media.getMediaFileById(ids[`${Y}/A.jpg`] as number)).toBeNull();
    expect(await media.getMediaFileById(ids[`${Y}/C1.jpg`] as number)).not.toBeNull();
  });

  test("never the last copy, across a motion pair: a sole video copy protects its still", async () => {
    await media.deleteMediaFile(ids[`${A}/B.mp4`] as number); // now the year video is the only copy
    const r = await applyDeletions({ dryRun: true, quarantineRoot: quarantine }, db);
    expect(r.plan.remove.map((x) => x.path.replace(`${library}/`, ""))).not.toContain(`${Y}/B.jpg`);
    expect(r.plan.skipped.map((s) => s.path.replace(`${library}/`, ""))).toEqual(
      expect.arrayContaining([`${Y}/B.jpg`, `${Y}/B.mp4`]),
    );
  });

  test("everything quarantined can be restored", async () => {
    await applyDeletions({ quarantineRoot: quarantine }, db);
    const restored = await restoreQuarantine(quarantine);
    expect(restored).toEqual({ restored: 6, problems: [] });
    expect(existsSync(at(`${Y}/B.mp4`))).toBe(true);
    expect(existsSync(at(`${Y}/A.jpg.json`))).toBe(true);
  });

  test("a read-only folder makes that removal fail cleanly; its record stays", async () => {
    if (process.platform === "win32" || process.getuid?.() === 0) return; // permissions not enforced
    chmodSync(join(library, Y), 0o555);
    try {
      const r = await applyDeletions({ quarantineRoot: quarantine }, db);
      expect(r.failed).toBe(4);
      expect(r.success).toBe(0);
      expect(existsSync(at(`${Y}/A.jpg`))).toBe(true);
      expect(await media.getMediaFileById(ids[`${Y}/A.jpg`] as number)).not.toBeNull();
    } finally {
      chmodSync(join(library, Y), 0o755);
    }
  });

  test("without quarantine, permanent delete still honours every safety rule", async () => {
    const r = await applyDeletions({}, db);
    expect(r.mode).toBe("delete");
    expect(r.success).toBe(4);
    expect(existsSync(at(`${Y}/C1.jpg`))).toBe(true);
    expect(existsSync(at(`${A}/B.jpg`))).toBe(true);
    expect(existsSync(at(`${Y}/B.mp4`))).toBe(false);
  });
});
