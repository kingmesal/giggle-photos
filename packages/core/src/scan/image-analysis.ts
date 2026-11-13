/**
 * Single-pass image analysis (RFD-002 §A). ⚠️ FRAGILE: See _FRAGILE.md
 *
 * One read; one full decode; cheap reduced decodes for small derivatives:
 *
 *   bytes (read once) ─┬─ SHA-256(bytes)                              → sha256
 *                      ├─ exifr(bytes)                                → exif (orientation, date, GPS…)
 *                      ├─ header (no pixel decode)                    → memory-budget estimate
 *                      ├─ full decode → stored (un-oriented) pixels
 *                      │     └─ SHA-256(pixels)                       → contentHash (semantics unchanged)
 *                      └─ reduced decode (JPEG shrink-on-load), EXIF-oriented, grey 32×32
 *                            └─ DCT pHash                             → perceptualHash
 *
 * Why not derive the pHash from the full decode: measured on the benchmark sample, shrinking 12 MP
 * of raw pixels costs ~45 ms and much more memory, while libjpeg decoding straight at 1/8 scale
 * costs ~24 ms (CPU −20 %, peak RSS −33 % overall). See RFD-002 §A.
 *
 * Runs inside the worker process (sharp/libvips must stay out of the Chromium process), but takes
 * sharp as a parameter so tests can call it directly.
 */
import { extname } from "node:path";
import exifr from "exifr";
import type SharpType from "sharp";
import {
  type AnalysisResult,
  type AnalysisTimer,
  categorizeAnalysisError,
  type DecodedInfo,
  pickExif,
} from "./analysis-protocol";
import type { ByteBudget } from "./byte-budget";
import { MIN_EXIF_PARSE_BYTES } from "./exif-guard";
import { PHASH_INPUT_SIZE, perceptualHashFromGrey } from "./hash-phash";

type Sharp = typeof SharpType;

const sha256Hex = (data: Uint8Array): string => new Bun.CryptoHasher("sha256").update(data).digest("hex");

/**
 * Bytes a decode of this image will hold: compressed input + 2 × raw pixels (libvips' buffer and
 * the copy handed to JS), ×2 again for 16-bit samples.
 */
export function estimateDecodeBytes(
  fileBytes: number,
  width: number,
  height: number,
  channels: number,
  depth?: string,
): number {
  const bytesPerSample = depth === "ushort" || depth === "short" ? 2 : depth === "float" || depth === "uint" ? 4 : 1;
  return fileBytes + 2 * width * height * Math.max(channels, 3) * bytesPerSample;
}

/** Analyse an image that has already been read into memory. Never throws: failures are returned. */
export async function analyzeImageBytes(
  sharp: Sharp,
  bytes: Uint8Array,
  filePath: string,
  budget: ByteBudget | null,
): Promise<AnalysisResult> {
  const timings: Partial<Record<AnalysisTimer, number>> = {};
  const time = async <T>(name: AnalysisTimer, fn: () => Promise<T> | T): Promise<T> => {
    const t0 = performance.now();
    try {
      return await fn();
    } finally {
      timings[name] = performance.now() - t0;
    }
  };
  const extension = extname(filePath).slice(1).toLowerCase();
  const result: AnalysisResult = { timings };

  result.sha256 = await time("sha256", () => sha256Hex(bytes));
  if (bytes.length === 0) {
    result.failure = { category: "empty_file", message: "File is empty (0 bytes)" };
    return result;
  }

  result.exif = await time("exif", async () => {
    if (bytes.length < MIN_EXIF_PARSE_BYTES) return null;
    try {
      const raw = await exifr.parse(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength), {
        gps: true,
        exif: true,
        translateValues: false, // keep raw numbers (orientation 1–8, ColorSpace 1, …)
      });
      return pickExif(raw as Record<string, unknown> | undefined);
    } catch {
      return null; // no EXIF is normal (PNG, screenshots, stripped files)
    }
  });

  let release: (() => void) | null = null;
  try {
    const header = await sharp(bytes).metadata();
    const estimate = estimateDecodeBytes(
      bytes.length,
      header.width ?? 0,
      header.height ?? 0,
      header.channels ?? 3,
      header.depth,
    );
    release = budget ? await time("budgetWait", () => budget.acquire(estimate)) : null;

    const { data, info } = await time("decode", () => sharp(bytes).raw().toBuffer({ resolveWithObject: true }));
    result.contentHash = await time("contentHash", () => sha256Hex(data));
    result.perceptualHash = await time("perceptualHash", async () => {
      // Reduced decode from the same bytes: .rotate() applies the EXIF orientation, so a
      // physically rotated copy and an EXIF-rotated original hash alike.
      const grey = await sharp(bytes)
        .rotate()
        .removeAlpha()
        .greyscale()
        .resize(PHASH_INPUT_SIZE, PHASH_INPUT_SIZE, { fit: "fill" })
        .raw({ depth: "uchar" })
        .toBuffer();
      return perceptualHashFromGrey(grey);
    });
    const decoded: DecodedInfo = {
      width: info.width,
      height: info.height,
      format: header.format ?? extension,
      hasAlpha: header.hasAlpha ?? false,
    };
    result.decoded = decoded;
  } catch (error) {
    result.failure = categorizeAnalysisError(error instanceof Error ? error.message : String(error), extension);
  } finally {
    release?.();
  }
  return result;
}

/** Read the file once, then analyse it. Never throws: read failures are returned too. */
export async function analyzeImageFile(
  sharp: Sharp,
  filePath: string,
  budget: ByteBudget | null,
): Promise<AnalysisResult> {
  const t0 = performance.now();
  let bytes: Uint8Array;
  try {
    bytes = await Bun.file(filePath).bytes();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { timings: { read: performance.now() - t0 }, failure: categorizeAnalysisError(message, "") };
  }
  const readMs = performance.now() - t0;
  const result = await analyzeImageBytes(sharp, bytes, filePath, budget);
  result.timings.read = readMs;
  return result;
}
