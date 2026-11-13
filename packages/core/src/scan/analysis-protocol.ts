/**
 * Message types shared by the main process (sharp-process.ts) and the image-analysis worker
 * (sharp-worker.ts / image-analysis.ts). Plain data only: messages cross a process boundary.
 */
import type { HashErrorCategory } from "./hash-error";

/** EXIF tags the image metadata mapping reads (metadata-image.ts). Only these cross IPC. */
export const EXIF_FIELDS = [
  "Orientation",
  "ExifImageWidth",
  "ExifImageHeight",
  "ImageWidth",
  "ImageHeight",
  "ColorSpace",
  "Make",
  "Model",
  "DateTimeOriginal",
  "CreateDate",
  "ModifyDate",
  "DateTime",
  "latitude",
  "longitude",
  "GPSAltitude",
] as const;

export type ExifField = (typeof EXIF_FIELDS)[number];
/** Picked EXIF values; dates are ISO strings. */
export type ExifFields = Partial<Record<ExifField, string | number>>;

export interface DecodedInfo {
  /** Stored (un-oriented) pixel dimensions, as decoded. */
  width: number;
  height: number;
  /** Decoder's format name (e.g. "jpeg", "png", "webp", "heif"). */
  format: string;
  hasAlpha: boolean;
}

export interface AnalysisFailure {
  category: HashErrorCategory;
  message: string;
  /** Lower-case extension, set for unsupported formats. */
  format?: string;
}

export type AnalysisTimer =
  | "read"
  | "sha256"
  | "exif"
  | "budgetWait"
  | "decode"
  | "contentHash"
  | "perceptualHash"
  | "clipPreprocess"
  | "clipInference"
  | "videoFrames";

export interface AnalysisRequest {
  id: number;
  filePath: string;
  /**
   * "analyze" (default): full single pass. "embed": CLIP embedding only (backfill).
   * "embed_frames": CLIP embeddings of a video's 5 frames (RFD-002 §E); needs durationSec.
   */
  mode?: "analyze" | "embed" | "embed_frames";
  /** Video duration in seconds (embed_frames). */
  durationSec?: number;
}

export interface AnalysisResult {
  /** SHA-256 of the file bytes; present whenever the file could be read (even if decoding failed). */
  sha256?: string;
  exif?: ExifFields | null;
  decoded?: DecodedInfo;
  contentHash?: string;
  perceptualHash?: string;
  timings: Partial<Record<AnalysisTimer, number>>;
  /** Set when reading or decoding failed; whatever was computed before the failure is still set. */
  failure?: AnalysisFailure;
  /** L2-normalised CLIP embedding, when the worker has the model loaded. */
  clipEmbedding?: number[];
  /** Video frame embeddings (embed_frames), one per frame position, each L2-normalised. */
  clipFrames?: number[][];
  /** Why embedding failed for this file (the rest of the analysis still counts). */
  clipError?: string;
}

export interface AnalysisResponse extends AnalysisResult {
  id: number;
}

export interface WorkerReady {
  type: "ready";
  sharp: boolean;
  phash: boolean;
  decodeBudgetBytes: number;
  /** CLIP session state: null when no model was offered to the worker. */
  clip: { provider: string; fallbackReason?: string } | { error: string } | null;
}

/** Keep only the EXIF tags we use, as IPC-safe primitives (Dates become ISO strings). */
export function pickExif(raw: Record<string, unknown> | null | undefined): ExifFields | null {
  if (!raw) return null;
  const picked: ExifFields = {};
  for (const field of EXIF_FIELDS) {
    const value = raw[field];
    if (value instanceof Date) {
      if (!Number.isNaN(value.getTime())) picked[field] = value.toISOString();
    } else if (typeof value === "number" || typeof value === "string") {
      picked[field] = value;
    }
  }
  return Object.keys(picked).length > 0 ? picked : null;
}

/** Map a read/decode error message to a failure category (counted in errorBreakdown). */
export function categorizeAnalysisError(message: string, extension: string): AnalysisFailure {
  const lower = message.toLowerCase();
  const failure = (category: HashErrorCategory, format?: string): AnalysisFailure =>
    format ? { category, message, format } : { category, message };
  if (lower.includes("enoent") || lower.includes("no such file")) return failure("file_not_found");
  if (lower.includes("eacces") || lower.includes("eperm") || lower.includes("permission denied")) {
    return failure("permission_denied");
  }
  // "unsupported" first: libheif reports a missing HEVC codec as "corrupt header … Unsupported codec".
  if (lower.includes("unsupported")) return failure("unsupported_format", extension || "unknown");
  if (
    lower.includes("premature end") ||
    // sharp's default failOn="warning" rejects truncated images with this text. libvips keeps one
    // error buffer per process, so concurrent failures can add other files' messages to it.
    lower.includes("treated as error due to failon") ||
    lower.includes("truncated") ||
    lower.includes("corrupt") ||
    lower.includes("vipsjpeg") ||
    lower.includes("invalid") ||
    lower.includes("bad ") ||
    lower.includes("read error")
  ) {
    return failure("corrupt_or_truncated");
  }
  return failure("unknown");
}
