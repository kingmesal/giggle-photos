import PQueue from "p-queue";
import { DatabaseProvider } from "../db/database-provider";
import { getLogger } from "../logging/logger";
import type { StageTimer } from "../util/timing";
import { computeSha256 } from "./hash-sha256";
import { ensureSharpProcess, requestSharpHashes, shutdownSharpProcess } from "./sharp-process";

const log = getLogger("core:hash-unified");

/**
 * Options for the unified hash batch processor.
 */
export interface HashBatchOptions {
  /** Number of parallel workers. Defaults to 1. */
  concurrency?: number;
  /** Maximum files to process. Defaults to all pending files. */
  limit?: number;
  /** Progress callback invoked after each file completes all algorithms. */
  onProgress?: (completed: number, total: number, currentFile: string) => void;
  /** Optional timer for collecting per-algorithm timing statistics */
  timer?: StageTimer;
}

/**
 * Per-algorithm statistics tracking computed, skipped, and errored counts.
 */
interface AlgorithmStats {
  computed: number;
  skipped: number;
  errors: number;
}

/**
 * Result of unified hash batch processing.
 */
export interface HashBatchResult {
  /** Number of files that completed all hash algorithms. */
  processed: number;
  /** Number of files with at least one algorithm error. */
  errors: number;
  /** Number of files entirely skipped (all algorithms already computed). */
  skipped: number;
  /** Per-algorithm breakdown of computed, skipped, and errored counts. */
  algorithmStats: {
    sha256: AlgorithmStats;
    contentHash: AlgorithmStats;
    perceptualHash: AlgorithmStats;
  };
  /** Error category -> count */
  errorBreakdown?: Record<string, number>;
}

/**
 * Unified per-file hash processor.
 *
 * For each file:
 *   1. SHA-256 — computed in the main process (pure crypto, no native deps)
 *   2. Content hash + pHash — computed in an isolated child process via IPC
 *      to avoid GLib ref-counting races between Sharp/libvips and Chromium
 *
 * The child process reads the file once for both Sharp operations (content
 * hash + pHash). The main process reads the file separately for SHA-256.
 * The OS page cache makes the second read effectively free.
 *
 * Design:
 * - p-queue with concurrency=1: one file at a time to avoid overwhelming
 *   the child process (Sharp/libvips is single-threaded).
 * - Check before compute: skip algorithms where the hash column is already
 *   populated (restart resilience).
 * - Status update only after all algorithms complete: file stays `metadata`
 *   until everything finishes.
 *
 * Error handling:
 * - SHA-256 failure is fatal for the file (marks as error, skips remaining).
 * - Content hash and perceptual hash failures are non-fatal.
 * - null return from Sharp worker (unsupported format) is a skip, not an error.
 *
 * @param options - Optional batch processing configuration
 * @returns Aggregate result with per-algorithm breakdown
 */
/**
 * Categorize an error message into a short bucket name.
 */
function categorizeError(msg: string): string {
  const lower = msg.toLowerCase();
  if (lower.includes("enoent") || lower.includes("no such file")) return "file_not_found";
  if (lower.includes("eacces") || lower.includes("permission denied")) return "permission_denied";
  if (lower.includes("unsupported") || lower.includes("invalid")) return "unsupported_format";
  if (lower.includes("timeout") || lower.includes("timed out")) return "timeout";
  if (lower.includes("worker") || lower.includes("child process")) return "worker_crash";
  return "unknown";
}

export async function processHashBatch(options?: HashBatchOptions): Promise<HashBatchResult> {
  const { concurrency = 1, limit, onProgress, timer } = options ?? {};

  const db = await DatabaseProvider.getInstance();
  const mediaFiles = db.getMediaFileProvider();

  // Get files with status='metadata' that need hashing
  const files = await mediaFiles.getFilesNeedingHashing(limit);
  const total = files.length;

  const result: HashBatchResult = {
    processed: 0,
    errors: 0,
    skipped: 0,
    algorithmStats: {
      sha256: { computed: 0, skipped: 0, errors: 0 },
      contentHash: { computed: 0, skipped: 0, errors: 0 },
      perceptualHash: { computed: 0, skipped: 0, errors: 0 },
    },
  };

  if (total === 0) {
    log.info("No files need hashing");
    return result;
  }

  log.info(`Processing hashes for ${total} files with concurrency ${concurrency}`);

  // Start the Sharp child process before processing begins
  const capabilities = await ensureSharpProcess();
  log.info(`Sharp worker capabilities: sharp=${capabilities.sharp}, phash=${capabilities.phash}`);

  let completed = 0;
  const errorBreakdown: Record<string, number> = {};

  const queue = new PQueue({ concurrency });

  for (const file of files) {
    queue.add(async () => {
      const fileStart = performance.now();

      // --- SHA-256 in main process (pure crypto, no GLib) ---
      if (!file.sha256Hash) {
        try {
          const stopSha = timer?.start("sha256");
          const hash = await computeSha256(file.path);
          stopSha?.();
          const t1 = performance.now();
          log.debug(`SHA-256 for ${file.path} in ${(t1 - fileStart).toFixed(1)}ms: ${hash.substring(0, 16)}...`);
          await mediaFiles.updateMediaFile({ id: file.id, sha256Hash: hash });
          result.algorithmStats.sha256.computed++;
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          log.error(`Failed to compute SHA-256 for ${file.path}: ${errorMessage}`);
          result.algorithmStats.sha256.errors++;
          const category = categorizeError(errorMessage);
          errorBreakdown[category] = (errorBreakdown[category] ?? 0) + 1;

          // SHA-256 failure is fatal: mark file as error and skip remaining algorithms
          try {
            await mediaFiles.updateMediaFile({
              id: file.id,
              status: "error",
              errorMessage: `SHA-256: ${errorMessage}`,
            });
          } catch (_updateError) {
            log.error(`Failed to update error status for file ${file.id}`);
          }

          result.errors++;
          completed++;
          onProgress?.(completed, total, file.path);
          return;
        }
      } else {
        result.algorithmStats.sha256.skipped++;
      }

      // --- Content hash + pHash via isolated child process ---
      const needsContentHash = file.fileType === "image" && !file.contentHash;
      const needsPerceptualHash = file.fileType === "image" && !file.perceptualHash;

      if (needsContentHash || needsPerceptualHash) {
        try {
          const t0 = performance.now();
          const sharpResult = await requestSharpHashes(file.path, needsContentHash, needsPerceptualHash);
          const totalSharpMs = (performance.now() - t0).toFixed(1);

          // Record child-process-reported timings
          if (needsContentHash && sharpResult.contentHash != null && sharpResult.contentHashMs != null) {
            timer?.record("contentHash", sharpResult.contentHashMs);
          }
          if (needsPerceptualHash && sharpResult.perceptualHash != null && sharpResult.perceptualHashMs != null) {
            timer?.record("perceptualHash", sharpResult.perceptualHashMs);
          }

          // Process content hash result
          if (needsContentHash) {
            if (sharpResult.contentHash != null) {
              log.debug(
                `Content hash for ${file.path} in ${sharpResult.contentHashMs?.toFixed(1) ?? "?"}ms: ${sharpResult.contentHash.substring(0, 16)}...`,
              );
              await mediaFiles.updateMediaFile({ id: file.id, contentHash: sharpResult.contentHash });
              result.algorithmStats.contentHash.computed++;
            } else {
              result.algorithmStats.contentHash.skipped++;
              log.debug(`Skipped content hash for ${file.path} (unsupported format)`);
            }
          }

          // Process perceptual hash result
          if (needsPerceptualHash) {
            if (sharpResult.perceptualHash != null) {
              log.debug(
                `pHash for ${file.path} in ${sharpResult.perceptualHashMs?.toFixed(1) ?? "?"}ms: ${sharpResult.perceptualHash.substring(0, 16)}...`,
              );
              await mediaFiles.updateMediaFile({ id: file.id, perceptualHash: sharpResult.perceptualHash });
              result.algorithmStats.perceptualHash.computed++;
            } else {
              result.algorithmStats.perceptualHash.skipped++;
              log.debug(`Skipped pHash for ${file.path} (unsupported format)`);
            }
          }

          log.debug(`Sharp worker for ${file.path}: read=${sharpResult.readMs?.toFixed(1)}ms, total=${totalSharpMs}ms`);
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          log.warn(`Sharp worker failed for ${file.path}: ${errorMessage}`);
          if (needsContentHash) result.algorithmStats.contentHash.errors++;
          if (needsPerceptualHash) result.algorithmStats.perceptualHash.errors++;
          const category = categorizeError(errorMessage);
          errorBreakdown[category] = (errorBreakdown[category] ?? 0) + 1;
        }
      } else {
        // Track skips for already-computed hashes
        if (file.fileType === "image" && file.contentHash) {
          result.algorithmStats.contentHash.skipped++;
        }
        if (file.fileType === "image" && file.perceptualHash) {
          result.algorithmStats.perceptualHash.skipped++;
        }
      }

      // --- All algorithms complete: update status to hashed ---
      const totalMs = (performance.now() - fileStart).toFixed(1);
      log.debug(`All hashes for ${file.path} complete in ${totalMs}ms`);
      await mediaFiles.updateMediaFile({ id: file.id, status: "hashed" });
      result.processed++;
      completed++;
      onProgress?.(completed, total, file.path);
    });
  }

  // Wait for all queued tasks to complete
  await queue.onIdle();

  // Shut down the worker process
  shutdownSharpProcess();

  log.info(
    `Hash batch complete: ${result.processed} processed, ${result.errors} errors, ${result.skipped} skipped ` +
      `(sha256: ${result.algorithmStats.sha256.computed}/${result.algorithmStats.sha256.skipped}/${result.algorithmStats.sha256.errors}, ` +
      `content: ${result.algorithmStats.contentHash.computed}/${result.algorithmStats.contentHash.skipped}/${result.algorithmStats.contentHash.errors}, ` +
      `phash: ${result.algorithmStats.perceptualHash.computed}/${result.algorithmStats.perceptualHash.skipped}/${result.algorithmStats.perceptualHash.errors})`,
  );

  if (Object.keys(errorBreakdown).length > 0) {
    result.errorBreakdown = errorBreakdown;
  }

  return result;
}
