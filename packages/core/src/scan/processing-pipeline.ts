import { DatabaseProvider } from "../db/database-provider";
import { getLogger } from "../logging/logger";
import { StageTimer } from "../util/timing";

const log = getLogger("core:pipeline");

import type { TakeoutSummary } from "../db/takeout-provider";
import { indexTakeout } from "../takeout/takeout-index";
import { detectDuplicates } from "./duplicate-detector";
import { scanFolder } from "./file-scanner";
import { processHashBatch } from "./hash-unified";
import { processVideoMetadataBatch } from "./metadata-video";

/**
 * Pipeline processing stages
 */
export type PipelineStage = "idle" | "scanning" | "metadata" | "hashing" | "detecting" | "complete" | "error";

/**
 * Per-stage completion statistics with optional detailed breakdowns.
 */
export interface StageStatsEntry {
  processed: number;
  errors: number;
  skipped: number;
  /** Image file count (metadata/hashing stages) */
  images?: number;
  /** Video file count (metadata/hashing stages) */
  videos?: number;
  /** Error category -> count */
  errorBreakdown?: Record<string, number>;
  /** Timer name -> avg ms */
  timingMs?: Record<string, number>;
  /** Google Takeout index (scanning stage only, RFD-003) */
  takeout?: { roots: number; warnings: string[]; summary: TakeoutSummary | null };
  /** Per-algorithm breakdown (hashing stage only) */
  algorithmStats?: {
    sha256: { computed: number; skipped: number; errors: number };
    contentHash: { computed: number; skipped: number; errors: number };
    perceptualHash: { computed: number; skipped: number; errors: number };
  };
}

/**
 * Progress information for the pipeline
 */
export interface PipelineProgress {
  /** Current processing stage */
  stage: PipelineStage;
  /** Progress within the current stage (0-100 percentage) */
  stageProgress: number;
  /** Description of the current operation */
  currentOperation: string;
  /** Number of files processed so far */
  filesProcessed: number;
  /** Total number of files to process */
  totalFiles: number;
  /** Number of duplicates found */
  duplicatesFound: number;
  /** Number of errors encountered */
  errors: number;
  /** Per-stage completion stats (populated after each stage completes) */
  stageStats?: Record<string, StageStatsEntry>;
  /** Running average timing per timer bucket (updated during processing) */
  liveTimingMs?: Record<string, number>;
  /** Image count processed so far in current stage */
  liveImages?: number;
  /** Video count processed so far in current stage */
  liveVideos?: number;
  /** Estimated time remaining for current stage in ms */
  etaMs?: number;
}

/**
 * Options for running the processing pipeline
 */
export interface PipelineOptions {
  /** Hamming distance threshold for perceptual hash matching. Default 5. */
  phashThreshold?: number;
  /** Number of concurrent hash operations. Default 4. */
  hashConcurrency?: number;
  /** Progress callback invoked when pipeline state changes */
  onProgress?: (progress: PipelineProgress) => void;
  /** AbortSignal for cancellation support */
  signal?: AbortSignal;
  /** Whether to pause after each stage completes */
  pauseAfterSegment?: boolean;
  /** Callback to check if pipeline should wait (for pause/resume support) */
  shouldWait?: () => boolean;
  /** Called when pipeline is waiting for resume */
  onWaiting?: () => void;
}

/**
 * Result of a completed pipeline run
 */
export interface PipelineResult {
  /** Total number of files processed */
  totalFiles: number;
  /** Number of pHash match pairs computed */
  phashPairsComputed: number;
  /** Total pairwise comparisons performed */
  totalComparisons: number;
  /** Number of errors encountered */
  errors: number;
  /** Duration of the pipeline run in milliseconds */
  duration: number;
}

/**
 * State information for pipeline resumability
 */
export interface PipelineState {
  /** Whether there are any scan folders configured */
  hasFolders: boolean;
  /** Whether there are folders that haven't been scanned yet */
  hasUnscannedFolders: boolean;
  /** Whether there are files needing metadata extraction (status "pending") */
  hasFilesNeedingMetadata: boolean;
  /** Whether there are files without all hashes computed */
  hasUnhashedFiles: boolean;
  /** Whether duplicate detection needs to run */
  hasUndetectedDuplicates: boolean;
  /** Total number of media files in the database */
  totalFiles: number;
  /** File counts by processing status */
  statusCounts: {
    pending: number;
    metadata: number;
    hashed: number;
    processed: number;
    error: number;
  };
}

/**
 * Run the full processing pipeline.
 *
 * The pipeline runs through these stages:
 * 1. **File Enumeration** - Scan all folders, create MediaFile records
 * 2. **Metadata Extraction** - Extract image and video metadata (in parallel)
 * 3. **Hash Computation** - Compute SHA-256, content hash, pHash (in parallel)
 * 4. **Duplicate Detection** - Find duplicate groups
 *
 * @param options - Pipeline configuration options
 * @returns Result containing statistics about the pipeline run
 *
 * @example
 * const result = await runPipeline({
 *   phashThreshold: 5,
 *   hashConcurrency: 4,
 *   onProgress: (progress) => {
 *     console.log(`${progress.stage}: ${progress.stageProgress}% - ${progress.currentOperation}`);
 *   },
 * });
 */
export async function runPipeline(options?: PipelineOptions): Promise<PipelineResult> {
  const startTime = Date.now();
  const db = await DatabaseProvider.getInstance();
  const scanFolders = db.getScanFolderProvider();
  const mediaFiles = db.getMediaFileProvider();

  let progress: PipelineProgress = {
    stage: "scanning",
    stageProgress: 0,
    currentOperation: "Starting...",
    filesProcessed: 0,
    totalFiles: 0,
    duplicatesFound: 0,
    errors: 0,
  };

  // Per-stage completion stats
  const stageStats: Record<string, StageStatsEntry> = {};

  const updateProgress = (updates: Partial<PipelineProgress>) => {
    progress = { ...progress, ...updates, stageStats };
    options?.onProgress?.(progress);
  };

  // Check for cancellation
  const checkCancelled = () => {
    if (options?.signal?.aborted) {
      throw new Error("Pipeline cancelled");
    }
  };

  // Wait for resume if paused (polls every 100ms)
  const waitForResume = async () => {
    if (!options?.shouldWait) return;

    while (options.shouldWait()) {
      checkCancelled();
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  };

  // Check if we should pause after completing a stage.
  // Only pauses if the stage actually processed something — skips pause for no-op stages
  // (e.g., scanning when all folders are already scanned, or hashing when all files already hashed).
  const checkPauseAfterStage = async (completedStage: PipelineStage) => {
    if (options?.pauseAfterSegment && completedStage !== "complete") {
      const stats = stageStats[completedStage];
      const didWork = stats && (stats.processed > 0 || stats.errors > 0);
      if (didWork) {
        log.debug(`Pause after segment enabled, waiting after ${completedStage}`);
        options.onWaiting?.();
        await waitForResume();
      } else {
        log.debug(`Skipping pause after ${completedStage} — no work was done`);
      }
    }
  };

  try {
    const dbClient = db.getClient().getDb();

    // Recovery: reset files incorrectly marked as "error" that have valid hashes.
    // Only recover files without an explicit error message (those were likely
    // erroneously marked by old pHash/content hash processors for unsupported formats).
    const recoveredCount = await dbClient
      .updateTable("mediaFiles")
      .set({ status: "hashed", updatedAt: Date.now() })
      .where("status", "=", "error")
      .where("sha256Hash", "is not", null)
      .where("errorMessage", "is", null)
      .execute();
    if (recoveredCount.length > 0) {
      log.info(`Recovered ${recoveredCount.length} files from erroneous error status`);
    }

    // Query existing file counts for combined progress display
    const existingFileCount = await mediaFiles.getTotalCount();
    const existingStatusCounts = await mediaFiles.getCountByStatus();

    // Stage 1: File Enumeration
    log.info("Pipeline Stage 1: File Enumeration");
    updateProgress({
      stage: "scanning",
      currentOperation: "Scanning folders...",
      filesProcessed: existingFileCount,
      totalFiles: existingFileCount,
    });

    const folders = await scanFolders.getAllScanFolders();

    // Determine which folders actually need scanning:
    // 1. Folders with status "added" or "error" (standard case)
    // 2. Folders marked "ready" that have expected files but zero files in the DB
    //    (this happens after quick-scan which only counts files without inserting them)
    const foldersToScan: typeof folders = [];
    for (const folder of folders) {
      if (folder.status === "added" || folder.status === "error") {
        foldersToScan.push(folder);
      } else if (folder.status === "ready" && (folder.imageCount > 0 || folder.videoCount > 0)) {
        const filesFromFolder = await dbClient
          .selectFrom("mediaFiles")
          .select((eb) => eb.fn.count("id").as("count"))
          .where("scanFolderId", "=", folder.id)
          .executeTakeFirst();
        const fileCount = filesFromFolder ? Number(filesFromFolder.count) : 0;
        if (fileCount === 0) {
          foldersToScan.push(folder);
        }
      }
    }

    let discoveredFiles = 0;
    let folderIndex = 0;

    for (const folder of foldersToScan) {
      checkCancelled();

      const result = await scanFolder(folder.id, (current, total, path) => {
        updateProgress({
          stageProgress:
            foldersToScan.length > 0
              ? Math.round(((folderIndex + (total > 0 ? current / total : 1)) / foldersToScan.length) * 100)
              : 100,
          currentOperation: `Scanning: ${path}`,
          filesProcessed: existingFileCount + discoveredFiles + current,
          totalFiles: existingFileCount + discoveredFiles + total,
        });
      });
      discoveredFiles += result.totalFiles;
      folderIndex++;
    }

    // Google Takeout awareness (RFD-003): folders, JSON sidecars, pairs. Non-fatal: a failure is
    // reported as a warning so the scan's results still stand.
    let takeoutStats: StageStatsEntry["takeout"];
    for (const folder of foldersToScan) {
      checkCancelled();
      updateProgress({ currentOperation: `Reading Google Takeout structure: ${folder.path}` });
      try {
        const indexed = await indexTakeout(folder.id);
        takeoutStats = {
          roots: (takeoutStats?.roots ?? 0) + indexed.roots.length,
          warnings: [...(takeoutStats?.warnings ?? []), ...indexed.warnings],
          summary: indexed.summary ?? takeoutStats?.summary ?? null,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log.error(`Takeout indexing failed for ${folder.path}: ${message}`);
        takeoutStats = {
          roots: takeoutStats?.roots ?? 0,
          warnings: [
            ...(takeoutStats?.warnings ?? []),
            `Could not read Takeout structure of ${folder.path}: ${message}`,
          ],
          summary: takeoutStats?.summary ?? null,
        };
      }
    }

    // Get total file count (includes previously scanned files)
    const totalFiles = await mediaFiles.getTotalCount();

    // Query image/video counts for scanning stats
    const imageCountRow = await dbClient
      .selectFrom("mediaFiles")
      .select((eb) => eb.fn.count("id").as("count"))
      .where("fileType", "=", "image")
      .executeTakeFirst();
    const videoCountRow = await dbClient
      .selectFrom("mediaFiles")
      .select((eb) => eb.fn.count("id").as("count"))
      .where("fileType", "=", "video")
      .executeTakeFirst();
    const scanImages = imageCountRow ? Number(imageCountRow.count) : 0;
    const scanVideos = videoCountRow ? Number(videoCountRow.count) : 0;

    stageStats.scanning = {
      processed: discoveredFiles,
      errors: 0,
      skipped: 0,
      images: scanImages,
      videos: scanVideos,
      takeout: takeoutStats,
    };
    updateProgress({
      totalFiles,
      filesProcessed: totalFiles,
      stageProgress: 100,
      currentOperation: "Scanning complete",
    });

    // Pause after scanning if enabled
    await checkPauseAfterStage("scanning");

    if (totalFiles === 0) {
      log.info("No files to process");
      updateProgress({ stage: "complete", currentOperation: "No files to process" });
      return {
        totalFiles: 0,
        phashPairsComputed: 0,
        totalComparisons: 0,
        errors: 0,
        duration: Date.now() - startTime,
      };
    }

    // Stage 2: Metadata Extraction (parallel)
    log.info("Pipeline Stage 2: Metadata Extraction");
    // Files that already have metadata or beyond (don't need metadata extraction)
    const alreadyHaveMetadata =
      (existingStatusCounts.metadata ?? 0) + (existingStatusCounts.hashed ?? 0) + (existingStatusCounts.processed ?? 0);
    updateProgress({
      stage: "metadata",
      stageProgress: 0,
      filesProcessed: alreadyHaveMetadata,
      totalFiles: alreadyHaveMetadata,
      currentOperation: "Extracting metadata...",
      liveTimingMs: undefined,
      liveImages: undefined,
      liveVideos: undefined,
      etaMs: undefined,
    });
    checkCancelled();

    const metadataTimer = new StageTimer();
    let videoTotal = 0;
    let videoCompleted = 0;

    const updateMetadataProgress = () => {
      const progressPct = videoTotal > 0 ? Math.round((videoCompleted / videoTotal) * 100) : 100;
      const avgVid = metadataTimer.getAverage("videoMetadata") ?? 0;
      const remaining = videoTotal - videoCompleted;

      updateProgress({
        stageProgress: progressPct,
        filesProcessed: alreadyHaveMetadata + videoCompleted,
        totalFiles: alreadyHaveMetadata + videoTotal,
        liveTimingMs: { videoMetadata: avgVid },
        liveImages: 0,
        liveVideos: videoCompleted,
        etaMs: remaining > 0 ? remaining * avgVid : undefined,
      });
    };

    // Images get their metadata in the analysis stage (single pass, RFD-002); videos still here.
    const videoResult = await processVideoMetadataBatch({
      timer: metadataTimer,
      onProgress: (completed, total) => {
        videoCompleted = completed;
        videoTotal = total;
        updateMetadataProgress();
      },
    });

    // Merge error breakdowns
    const metadataErrorBreakdown: Record<string, number> = {};
    for (const bd of [videoResult.errorBreakdown]) {
      if (bd) {
        for (const [k, v] of Object.entries(bd)) {
          metadataErrorBreakdown[k] = (metadataErrorBreakdown[k] ?? 0) + v;
        }
      }
    }

    // Bake timing averages
    const metadataTimingMs: Record<string, number> = {};
    const metadataAllStats = metadataTimer.getAllStats();
    for (const [name, stats] of Object.entries(metadataAllStats)) {
      metadataTimingMs[name] = stats.avgMs;
    }

    progress.errors += videoResult.errors;
    stageStats.metadata = {
      processed: videoResult.processed,
      errors: videoResult.errors,
      skipped: videoResult.skipped,
      images: 0,
      videos: videoCompleted,
      errorBreakdown: Object.keys(metadataErrorBreakdown).length > 0 ? metadataErrorBreakdown : undefined,
      timingMs: Object.keys(metadataTimingMs).length > 0 ? metadataTimingMs : undefined,
    };
    updateProgress({
      stageProgress: 100,
      currentOperation: "Metadata extraction complete",
      liveTimingMs: undefined,
      liveImages: undefined,
      liveVideos: undefined,
      etaMs: undefined,
    });
    checkCancelled();

    // Pause after metadata if enabled
    await checkPauseAfterStage("metadata");

    // Stage 3: Hash Computation (unified per-file processing)
    log.info("Pipeline Stage 3: Hash Computation");
    // Files that already have hashes (don't need hashing)
    const alreadyHashed = (existingStatusCounts.hashed ?? 0) + (existingStatusCounts.processed ?? 0);
    const hashTimer = new StageTimer();
    updateProgress({
      stage: "hashing",
      stageProgress: 0,
      filesProcessed: alreadyHashed,
      totalFiles: alreadyHashed,
      currentOperation: "Computing hashes...",
      liveTimingMs: undefined,
      liveImages: undefined,
      liveVideos: undefined,
      etaMs: undefined,
    });

    const hashResult = await processHashBatch({
      concurrency: options?.hashConcurrency ?? 4,
      timer: hashTimer,
      onProgress: (completed, total) => {
        const stageProgress = total > 0 ? Math.round((completed / total) * 100) : 100;

        // ETA from the sum of per-step averages of the single pass (read → hashes)
        const avg = (name: string) => hashTimer.getAverage(name) ?? 0;
        const avgSha = avg("sha256");
        const avgContent = avg("contentHash");
        const avgPhash = avg("perceptualHash");
        const avgDecode = avg("decode");
        const avgExif = avg("exif");
        const totalAvg = avg("read") + avgSha + avgExif + avgDecode + avgContent + avgPhash;
        const remaining = total - completed;

        updateProgress({
          stageProgress,
          filesProcessed: alreadyHashed + completed,
          totalFiles: alreadyHashed + total,
          liveTimingMs: {
            sha256: avgSha,
            exif: avgExif,
            decode: avgDecode,
            contentHash: avgContent,
            perceptualHash: avgPhash,
          },
          etaMs: remaining > 0 ? remaining * totalAvg : undefined,
        });
      },
    });

    // Bake timing averages
    const hashTimingMs: Record<string, number> = {};
    const hashAllStats = hashTimer.getAllStats();
    for (const [name, stats] of Object.entries(hashAllStats)) {
      hashTimingMs[name] = stats.avgMs;
    }

    progress.errors += hashResult.errors;
    stageStats.hashing = {
      processed: hashResult.processed,
      errors: hashResult.errors,
      skipped: hashResult.skipped,
      images: scanImages,
      videos: scanVideos,
      algorithmStats: hashResult.algorithmStats,
      errorBreakdown: hashResult.errorBreakdown,
      timingMs: Object.keys(hashTimingMs).length > 0 ? hashTimingMs : undefined,
    };
    updateProgress({
      stageProgress: 100,
      currentOperation: "Hash computation complete",
      liveTimingMs: undefined,
      liveImages: undefined,
      liveVideos: undefined,
      etaMs: undefined,
    });
    checkCancelled();

    // Pause after hashing if enabled
    await checkPauseAfterStage("hashing");

    // Stage 4: pHash Distance Computation
    log.info("Pipeline Stage 4: pHash Distance Computation");
    updateProgress({
      stage: "detecting",
      stageProgress: 0,
      filesProcessed: 0,
      totalFiles: 0,
      currentOperation: "Computing pHash distances...",
    });

    const detectionResult = await detectDuplicates({
      phashThreshold: options?.phashThreshold ?? 5,
      onProgress: (stage, current, total) => {
        const stageProgress = total > 0 ? Math.round((current / total) * 100) : 0;
        updateProgress({
          stageProgress,
          currentOperation: `Computing ${stage} distances...`,
        });
      },
    });

    stageStats.detecting = {
      processed: detectionResult.phashPairsComputed,
      errors: 0,
      skipped: 0,
    };

    // After detection completes, mark all hashed files as processed
    await dbClient
      .updateTable("mediaFiles")
      .set({ status: "processed", updatedAt: Date.now() })
      .where("status", "=", "hashed")
      .execute();

    updateProgress({
      stage: "complete",
      stageProgress: 100,
      duplicatesFound: detectionResult.phashPairsComputed,
      currentOperation: "Pipeline complete",
    });

    const duration = Date.now() - startTime;
    log.info(`Pipeline complete in ${duration}ms`);

    return {
      totalFiles,
      phashPairsComputed: detectionResult.phashPairsComputed,
      totalComparisons: detectionResult.totalComparisons,
      errors: progress.errors,
      duration,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error(`Pipeline error: ${errorMessage}`);
    updateProgress({ stage: "error", currentOperation: errorMessage });
    throw error;
  }
}

/**
 * Get the current state of the pipeline for resumability.
 *
 * This function checks the database to determine what work remains:
 * - Folders that haven't been scanned
 * - Files without hashes
 * - Whether duplicate detection should run
 *
 * @returns State object indicating what processing is needed
 *
 * @example
 * const state = await getPipelineState();
 * if (state.hasUnscannedFolders || state.hasUnhashedFiles) {
 *   await runPipeline();
 * }
 */
export async function getPipelineState(): Promise<PipelineState> {
  const db = await DatabaseProvider.getInstance();
  const scanFolders = db.getScanFolderProvider();
  const mediaFiles = db.getMediaFileProvider();
  const dbClient = db.getClient().getDb();

  // Get all folders
  const folders = await scanFolders.getAllScanFolders();

  // Check for unscanned folders:
  // 1. Folders with status 'added' or 'error' need scanning
  // 2. Folders marked 'ready' but with file counts and no files in DB need full scanning
  //    (this happens after quick scan which only counts files without adding them to DB)
  const foldersNeedingStatus = folders.filter((f) => f.status === "added" || f.status === "error");

  // For folders marked 'ready', check if they have expected files but no files in DB
  let foldersNeedingFullScan = 0;
  for (const folder of folders) {
    if (folder.status === "ready" && (folder.imageCount > 0 || folder.videoCount > 0)) {
      // Check if we have files from this folder in the database
      const filesFromFolder = await dbClient
        .selectFrom("mediaFiles")
        .select((eb) => eb.fn.count("id").as("count"))
        .where("scanFolderId", "=", folder.id)
        .executeTakeFirst();
      const fileCount = filesFromFolder ? Number(filesFromFolder.count) : 0;
      if (fileCount === 0) {
        foldersNeedingFullScan++;
      }
    }
  }

  const hasUnscannedFolders = foldersNeedingStatus.length > 0 || foldersNeedingFullScan > 0;

  // Check for files needing metadata extraction (status = 'pending')
  const statusCounts = await mediaFiles.getCountByStatus();
  const hasFilesNeedingMetadata = (statusCounts.pending ?? 0) > 0;

  // Check for files needing hashing (status = 'metadata')
  const filesNeedingHashing = await mediaFiles.getFilesNeedingHashing(1);
  const hasUnhashedFiles = filesNeedingHashing.length > 0;

  // Check for pending duplicate detection
  // We consider duplicates undetected if there are hashed files not yet processed
  const hasUnprocessedFiles = statusCounts.hashed > 0;

  const hasUndetectedDuplicates = hasUnprocessedFiles || hasUnhashedFiles;

  const totalFiles = await mediaFiles.getTotalCount();

  return {
    hasFolders: folders.length > 0,
    hasUnscannedFolders,
    hasFilesNeedingMetadata,
    hasUnhashedFiles,
    hasUndetectedDuplicates,
    totalFiles,
    statusCounts,
  };
}
