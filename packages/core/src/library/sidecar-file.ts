/**
 * Write a Giggle Photos XMP sidecar next to a media file (RFD-007), merging with the one already
 * there when we wrote it. Another app's `.xmp` is never touched. Originals are never written.
 */
import { readFile, writeFile } from "node:fs/promises";
import { parseXmp, renderXmp } from "./xmp-document";
import { mergeFields, sameFields, type XmpFields } from "./xmp-fields";

/** Sidecar path for a media file: `IMG_1.jpg.xmp` (Immich's preferred naming). */
export const xmpPath = (mediaPath: string): string => `${mediaPath}.xmp`;

export type SidecarOutcome = "written" | "unchanged" | "skipped_foreign" | "nothing_to_write";

/** Current state of a media file's sidecar. */
export async function readSidecar(
  mediaPath: string,
): Promise<{ exists: false } | ({ exists: true } & ReturnType<typeof parseXmp>)> {
  const text = await readFile(xmpPath(mediaPath), "utf-8").catch(() => null);
  return text === null ? { exists: false } : { exists: true, ...parseXmp(text) };
}

/** Merge `fields` into the media file's sidecar and write it when anything changed. */
export async function writeSidecar(mediaPath: string, fields: XmpFields): Promise<SidecarOutcome> {
  if (Object.keys(fields).length === 0) return "nothing_to_write";
  const current = await readSidecar(mediaPath);
  if (current.exists && !current.ours) return "skipped_foreign";
  const existing = current.exists && current.ours ? current.fields : {};
  const merged = mergeFields(existing, fields);
  if (current.exists && sameFields(existing, merged)) return "unchanged";
  await writeFile(xmpPath(mediaPath), renderXmp(merged), "utf-8");
  return "written";
}

export interface ToolRunResult {
  written: number;
  unchanged: number;
  /** Another app's sidecar is already there. */
  skipped: number;
  failed: number;
  errors: { path: string; error: string }[];
}

export const emptyRunResult = (): ToolRunResult => ({ written: 0, unchanged: 0, skipped: 0, failed: 0, errors: [] });

/** Write one sidecar and count the outcome. */
export async function writeAndCount(result: ToolRunResult, mediaPath: string, fields: XmpFields): Promise<void> {
  try {
    const outcome = await writeSidecar(mediaPath, fields);
    if (outcome === "written") result.written++;
    else if (outcome === "unchanged" || outcome === "nothing_to_write") result.unchanged++;
    else {
      result.skipped++;
      result.errors.push({ path: xmpPath(mediaPath), error: "An XMP sidecar from another app is already there" });
    }
  } catch (error) {
    result.failed++;
    result.errors.push({ path: xmpPath(mediaPath), error: error instanceof Error ? error.message : String(error) });
  }
}
