/**
 * Video part of the CLIP stage (RFD-002 §E): embed the frames of videos that have none, then find
 * video pairs from those frames. Needs ffmpeg on PATH; without it videos are skipped (reported).
 */
import PQueue from "p-queue";
import type { ClipProvider } from "../db/clip-provider";
import { getLogger } from "../logging/logger";
import { requestVideoFrameEmbeddings } from "../scan/sharp-process";
import { findTool } from "../util/find-tool";
import type { ClipPair } from "./match";
import { CLIP_MODEL } from "./model-manifest";
import { findVideoPairs } from "./video-match";

const log = getLogger("core:clip-video");

export interface VideoStageStats {
  /** Why videos were not embedded, or null. */
  videoSkipped: null | "no_ffmpeg";
  videosEmbedded: number;
  videoEmbedErrors: number;
  videoPairs: number;
}

/** ffmpeg path (PATH, then the usual install folders), or null when it is not installed. */
export function findFfmpeg(): string | null {
  return findTool("ffmpeg");
}

/** Videos still needing frame embeddings (empty when ffmpeg is missing). */
export async function videosToEmbed(clip: ClipProvider, ffmpeg: string | null) {
  return ffmpeg ? clip.getVideosMissingFrames(CLIP_MODEL.id) : [];
}

/** Embed the given videos' frames through the running worker. */
export async function embedVideoFrames(
  clip: ClipProvider,
  videos: { id: number; path: string; durationSec: number }[],
  stats: VideoStageStats,
  onProgress?: (operation: string, done: number, total: number) => void,
): Promise<void> {
  const queue = new PQueue({ concurrency: 2 }); // each video runs ffmpeg 5 times
  let done = 0;
  for (const video of videos) {
    queue.add(async () => {
      try {
        const response = await requestVideoFrameEmbeddings(video.path, video.durationSec);
        if (response.clipFrames && response.clipFrames.length > 0) {
          await clip.upsertEmbeddings(
            response.clipFrames.map((frame, frameIndex) => ({
              mediaFileId: video.id,
              frameIndex,
              modelId: CLIP_MODEL.id,
              embedding: Float32Array.from(frame),
            })),
          );
          stats.videosEmbedded++;
        } else {
          stats.videoEmbedErrors++;
          log.warn(`Video frames failed for ${video.path}: ${response.clipError ?? "no frames"}`);
        }
      } catch (error) {
        stats.videoEmbedErrors++;
        log.warn(`Video frames failed for ${video.path}: ${error instanceof Error ? error.message : String(error)}`);
      }
      onProgress?.("Embedding video frames (CLIP)", ++done, videos.length);
    });
  }
  await queue.onIdle();
}

/** Video pairs at or under the storage cutoff, from every video's stored frames. */
export async function matchVideos(clip: ClipProvider, maxDistance: number): Promise<ClipPair[]> {
  return findVideoPairs(await clip.loadVideoFrames(CLIP_MODEL.id, CLIP_MODEL.dimensions), maxDistance);
}
