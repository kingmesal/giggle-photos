/**
 * CLIP part of the similarity stage (RFD-002 §C–E): backfill embeddings for analysed images that
 * have none (e.g. analysed before the model finished downloading) and frame embeddings for videos,
 * then all-pairs image matching plus video matching into clipMatches. CLIP pairs are review-only:
 * never preselected for deletion (§G).
 */
import PQueue from "p-queue";
import { getAppSettings } from "../config/user-config";
import { DatabaseProvider } from "../db/database-provider";
import { getLogger } from "../logging/logger";
import { ensureSharpProcess, requestImageEmbedding, shutdownSharpProcess } from "../scan/sharp-process";
import { StageTimer } from "../util/timing";
import { clipThresholds } from "./clip-settings";
import { findClipPairs } from "./match";
import { CLIP_MODEL } from "./model-manifest";
import { getClipModelStatus, workerClipOptions } from "./model-service";
import { embedVideoFrames, findFfmpeg, matchVideos, type VideoStageStats, videosToEmbed } from "./video-stage";

const log = getLogger("core:clip-stage");

export interface ClipStageResult extends VideoStageStats {
  /** Why CLIP did not run, or null when it ran. */
  skipped: null | "disabled" | "model_not_ready" | "model_load_failed";
  /** Model download state or load error, when skipped for the model. */
  detail?: string;
  provider?: string;
  embedded: number;
  embedErrors: number;
  /** Pairs stored (≤ storage cutoff), in the review band, and in the "strong" band. */
  pairsStored: number;
  pairsInReview: number;
  pairsStrong: number;
  thresholds: { strong: number; review: number; store: number };
  /** Per-file averages (ms) of the work done in this stage: backfilled photos and video frames. */
  timingMs?: Record<string, number>;
}

export interface ClipStageOptions {
  concurrency?: number;
  onProgress?: (operation: string, done: number, total: number) => void;
}

export async function runClipStage(options: ClipStageOptions = {}): Promise<ClipStageResult> {
  const settings = getAppSettings();
  const thresholds = clipThresholds(settings);
  const result: ClipStageResult = {
    skipped: null,
    embedded: 0,
    embedErrors: 0,
    pairsStored: 0,
    pairsInReview: 0,
    pairsStrong: 0,
    thresholds,
    videoSkipped: null,
    videosEmbedded: 0,
    videoEmbedErrors: 0,
    videoPairs: 0,
  };
  if (!settings.clipEnabled) return { ...result, skipped: "disabled" };
  const workerOptions = workerClipOptions();
  if (!workerOptions) return { ...result, skipped: "model_not_ready", detail: getClipModelStatus().state };

  const clip = (await DatabaseProvider.getInstance()).getClipProvider();
  const timer = new StageTimer();
  const missing = await clip.getImagesMissingEmbedding(CLIP_MODEL.id);
  const ffmpeg = findFfmpeg();
  if (!ffmpeg) result.videoSkipped = "no_ffmpeg";
  const videos = await videosToEmbed(clip, ffmpeg);
  if (missing.length > 0 || videos.length > 0) {
    const caps = await ensureSharpProcess(workerOptions);
    if (!caps.clip || "error" in caps.clip) {
      shutdownSharpProcess();
      return {
        ...result,
        skipped: "model_load_failed",
        detail: caps.clip && "error" in caps.clip ? caps.clip.error : "no session",
      };
    }
    result.provider = caps.clip.provider;
    log.info(`Embedding ${missing.length} images not embedded during analysis`);
    const queue = new PQueue({ concurrency: options.concurrency ?? 4 });
    let done = 0;
    for (const file of missing) {
      queue.add(async () => {
        try {
          const response = await requestImageEmbedding(file.path);
          for (const [name, ms] of Object.entries(response.timings)) if (ms !== undefined) timer.record(name, ms);
          if (response.clipEmbedding) {
            await clip.upsertEmbeddings([
              { mediaFileId: file.id, modelId: CLIP_MODEL.id, embedding: Float32Array.from(response.clipEmbedding) },
            ]);
            result.embedded++;
          } else {
            result.embedErrors++;
          }
        } catch (error) {
          result.embedErrors++;
          log.warn(`Embedding failed for ${file.path}: ${error instanceof Error ? error.message : String(error)}`);
        }
        options.onProgress?.("Embedding images (CLIP)", ++done, missing.length);
      });
    }
    await queue.onIdle();
    if (videos.length > 0) {
      log.info(`Embedding frames of ${videos.length} videos`);
      await embedVideoFrames(clip, videos, result, options.onProgress, timer);
    }
    shutdownSharpProcess();
  }

  const timings = timer.getAllStats();
  if (Object.keys(timings).length > 0) {
    result.timingMs = Object.fromEntries(Object.entries(timings).map(([name, s]) => [name, s.avgMs]));
  }

  const { ids, vectors } = await clip.loadEmbeddings(CLIP_MODEL.id, CLIP_MODEL.dimensions);
  const ort = await import("onnxruntime-node");
  const pairs = await findClipPairs(ort, ids, vectors, {
    dimensions: CLIP_MODEL.dimensions,
    maxDistance: thresholds.store,
    topK: settings.clipTopK,
    threads: settings.clipThreads,
    onProgress: (done, total) => options.onProgress?.("Comparing images (CLIP)", done, total),
  });
  const videoPairs = await matchVideos(clip, thresholds.store);
  result.videoPairs = videoPairs.length;
  pairs.push(...videoPairs);
  await clip.replaceMatches(CLIP_MODEL.id, pairs);
  result.pairsStored = pairs.length;
  result.pairsInReview = pairs.filter((p) => p.distance <= thresholds.review).length;
  result.pairsStrong = pairs.filter((p) => p.distance <= thresholds.strong).length;
  log.info(`CLIP: ${ids.length} embeddings, ${pairs.length} pairs stored, ${result.pairsInReview} in review`);
  return result;
}
