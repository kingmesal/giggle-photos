/**
 * Apply capture-date proposals (RFD-006) as XMP sidecars: `<file>.xmp` next to each photo or video
 * (e.g. `IMG_1.jpg.xmp`, the naming Immich prefers), never touching the original. Then the database
 * records the date (`dateTaken`), so the file is not proposed again.
 *
 * Sidecars this app wrote are marked (xmp:CreatorTool "Giggle Photos") and may be rewritten; any
 * other existing `.xmp` belongs to someone else and is left alone (reported as skipped).
 */
import { readFile, writeFile } from "node:fs/promises";
import type { DatabaseProvider } from "../db/database-provider";
import { getLogger } from "../logging/logger";
import { type CaptureDateProposal, findCaptureDateProposals } from "./capture-dates";

const log = getLogger("core:capture-dates");
export const CREATOR_TOOL = "Giggle Photos";

/** Sidecar path for a media file. */
export const xmpPath = (mediaPath: string): string => `${mediaPath}.xmp`;

/** XMP date value: exact instants keep their UTC offset; wall times carry no zone. */
export function xmpDate(p: CaptureDateProposal): string {
  return p.precision === "exact" ? `${p.takenAt.slice(0, 19)}+00:00` : p.takenAt.slice(0, 19);
}

const escapeXml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The sidecar document for one proposal. Pure. */
export function captureDateXmp(p: CaptureDateProposal): string {
  const d = xmpDate(p);
  const source = escapeXml(`${p.source}: ${p.detail}`);
  return `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="${CREATOR_TOOL}">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:exif="http://ns.adobe.com/exif/1.0/"
    xmlns:xmp="http://ns.adobe.com/xap/1.0/"
    xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/"
    xmlns:dc="http://purl.org/dc/elements/1.1/"
    exif:DateTimeOriginal="${d}"
    xmp:CreateDate="${d}"
    photoshop:DateCreated="${d}"
    xmp:CreatorTool="${CREATOR_TOOL}">
   <dc:source>${source}</dc:source>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>
`;
}

export interface ApplyCaptureDatesResult {
  written: number;
  failed: number;
  /** Files that already have an .xmp written by something else (left alone). */
  skipped: number;
  errors: { fileId: number; path: string; error: string }[];
}

type Db = Pick<DatabaseProvider, "getClient" | "getImageMetadataProvider" | "getVideoMetadataProvider">;

async function recordDate(db: Db, p: CaptureDateProposal): Promise<void> {
  const dateTaken = new Date(p.takenAt);
  if (p.fileType === "image") {
    const meta = await db.getImageMetadataProvider().getByMediaFileIds([p.fileId]);
    if (meta[0]) await db.getImageMetadataProvider().updateImageMetadata({ id: meta[0].id, dateTaken });
  } else {
    const meta = await db.getVideoMetadataProvider().getVideoMetadataByMediaFileIds([p.fileId]);
    if (meta[0]) await db.getVideoMetadataProvider().updateVideoMetadata({ id: meta[0].id, dateTaken });
  }
}

/** "ours" when this app wrote the sidecar, "foreign" when someone else did, null when there is none. */
async function existingSidecar(path: string): Promise<"ours" | "foreign" | null> {
  const text = await readFile(path, "utf-8").catch(() => null);
  if (text === null) return null;
  return text.includes(`xmp:CreatorTool="${CREATOR_TOOL}"`) ? "ours" : "foreign";
}

/**
 * Write a sidecar for every current proposal (or only `fileIds`). Each file is independent: a
 * failure is reported and the rest continue. Proposals are recomputed here, so a file dated since
 * the review is skipped.
 */
export async function applyCaptureDates(
  db: Db,
  options: { fileIds?: number[]; onProgress?: (done: number, total: number, path: string) => void } = {},
): Promise<ApplyCaptureDatesResult> {
  const { proposals } = await findCaptureDateProposals(db);
  const wanted = options.fileIds ? new Set(options.fileIds) : null;
  const todo = wanted ? proposals.filter((p) => wanted.has(p.fileId)) : proposals;
  const result: ApplyCaptureDatesResult = { written: 0, failed: 0, skipped: 0, errors: [] };
  log.info("Writing capture-date sidecars", { files: todo.length });
  for (const [i, p] of todo.entries()) {
    const target = xmpPath(p.path);
    try {
      if ((await existingSidecar(target)) === "foreign") {
        result.skipped++;
        result.errors.push({
          fileId: p.fileId,
          path: target,
          error: "An XMP sidecar from another app is already there",
        });
      } else {
        await writeFile(target, captureDateXmp(p), "utf-8");
        await recordDate(db, p);
        result.written++;
      }
    } catch (error) {
      result.failed++;
      const message = error instanceof Error ? error.message : String(error);
      result.errors.push({ fileId: p.fileId, path: target, error: message });
      log.warn("Could not write capture-date sidecar", { path: target, error: message });
    }
    options.onProgress?.(i + 1, todo.length, p.path);
  }
  log.info("Capture-date sidecars written", {
    written: result.written,
    skipped: result.skipped,
    failed: result.failed,
  });
  return result;
}
