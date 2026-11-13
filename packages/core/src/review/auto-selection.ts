/**
 * Group suggestion for review: Takeout-aware preselection (RFD-003 §E, see preselect.ts) over the
 * files of one group. ⚠️ FRAGILE: See _FRAGILE.md
 */
import type { TakeoutProvider } from "../db/takeout-provider";
import type { FileDecisionMethod } from "../zod/file-decision";
import { type PreselectFile, preselect } from "./preselect";
import type { AutoSelection, FileWithReviewContext } from "./review-queries";

/** dateTaken (images) or creationTime (videos), if known. */
export function getDateTaken(ctx: FileWithReviewContext): Date | null {
  const meta = ctx.metadata as Record<string, unknown> | null;
  const value = meta?.dateTaken ?? meta?.creationTime;
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value as string);
  return Number.isNaN(date.getTime()) ? null : date;
}

const EXIF_FIELDS = [
  "cameraMake",
  "cameraModel",
  "dateTaken",
  "gpsLatitude",
  "gpsLongitude",
  "gpsAltitude",
  "orientation",
  "colorSpace",
];

function exifFieldCount(ctx: FileWithReviewContext): number {
  const meta = ctx.metadata as Record<string, unknown> | null;
  return meta ? EXIF_FIELDS.filter((k) => meta[k] !== null && meta[k] !== undefined).length : 0;
}

function pixels(ctx: FileWithReviewContext): number {
  const meta = ctx.metadata as { width?: number; height?: number } | null;
  return (meta?.width ?? 0) * (meta?.height ?? 0);
}

/** Suggest which files to keep in a group (several for album copies; none for clip). */
export async function computeAutoSelection(
  takeout: Pick<TakeoutProvider, "getPreselectContext">,
  method: FileDecisionMethod | "clip",
  files: FileWithReviewContext[],
): Promise<AutoSelection> {
  if (files.length === 0) return { fileId: 0, keepFileIds: [], reason: "No files" };
  const context = await takeout.getPreselectContext(files.map((f) => f.file.id));
  const input: PreselectFile[] = files.map((f) => {
    const t = context.get(f.file.id);
    return {
      id: f.file.id,
      folderPriority: f.folderPriority,
      dateTaken: getDateTaken(f),
      folderKind: t?.folderKind ?? null,
      albumReferenced: t?.albumReferenced ?? false,
      hasSidecar: t?.hasSidecar ?? false,
      pixels: pixels(f),
      size: f.file.size,
      exifFields: exifFieldCount(f),
      motionPartnerId: t?.motionPartnerId ?? null,
      editedPartnerId: t?.editedPartnerId ?? null,
    };
  });
  const result = preselect(method, input);
  return { fileId: result.keepFileIds[0] ?? 0, keepFileIds: result.keepFileIds, reason: result.reason };
}
