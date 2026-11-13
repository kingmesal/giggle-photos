/**
 * Video frames for CLIP (RFD-002 §E): 5 frames at 10/30/50/70/90% of the duration, decoded by
 * ffmpeg (which applies the rotation tag) to PNG, then embedded with the same preprocessing as
 * photos. Runs in the analysis worker, next to the CLIP session.
 */
export const FRAME_POSITIONS = [0.1, 0.3, 0.5, 0.7, 0.9] as const;

/** Seconds into the video for each frame position (3 decimals). */
export function frameTimestamps(durationSec: number): number[] {
  return FRAME_POSITIONS.map((p) => Math.round(durationSec * p * 1000) / 1000);
}

/** ffmpeg arguments that write one frame at `seconds` as PNG to stdout, scaled to 448 px wide. */
export function frameArgs(ffmpeg: string, filePath: string, seconds: number): string[] {
  return [
    ffmpeg,
    "-v",
    "error",
    "-nostdin",
    "-ss",
    String(seconds),
    "-i",
    filePath,
    "-frames:v",
    "1",
    "-vf",
    "scale=448:-2",
    "-f",
    "image2pipe",
    "-vcodec",
    "png",
    "-",
  ];
}

async function extractFrame(ffmpeg: string, filePath: string, seconds: number): Promise<Uint8Array> {
  const proc = Bun.spawn(frameArgs(ffmpeg, filePath, seconds), { stdout: "pipe", stderr: "pipe", stdin: "ignore" });
  const [bytes, stderr, code] = await Promise.all([
    new Response(proc.stdout).arrayBuffer().then((b) => new Uint8Array(b)),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0 || bytes.length === 0) {
    throw new Error(`ffmpeg could not read a frame at ${seconds}s: ${stderr.trim().slice(0, 200) || `exit ${code}`}`);
  }
  return bytes;
}

export interface VideoFramesResult {
  /** One L2-normalised embedding per frame position, in order. */
  clipFrames?: number[][];
  clipError?: string;
  timings: { videoFrames?: number };
}

/** Embed the 5 frames of a video. Any failed frame fails the video (no partial frame sets). */
export async function embedVideoFrames(
  filePath: string,
  durationSec: number,
  embedder: (bytes: Uint8Array) => Promise<number[]>,
  ffmpeg = "ffmpeg",
): Promise<VideoFramesResult> {
  const t0 = performance.now();
  if (!(durationSec > 0)) return { clipError: "Unknown video duration", timings: {} };
  try {
    const clipFrames: number[][] = [];
    for (const seconds of frameTimestamps(durationSec)) {
      clipFrames.push(await embedder(await extractFrame(ffmpeg, filePath, seconds)));
    }
    return { clipFrames, timings: { videoFrames: performance.now() - t0 } };
  } catch (error) {
    return {
      clipError: error instanceof Error ? error.message : String(error),
      timings: { videoFrames: performance.now() - t0 },
    };
  }
}
