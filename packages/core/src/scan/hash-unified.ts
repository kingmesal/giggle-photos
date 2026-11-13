/**
 * Analysis stage (RFD-002 single pass). ⚠️ FRAGILE: See _FRAGILE.md
 *
 * Images: one request to the image-analysis worker per file (one read, one decode) returns
 * sha256, EXIF, decoded info, contentHash and pHash; store-analysis.ts writes metadata, hashes and
 * status in one place. Videos: streaming SHA-256 here (never loaded whole into memory).
 * Every failure is counted by category in `errorBreakdown`; nothing is silently skipped.
 */
import PQueue from "p-queue";
import { DatabaseProvider } from "../db/database-provider";
import { getLogger } from "../logging/logger";
import type { StageTimer } from "../util/timing";
import type { MediaFile } from "../zod/media-file";
import { categorizeAnalysisError } from "./analysis-protocol";
import { HashError } from "./hash-error";
import { computeSha256 } from "./hash-sha256";
import { ensureSharpProcess, requestImageAnalysis, shutdownSharpProcess } from "./sharp-process";
import { countError, createHashStats, type HashStats, storeImageAnalysis } from "./store-analysis";

const log = getLogger("core:hash-unified");

export interface HashBatchOptions {
  /** Files analysed concurrently (the worker's memory budget further limits decodes). */
  concurrency?: number;
  limit?: number;
  onProgress?: (completed: number, total: number, currentFile: string) => void;
  timer?: StageTimer;
}

export interface HashBatchResult {
  processed: number;
  errors: number;
  skipped: number;
  algorithmStats: HashStats["algorithmStats"];
  errorBreakdown?: Record<string, number>;
}

type MediaFileProvider = ReturnType<Awaited<ReturnType<typeof DatabaseProvider.getInstance>>["getMediaFileProvider"]>;

/** Worker crash or timeout: the analysis never came back. */
function workerFailure(error: unknown): HashError {
  const message = error instanceof Error ? error.message : String(error);
  if (message.toLowerCase().includes("timeout")) return new HashError("timeout", message);
  return new HashError("worker_crash", message);
}

async function analyzeImage(file: MediaFile, mediaFiles: MediaFileProvider, stats: HashStats, timer?: StageTimer) {
  let response: Awaited<ReturnType<typeof requestImageAnalysis>>;
  try {
    response = await requestImageAnalysis(file.path);
  } catch (error) {
    const failure = workerFailure(error);
    stats.algorithmStats.sha256.errors++;
    countError(stats, failure);
    await mediaFiles.updateMediaFile({
      id: file.id,
      status: "error",
      errorMessage: `${failure.category}: ${failure.message}`,
    });
    log.warn(`Image analysis failed for ${file.path}: ${failure.message}`);
    return;
  }
  for (const [name, ms] of Object.entries(response.timings)) {
    if (ms !== undefined) timer?.record(name, ms);
  }
  const failure = await storeImageAnalysis(file, response, mediaFiles, stats);
  if (failure) log.warn(`Image analysis failed for ${file.path} (${failure.breakdownKey}): ${failure.message}`);
}

async function analyzeVideo(file: MediaFile, mediaFiles: MediaFileProvider, stats: HashStats, timer?: StageTimer) {
  if (file.sha256Hash) {
    stats.algorithmStats.sha256.skipped++;
  } else {
    try {
      const stop = timer?.start("videoSha256");
      const hash = await computeSha256(file.path);
      stop?.();
      await mediaFiles.updateMediaFile({ id: file.id, sha256Hash: hash });
      stats.algorithmStats.sha256.computed++;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const failure = categorizeAnalysisError(message, "");
      const hashError = new HashError(failure.category, message);
      stats.algorithmStats.sha256.errors++;
      countError(stats, hashError);
      await mediaFiles.updateMediaFile({ id: file.id, status: "error", errorMessage: `SHA-256: ${message}` });
      log.error(`Failed to compute SHA-256 for ${file.path}: ${message}`);
      return;
    }
  }
  await mediaFiles.updateMediaFile({ id: file.id, status: "hashed" });
  stats.processed++;
}

/**
 * Analyse every file that is ready: pending images (single pass) and videos whose metadata is done.
 *
 * @param options - Concurrency, limit, progress callback and optional StageTimer
 * @returns Counts per algorithm and an errorBreakdown keyed by failure category
 */
export async function processHashBatch(options?: HashBatchOptions): Promise<HashBatchResult> {
  const { concurrency = 1, limit, onProgress, timer } = options ?? {};
  const db = await DatabaseProvider.getInstance();
  const mediaFiles = db.getMediaFileProvider();
  const files = await mediaFiles.getFilesNeedingHashing(limit);
  const total = files.length;
  const stats = createHashStats();

  if (total === 0) {
    log.info("No files need analysis");
    return { ...stats, errorBreakdown: undefined };
  }

  if (files.some((f) => f.fileType === "image")) {
    const capabilities = await ensureSharpProcess();
    log.info(`Image-analysis worker: sharp=${capabilities.sharp}, phash=${capabilities.phash}`);
  }
  log.info(`Analysing ${total} files with concurrency ${concurrency}`);

  let completed = 0;
  const queue = new PQueue({ concurrency });
  for (const file of files) {
    queue.add(async () => {
      if (file.fileType === "image") await analyzeImage(file, mediaFiles, stats, timer);
      else await analyzeVideo(file, mediaFiles, stats, timer);
      completed++;
      onProgress?.(completed, total, file.path);
    });
  }
  await queue.onIdle();
  shutdownSharpProcess();

  const { sha256, contentHash, perceptualHash } = stats.algorithmStats;
  log.info(
    `Analysis complete: ${stats.processed} processed, ${stats.errors} errors ` +
      `(sha256 ${sha256.computed}/${sha256.skipped}/${sha256.errors}, content ${contentHash.computed}/${contentHash.errors}, ` +
      `phash ${perceptualHash.computed}/${perceptualHash.errors}) ${JSON.stringify(stats.errorBreakdown)}`,
  );

  return {
    processed: stats.processed,
    errors: stats.errors,
    skipped: stats.skipped,
    algorithmStats: stats.algorithmStats,
    errorBreakdown: Object.keys(stats.errorBreakdown).length > 0 ? stats.errorBreakdown : undefined,
  };
}
