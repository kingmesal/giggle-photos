/**
 * Import check before Immich (RFD-003 §G): compare what `immich-go upload from-google-photos
 * --dry-run <Takeout root>` reports with what the app knows about the pruned library.
 *
 * immich-go (v0.32) ends a run with an "Event Report" of lines like
 * `  discovered image                   :    1234  (2.1 GB)`; `parseImmichGoReport` reads any
 * `name: count` line, so new or reordered events do not break it.
 */
import type { DatabaseProvider } from "../db/database-provider";
import type { TakeoutSummary } from "../db/takeout-provider";

export interface LibraryCounts {
  /** Media files in scan folders that contain a Google Takeout. */
  images: number;
  videos: number;
  /** Album folders with at least one media file left, and all album folders indexed. */
  albumsWithFiles: number;
  albumsTotal: number;
}

export interface ImportCheckRow {
  label: string;
  app: number | null;
  immichGo: number | null;
  /** match / differs only where both count the same thing; info otherwise. */
  status: "match" | "differs" | "info";
  note: string;
}

export interface ImportCheckResult {
  rows: ImportCheckRow[];
  /** Every event immich-go reported, as parsed. */
  events: Record<string, number>;
}

const LINE = /^\s*([a-z][a-z ]*[a-z])\s*:\s*(\d+)(?:\s|$)/i;

/** Event name (lower case) → count, from immich-go's console output or log. */
export function parseImmichGoReport(text: string): Record<string, number> {
  const events: Record<string, number> = {};
  for (const raw of text.split(/\r?\n/)) {
    // Log lines may carry a timestamp/level prefix; the event report lines are the indented ones.
    const m = LINE.exec(raw.replace(/^.*?(?=\s{2}[a-z])/i, ""));
    if (m?.[1] && m[2]) events[m[1].toLowerCase().replace(/\s+/g, " ")] = Number(m[2]);
  }
  return events;
}

/** Build the comparison rows. Missing immich-go events count as 0 once any event was parsed. */
export function compareImport(
  counts: LibraryCounts,
  takeout: TakeoutSummary,
  events: Record<string, number>,
): ImportCheckResult {
  const parsed = Object.keys(events).length > 0;
  const ev = (...names: string[]) => (parsed ? names.reduce((n, name) => n + (events[name] ?? 0), 0) : null);
  const exact = (app: number, immichGo: number | null): ImportCheckRow["status"] =>
    immichGo === null ? "info" : app === immichGo ? "match" : "differs";
  const images = ev("discovered image");
  const videos = ev("discovered video");
  const rows: ImportCheckRow[] = [
    {
      label: "Photos",
      app: counts.images,
      immichGo: images,
      status: exact(counts.images, images),
      note: "Every photo file on disk, album copies included",
    },
    {
      label: "Videos",
      app: counts.videos,
      immichGo: videos,
      status: exact(counts.videos, videos),
      note: "Every video file on disk, including live-photo videos",
    },
    {
      label: "JSON sidecars",
      app: takeout.sidecars.media + takeout.sidecars.album_metadata + takeout.sidecars.other,
      immichGo: ev("discovered sidecar", "discovered metadata"),
      status: "info",
      note: "immich-go may classify album metadata differently",
    },
    {
      label: "Without metadata",
      app: takeout.mediaWithoutSidecar,
      immichGo: ev("missing metadata"),
      status: "info",
      note: "These keep only their embedded EXIF dates",
    },
    {
      label: "Live photos",
      app: takeout.pairs.motion,
      immichGo: ev("live photo"),
      status: "info",
      note: "Still + video pairs",
    },
    {
      label: "Album copies merged",
      app: null,
      immichGo: ev("discarded local duplicate"),
      status: "info",
      note: "The same file in a year and an album folder becomes one asset in that album",
    },
    {
      label: "Albums with files",
      app: counts.albumsWithFiles,
      immichGo: null,
      status: counts.albumsWithFiles < counts.albumsTotal ? "differs" : "info",
      note: `${counts.albumsTotal - counts.albumsWithFiles} of ${counts.albumsTotal} album folders are now empty`,
    },
  ];
  const problems = ev("discovered unsupported file", "file access error", "incomplete processing", "upload failed");
  if (problems) {
    rows.push({ label: "Problems", app: null, immichGo: problems, status: "differs", note: "Check immich-go's log" });
  }
  return { rows, events };
}

/** Counts for the comparison, from the database. */
export async function getLibraryCounts(db: Pick<DatabaseProvider, "getClient">): Promise<LibraryCounts> {
  const k = db.getClient().getDb();
  const folders = await k.selectFrom("takeoutFolders").select(["id", "scanFolderId", "kind"]).execute();
  const scanFolderIds = [...new Set(folders.map((f) => f.scanFolderId as number))];
  if (scanFolderIds.length === 0) return { images: 0, videos: 0, albumsWithFiles: 0, albumsTotal: 0 };
  const media = await k
    .selectFrom("mediaFiles")
    .select(["fileType", "takeoutFolderId"])
    .where("scanFolderId", "in", scanFolderIds)
    .execute();
  const withFiles = new Set(media.map((m) => m.takeoutFolderId));
  const albums = folders.filter((f) => f.kind === "album");
  return {
    images: media.filter((m) => m.fileType === "image").length,
    videos: media.filter((m) => m.fileType === "video").length,
    albumsWithFiles: albums.filter((a) => withFiles.has(a.id as number)).length,
    albumsTotal: albums.length,
  };
}
