/** Pure helpers for the duplicate review screen: formatting, dates, and local file URLs. */
import type { FileWithReviewContext } from "../../services/processing";

export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/** A Date from a file's metadata (dateTaken for images, creationTime for videos), or null. */
export function extractDateTaken(ctx: FileWithReviewContext): Date | null {
  if (!ctx.metadata) return null;
  if ("dateTaken" in ctx.metadata && ctx.metadata.dateTaken) {
    const d = ctx.metadata.dateTaken;
    return d instanceof Date ? d : new Date(d as string);
  }
  if ("creationTime" in ctx.metadata && ctx.metadata.creationTime) {
    const d = ctx.metadata.creationTime;
    return d instanceof Date ? d : new Date(d as string);
  }
  return null;
}

/** "+2h 30m" style difference; positive = newer than the reference. */
export function formatTimeDiff(diffMs: number): string {
  if (diffMs === 0) return "same time";
  const sign = diffMs > 0 ? "+" : "-";
  const seconds = Math.floor(Math.abs(diffMs) / 1000);
  if (seconds < 60) return `${sign}${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return seconds % 60 > 0 ? `${sign}${minutes}m ${seconds % 60}s` : `${sign}${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return minutes % 60 > 0 ? `${sign}${hours}h ${minutes % 60}m` : `${sign}${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 365) return hours % 24 > 0 ? `${sign}${days}d ${hours % 24}h` : `${sign}${days}d`;
  const years = Math.floor(days / 365);
  return days % 365 > 0 ? `${sign}${years}y ${days % 365}d` : `${sign}${years}y`;
}

/** Time difference between a file and a reference (keep) file, or null when either has no date. */
export function computeTimeDiff(file: FileWithReviewContext, keepFile: FileWithReviewContext): string | null {
  const fileDate = extractDateTaken(file);
  const keepDate = extractDateTaken(keepFile);
  if (!fileDate || !keepDate) return null;
  return formatTimeDiff(fileDate.getTime() - keepDate.getTime());
}

/** Local image URL: the local file server when available (port > 0), else file://. */
export function imageUrl(port: number, filePath: string): string {
  if (port > 0) return `http://127.0.0.1:${port}/file?path=${encodeURIComponent(filePath)}`;
  return `file://${filePath}`;
}

/** First-frame JPEG for a video (file server /thumbnail, ffmpeg); "" without a server. */
export function videoThumbnailUrl(port: number, filePath: string): string {
  if (port > 0) return `http://127.0.0.1:${port}/thumbnail?path=${encodeURIComponent(filePath)}`;
  return "";
}

/** Video frame at `time` seconds; "" without a server. */
export function videoFrameUrl(port: number, filePath: string, time: number): string {
  if (port > 0) {
    return `http://127.0.0.1:${port}/thumbnail?path=${encodeURIComponent(filePath)}&time=${time.toFixed(3)}`;
  }
  return "";
}

/** "51.50° N 0.12° W +35m", or null when latitude or longitude is missing. */
export function formatGpsCoords(
  latitude: number | null | undefined,
  longitude: number | null | undefined,
  altitude: number | null | undefined,
): string | null {
  if (latitude == null || longitude == null) return null;
  const latStr = `${Math.abs(latitude).toFixed(2)}° ${latitude >= 0 ? "N" : "S"}`;
  const lonStr = `${Math.abs(longitude).toFixed(2)}° ${longitude >= 0 ? "E" : "W"}`;
  let result = `${latStr} ${lonStr}`;
  if (altitude != null) result += ` ${altitude >= 0 ? "+" : ""}${Math.round(altitude)}m`;
  return result;
}

/** GPS display for a file's metadata, or null. */
export function fileGps(ctx: FileWithReviewContext): string | null {
  if (!ctx.metadata) return null;
  const meta = ctx.metadata as Record<string, unknown>;
  const num = (v: unknown): number | null => (typeof v === "number" ? v : null);
  return formatGpsCoords(num(meta.gpsLatitude), num(meta.gpsLongitude), num(meta.gpsAltitude));
}
