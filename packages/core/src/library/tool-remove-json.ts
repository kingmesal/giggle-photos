// ⚠️ FRAGILE: See _FRAGILE.md — removes files from the user's library.
/**
 * Library tool 3 (RFD-007): remove Google Takeout JSON files, a post-import cleanup. immich-go's
 * `from-google-photos` needs them, so this is for after the import.
 *
 * By default only a photo's JSON whose data is already in our XMP sidecar (tool 2) is removed;
 * album metadata and other JSON (album references, unmatched, unreadable) need an explicit option.
 * Files go to quarantine when it is on (restorable), else to the trash or are deleted, per settings.
 */
import type { DatabaseProvider } from "../db/database-provider";
import { readSidecar } from "./sidecar-file";

type Db = Pick<DatabaseProvider, "getClient" | "getTakeoutProvider">;

export type JsonCategory = "converted" | "not_converted" | "album_or_other";

interface JsonFile {
  id: number;
  path: string;
  scanFolderPath: string;
  category: JsonCategory;
}

/** Whether a media file's sidecar is ours and carries Google JSON data. */
async function converted(mediaPath: string): Promise<boolean> {
  const sidecar = await readSidecar(mediaPath);
  if (!sidecar.exists || !sidecar.ours) return false;
  return Object.values(sidecar.fields).some((f) => f && typeof f === "object" && "source" in f && f.source === "json");
}

async function jsonFiles(db: Db): Promise<JsonFile[]> {
  const k = db.getClient().getDb();
  const rows = await k
    .selectFrom("sidecars as s")
    .innerJoin("scanFolders as f", "f.id", "s.scanFolderId")
    .leftJoin("mediaFiles as m", "m.id", "s.mediaFileId")
    .select(["s.id", "s.path", "s.kind", "s.matchMethod", "f.path as scanFolderPath", "m.path as mediaPath"])
    .orderBy("s.path")
    .execute();
  const out: JsonFile[] = [];
  for (const r of rows) {
    const ownMedia = r.kind === "media" && r.matchMethod !== "album_reference" && r.mediaPath;
    const category: JsonCategory = !ownMedia
      ? "album_or_other"
      : (await converted(r.mediaPath as string))
        ? "converted"
        : "not_converted";
    out.push({ id: Number(r.id), path: r.path, scanFolderPath: r.scanFolderPath, category });
  }
  return out;
}

export interface RemoveJsonOptions {
  /** Also remove photos' JSON not yet converted to XMP (their data is then gone from the library). */
  includeNotConverted?: boolean;
  /** Also remove album metadata, album references and unmatched or unreadable JSON. */
  includeAlbumAndOther?: boolean;
}

const selected = (f: JsonFile, o: RemoveJsonOptions) =>
  f.category === "converted" ||
  (f.category === "not_converted" && o.includeNotConverted === true) ||
  (f.category === "album_or_other" && o.includeAlbumAndOther === true);

export interface RemoveJsonPreview {
  converted: number;
  notConverted: number;
  albumAndOther: number;
}

export async function previewRemoveJson(db: Db): Promise<RemoveJsonPreview> {
  const files = await jsonFiles(db);
  const n = (c: JsonCategory) => files.filter((f) => f.category === c).length;
  return { converted: n("converted"), notConverted: n("not_converted"), albumAndOther: n("album_or_other") };
}

export interface RemoveJsonResult {
  removed: number;
  failed: number;
  mode: "quarantine" | "trash" | "delete";
  errors: { path: string; error: string }[];
}

/** How each file is removed; supplied by the caller (quarantine, trash or delete per settings). */
export type RemoveFile = (path: string, scanFolderPath: string) => Promise<{ success: boolean; error?: string }>;

export async function runRemoveJson(
  db: Db,
  options: RemoveJsonOptions,
  remove: RemoveFile,
  mode: RemoveJsonResult["mode"],
  onProgress?: (done: number, total: number) => void,
): Promise<RemoveJsonResult> {
  const todo = (await jsonFiles(db)).filter((f) => selected(f, options));
  const result: RemoveJsonResult = { removed: 0, failed: 0, mode, errors: [] };
  const removedIds: number[] = [];
  for (const [i, f] of todo.entries()) {
    const outcome = await remove(f.path, f.scanFolderPath).catch((e: unknown) => ({
      success: false,
      error: e instanceof Error ? e.message : String(e),
    }));
    if (outcome.success) {
      result.removed++;
      removedIds.push(f.id);
    } else {
      result.failed++;
      result.errors.push({ path: f.path, error: outcome.error ?? "Unknown error" });
    }
    onProgress?.(i + 1, todo.length);
  }
  await db.getTakeoutProvider().deleteSidecars(removedIds);
  return result;
}
