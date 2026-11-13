/** Metadata rows for the comparison modal, and the stable left-panel file. */
import type { AutoSelection, FileWithReviewContext } from "../../services/processing";
import { computeTimeDiff, fileGps, formatBytes } from "./lib";
import type { CompareViewMode } from "./prefs";

export interface MetaRow {
  label: string;
  keepVal: string;
  compareVal: string;
}

/** Left panel: the compare reference, else the suggestion, else the first file. */
export function referenceFile(
  files: FileWithReviewContext[],
  compareThisId: number | null,
  suggestion: AutoSelection | null,
): FileWithReviewContext | null {
  if (compareThisId !== null) {
    const found = files.find((f) => f.file.id === compareThisId);
    if (found) return found;
  }
  if (suggestion && suggestion.fileId > 0) return files.find((f) => f.file.id === suggestion.fileId) ?? null;
  return files[0] ?? null;
}

export function folderOf(ctx: FileWithReviewContext): string {
  const lastSlash = ctx.file.path.lastIndexOf("/");
  return lastSlash >= 0 ? ctx.file.path.substring(0, lastSlash) : ctx.file.path;
}

function dimensions(ctx: FileWithReviewContext): string {
  const m = ctx.metadata;
  if (m && "width" in m && m.width && "height" in m && m.height) return `${m.width} × ${m.height}`;
  return "—";
}

function format(ctx: FileWithReviewContext): string {
  if (ctx.metadata && "format" in ctx.metadata && ctx.metadata.format) return String(ctx.metadata.format).toUpperCase();
  return ctx.file.extension.toUpperCase();
}

function dateTaken(ctx: FileWithReviewContext): string {
  if (ctx.metadata && "dateTaken" in ctx.metadata && ctx.metadata.dateTaken) {
    const d = ctx.metadata.dateTaken;
    return d instanceof Date ? d.toLocaleString() : String(d);
  }
  return "—";
}

function field(ctx: FileWithReviewContext, name: string): string {
  if (!ctx.metadata) return "—";
  const val = (ctx.metadata as Record<string, unknown>)[name];
  if (val === null || val === undefined) return "—";
  if (typeof val === "boolean") return val ? "Yes" : "No";
  return String(val);
}

const IMAGE_FIELDS: Array<[string, string]> = [
  ["Camera Make", "cameraMake"],
  ["Camera Model", "cameraModel"],
  ["Color Space", "colorSpace"],
  ["Has Alpha", "hasAlpha"],
  ["Orientation", "orientation"],
];
const VIDEO_FIELDS: Array<[string, string]> = [
  ["Duration", "duration"],
  ["Frame Rate", "frameRate"],
  ["Codec", "codec"],
  ["Audio Codec", "audioCodec"],
  ["Bitrate", "bitrate"],
];

export function buildMetaRows(keep: FileWithReviewContext, compare: FileWithReviewContext): MetaRow[] {
  const timeDiff = computeTimeDiff(compare, keep);
  const compareDate = dateTaken(compare);
  const row = (label: string, of: (c: FileWithReviewContext) => string): MetaRow => ({
    label,
    keepVal: of(keep),
    compareVal: of(compare),
  });
  const rows: MetaRow[] = [
    row("Filename", (c) => c.file.filename),
    row("Path", folderOf),
    row("Size", (c) => formatBytes(c.file.size)),
    row("Dimensions", dimensions),
    row("Format", format),
    {
      label: "Date Taken",
      keepVal: dateTaken(keep),
      compareVal: timeDiff && compareDate !== "—" ? `${compareDate} (${timeDiff})` : compareDate,
    },
  ];
  const either = (type: string) => keep.file.fileType === type || compare.file.fileType === type;
  if (either("image")) {
    rows.push(...IMAGE_FIELDS.map(([label, name]) => row(label, (c) => field(c, name))));
    rows.push(row("Location", (c) => fileGps(c) ?? "—"));
  }
  if (either("video")) rows.push(...VIDEO_FIELDS.map(([label, name]) => row(label, (c) => field(c, name))));
  rows.push(row("Folder Priority", (c) => String(c.folderPriority)));
  // pHash distance only when non-zero (identical = 0 is not useful to display)
  const dist = (c: FileWithReviewContext) =>
    c.phashDistance !== undefined && c.phashDistance > 0 ? String(c.phashDistance) : "—";
  if (dist(keep) !== "—" || dist(compare) !== "—") rows.push(row("pHash Distance", dist));
  return rows;
}

export function viewModeImageClass(mode: CompareViewMode): string {
  return {
    xl: "flex-[9] min-h-0",
    large: "flex-[3] min-h-0",
    balanced: "flex-[1] min-h-0",
    compact: "flex-[1] min-h-0",
  }[mode];
}

export function viewModeMetaClass(mode: CompareViewMode): string {
  return mode === "compact" ? "flex-[3] min-h-0" : "flex-[1] min-h-0";
}

function durationOf(ctx: FileWithReviewContext): number {
  if (ctx.metadata && "duration" in ctx.metadata && ctx.metadata.duration) {
    const d = Number(ctx.metadata.duration);
    return Number.isFinite(d) && d > 0 ? d : 0;
  }
  return 0;
}

/** Frame timestamps for video comparison: 0, every second, and the last frame (shorter video's length). */
export function frameSteps(keep: FileWithReviewContext, compare: FileWithReviewContext): number[] {
  const bothVideos = keep.file.fileType === "video" && compare.file.fileType === "video";
  const left = durationOf(keep);
  const right = durationOf(compare);
  const maxDur = bothVideos ? Math.min(left || right, right || left) : left || right;
  const steps = [0];
  if (maxDur > 0) {
    for (let t = 1; t < maxDur; t += 1) steps.push(Math.round(t * 1000) / 1000);
    if ((steps[steps.length - 1] ?? 0) < maxDur - 0.01) steps.push(Math.round(maxDur * 1000) / 1000);
  }
  return steps;
}
