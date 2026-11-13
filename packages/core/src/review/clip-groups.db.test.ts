import { Database as SqliteDatabase } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { CamelCasePlugin, Kysely } from "kysely";
import { BunSqliteDialect } from "kysely-bun-sqlite";
import { CLIP_MODEL } from "../clip/model-manifest";
import { initializeDatabase } from "../db/client";
import { ClipProvider } from "../db/clip-provider";
import type { DatabaseProvider } from "../db/database-provider";
import { FileDecisionProvider } from "../db/file-decision-provider";
import { MediaFileProvider } from "../db/media-file-provider";
import { ScanFolderProvider } from "../db/scan-folder-provider";
import type { DatabaseSchema } from "../db/schema";
import { getClipGroupSummaries, loadClipGroups } from "./clip-groups";

// Real in-memory database; settings passed explicitly so the user's config is never read.
const SETTINGS = {
  clipEnabled: true,
  clipStrongMaxDistance: 0.02,
  clipReviewMaxDistance: 0.06,
  clipSimilarShotsEnabled: false,
  clipStoreMaxDistance: 0.12,
};
let raw: SqliteDatabase;
let decisions: FileDecisionProvider;
let db: Parameters<typeof getClipGroupSummaries>[0];
const ids: number[] = [];

beforeEach(async () => {
  raw = new SqliteDatabase(":memory:");
  raw.run("PRAGMA foreign_keys = ON");
  const kysely = new Kysely<DatabaseSchema>({
    dialect: new BunSqliteDialect({ database: raw }),
    plugins: [new CamelCasePlugin()],
  });
  await initializeDatabase(kysely, ":memory:");
  const folder = await new ScanFolderProvider(kysely).insertScanFolder({ path: "/lib" });
  const media = new MediaFileProvider(kysely);
  ids.length = 0;
  // Files 1 and 2 are exact copies (same SHA-256); the rest are distinct.
  for (const [i, sha] of ["s1", "s1", "s3", "s4", "s5"].entries()) {
    const f = await media.insertMediaFile({
      scanFolderId: folder.id,
      path: `/lib/${i + 1}.jpg`,
      filename: `${i + 1}.jpg`,
      extension: "jpg",
      fileType: "image",
      size: 100 * (i + 1),
      status: "processed",
      sha256Hash: sha,
    });
    ids.push(f.id);
  }
  const [a, b, c, d, e] = ids as [number, number, number, number, number];
  const clip = new ClipProvider(kysely);
  await clip.replaceMatches(CLIP_MODEL.id, [
    { mediaFileId1: a, mediaFileId2: b, distance: 0.01 }, // already an exact-copy group: left out
    { mediaFileId1: b, mediaFileId2: c, distance: 0.02 },
    { mediaFileId1: d, mediaFileId2: e, distance: 0.05 },
    { mediaFileId1: c, mediaFileId2: e, distance: 0.1 }, // above the review cutoff
  ]);
  decisions = new FileDecisionProvider(kysely);
  db = {
    getClient: () => ({ getDb: () => kysely }),
    getClipProvider: () => clip,
    getFileDecisionProvider: () => decisions,
  } as unknown as Pick<DatabaseProvider, "getClient" | "getClipProvider" | "getFileDecisionProvider">;
});
afterEach(() => raw.close());

describe("CLIP review groups over the database", () => {
  test("groups pairs under the review cutoff, skipping pairs grouped by SHA-256", async () => {
    const groups = await loadClipGroups(db, new Set(), SETTINGS);
    const [, b, c, d, e] = ids;
    expect(groups.map((g) => g.memberIds)).toEqual([
      [b, c],
      [d, e],
    ]);
  });

  test("similar-shots mode widens the cutoff to everything stored", async () => {
    const groups = await loadClipGroups(db, new Set(), { ...SETTINGS, clipSimilarShotsEnabled: true });
    expect(groups.map((g) => g.memberIds.length)).toEqual([4]);
  });

  test("CLIP turned off shows no groups", async () => {
    expect(await loadClipGroups(db, new Set(), { ...SETTINGS, clipEnabled: false })).toEqual([]);
  });

  test("summaries: sizes, no preselection, decided state per group key", async () => {
    const [, b, c] = ids as number[];
    for (const id of [b, c] as number[]) {
      await decisions.insertFileDecision({
        mediaFileId: id,
        action: "keep",
        method: "clip",
        reviewGroupKey: `clip:${b}`,
      });
    }
    const summaries = await getClipGroupSummaries(db, new Set(), SETTINGS);
    expect(summaries.map((s) => [s.groupKey, s.fileCount, s.totalSize, s.suggestedKeepFileId, s.allDecided])).toEqual([
      [`clip:${b}`, 2, 500, 0, true],
      [`clip:${ids[3]}`, 2, 900, 0, false],
    ]);
    expect(summaries[1]?.minClipDistance).toBeCloseTo(0.05);
  });

  test("files already marked delete drop out of their CLIP group", async () => {
    const groups = await loadClipGroups(db, new Set([ids[4] as number]), SETTINGS);
    expect(groups.map((g) => g.memberIds)).toEqual([[ids[1], ids[2]]]);
  });
});
