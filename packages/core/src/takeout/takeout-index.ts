/**
 * Index a scanned folder's Google Takeout structure (RFD-003 steps 1–2): classify folders, parse
 * every JSON sidecar, link sidecars to the media already in the database, detect pairs, and store
 * it all in one transaction. Re-running replaces the previous index.
 */
import type { Dirent } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { basename, join, sep } from "node:path";
import { DatabaseProvider } from "../db/database-provider";
import type { TakeoutIndexInput, TakeoutSummary } from "../db/takeout-provider";
import { getLogger } from "../logging/logger";
import type { NewSidecar } from "../zod/sidecar";
import { classifyTakeoutFolder, isGooglePhotosDirName } from "./folder-classify";
import { type MatchFolder, type MatchSidecar, matchSidecars } from "./sidecar-match";
import { MAX_SIDECAR_BYTES, parseSidecarJson } from "./sidecar-parse";

const log = getLogger("core:takeout-index");
const MAX_ROOT_SEARCH_DEPTH = 4;

export interface TakeoutIndexResult {
  /** Google Photos directories found under the scan folder. */
  roots: string[];
  /** Pre-flight problems (RFD-003 §A): several Takeout trees, unextracted zip parts. */
  warnings: string[];
  summary: TakeoutSummary | null;
}

async function entries(dir: string): Promise<Dirent[]> {
  try {
    return await readdir(dir, { withFileTypes: true });
  } catch (error) {
    log.warn(`Cannot read ${dir}: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

/** Google Photos directories within `dir` (not following symlinks), plus any zip parts seen. */
async function findRoots(dir: string, depth: number, found: { roots: string[]; zips: string[] }): Promise<void> {
  if (isGooglePhotosDirName(basename(dir))) {
    found.roots.push(dir);
    return;
  }
  if (depth >= MAX_ROOT_SEARCH_DEPTH) return;
  for (const entry of await entries(dir)) {
    if (entry.isFile() && /^takeout-.*\.(zip|tgz|tar\.gz)$/i.test(entry.name)) found.zips.push(join(dir, entry.name));
    if (entry.isDirectory()) await findRoots(join(dir, entry.name), depth + 1, found);
  }
}

/** All JSON files below `dir`. */
async function jsonFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await entries(dir)) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await jsonFiles(path)));
    else if (entry.isFile() && entry.name.toLowerCase().endsWith(".json")) out.push(path);
  }
  return out;
}

type SidecarRow = TakeoutIndexInput["sidecars"][number];

async function readSidecar(path: string, folderKey: string | null): Promise<SidecarRow> {
  const base: Omit<NewSidecar, "scanFolderId" | "takeoutFolderId" | "kind"> & { folderKey: string | null } = {
    folderKey,
    path,
  };
  try {
    if ((await stat(path)).size > MAX_SIDECAR_BYTES) return { ...base, kind: "other" };
    const { kind, title, description, photoTakenTime, geoLat, geoLon, geoAlt, trashed, archived, favorited, people } =
      parseSidecarJson(await readFile(path, "utf-8"));
    return {
      ...base,
      kind,
      title,
      description,
      photoTakenTime,
      geoLat,
      geoLon,
      geoAlt,
      trashed,
      archived,
      favorited,
      people,
    };
  } catch {
    return { ...base, kind: "unparseable" };
  }
}

/** The providers indexing needs (DatabaseProvider in the app; real providers over a test DB in tests). */
export type TakeoutIndexDb = Pick<
  DatabaseProvider,
  "getScanFolderProvider" | "getMediaFileProvider" | "getTakeoutProvider"
>;

/** Index one scan folder. Returns null summary when it holds no Google Takeout. */
export async function indexTakeout(scanFolderId: number, database?: TakeoutIndexDb): Promise<TakeoutIndexResult> {
  const db = database ?? (await DatabaseProvider.getInstance());
  const scanFolder = await db.getScanFolderProvider().getScanFolderById(scanFolderId);
  if (!scanFolder) throw new Error(`Scan folder ${scanFolderId} not found`);

  const found = { roots: [] as string[], zips: [] as string[] };
  await findRoots(scanFolder.path, 0, found);
  const warnings: string[] = [];
  if (found.roots.length > 1) {
    warnings.push(
      `Found ${found.roots.length} Google Photos folders. Extract all Takeout parts into ONE tree: a sidecar can be in a different part than its photo.`,
    );
  }
  if (found.zips.length > 0)
    warnings.push(`Found ${found.zips.length} unextracted Takeout archive(s); extract them first.`);
  const takeout = db.getTakeoutProvider();
  if (found.roots.length === 0) {
    await takeout.replaceIndex(scanFolderId, { folders: [], sidecars: [], pairs: [] });
    return { roots: [], warnings, summary: null };
  }

  const media = await db.getMediaFileProvider().getMediaFilesByFolderId(scanFolderId);
  const input: TakeoutIndexInput = { folders: [], sidecars: [], pairs: [] };
  const matchFolders: MatchFolder[] = [];
  const matchMedia: { id: number; folderId: number; name: string }[] = [];
  const folderIndexByKey = new Map<string, number>();

  for (const [rootIndex, root] of found.roots.entries()) {
    for (const path of await jsonFiles(root)) {
      if (path.slice(root.length + 1).includes(sep)) continue; // folder JSON handled below
      input.sidecars.push(await readSidecar(path, null));
    }
    for (const entry of await entries(root)) {
      if (!entry.isDirectory()) continue;
      const path = join(root, entry.name);
      const { kind, year, albumTitle } = classifyTakeoutFolder(entry.name);
      const key = path;
      const folderIndex = matchFolders.length + 1;
      const sidecars = await Promise.all((await jsonFiles(path)).map((p) => readSidecar(p, key)));
      const albumMeta = sidecars.find((s) => s.kind === "album_metadata");
      const prefix = path + sep;
      const inFolder = media.filter((m) => m.path.startsWith(prefix));
      input.folders.push({
        key,
        folder: {
          rootPath: root,
          path,
          kind,
          year,
          albumTitle: kind === "album" ? (albumMeta?.title ?? albumTitle) : null,
        },
        mediaFileIds: inFolder.map((m) => m.id),
      });
      matchFolders.push({ id: folderIndex, rootId: rootIndex, kind, year });
      folderIndexByKey.set(key, folderIndex);
      for (const m of inFolder) matchMedia.push({ id: m.id, folderId: folderIndex, name: m.filename });
      input.sidecars.push(...sidecars);
    }
  }

  // Match: sidecar ids are their index in input.sidecars.
  const matchSidecarsInput: MatchSidecar[] = input.sidecars.flatMap((s, i) =>
    s.kind === "media" && s.folderKey !== null
      ? [
          {
            id: i,
            folderId: folderIndexByKey.get(s.folderKey) as number,
            name: basename(s.path),
            title: s.title ?? null,
            // readSidecar only ever stores a Date or null here (NewSidecar is a loose Zod input type).
            photoTakenTime: (s.photoTakenTime as Date | null | undefined) ?? null,
          },
        ]
      : [],
  );
  const result = matchSidecars(matchFolders, matchMedia, matchSidecarsInput);
  for (const link of result.links) {
    const row = input.sidecars[link.sidecarId] as SidecarRow;
    row.mediaFileId = link.mediaFileId;
    row.matchMethod = link.method;
  }
  input.pairs = result.pairs.map((p) => ({ kind: p.kind, primaryFileId: p.primaryId, secondaryFileId: p.secondaryId }));

  await takeout.replaceIndex(scanFolderId, input);
  const summary = await takeout.getSummary();
  log.info(`Takeout indexed for ${scanFolder.path}: ${JSON.stringify(summary)}`);
  return { roots: found.roots, warnings, summary };
}
