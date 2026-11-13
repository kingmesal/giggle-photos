/**
 * Real-model check for video frames (RFD-002 §E). Needs GIGGLE_TEST_CLIP_MODEL=/path/to/model.onnx
 * and ffmpeg; skipped otherwise. A re-encoded, downscaled copy must match; a different video must not.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as ort from "onnxruntime-node";
import sharp from "sharp";
import { CLIP_MODEL } from "./model-manifest";
import { clipInputFromBytes } from "./preprocess";
import { createClipSession, embedImage } from "./session";
import { embedVideoFrames } from "./video-frames";
import { videoDistance } from "./video-match";

const modelPath = process.env.GIGGLE_TEST_CLIP_MODEL;
const ffmpeg = Bun.which("ffmpeg");

describe.skipIf(!modelPath || !ffmpeg)("video frames with the real CLIP model", () => {
  let dir: string;
  const frames = new Map<string, Float32Array[]>();
  const run = async (args: string[]) => {
    const p = Bun.spawn([ffmpeg as string, "-v", "error", "-y", ...args], { stdout: "ignore", stderr: "pipe" });
    expect(await p.exited).toBe(0);
  };

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "video-clip-"));
    const original = join(dir, "original.mp4");
    await run(["-f", "lavfi", "-i", "testsrc2=duration=6:size=640x360:rate=24", "-pix_fmt", "yuv420p", original]);
    // Re-encoded copy: half size, low bitrate, different codec settings.
    await run(["-i", original, "-vf", "scale=320:-2", "-b:v", "150k", "-preset", "ultrafast", join(dir, "copy.mp4")]);
    await run([
      "-f",
      "lavfi",
      "-i",
      "mandelbrot=size=640x360:rate=24",
      "-t",
      "6",
      "-pix_fmt",
      "yuv420p",
      join(dir, "other.mp4"),
    ]);
    const session = await createClipSession(ort, modelPath as string, { provider: "cpu", threads: 4 });
    const embed = async (bytes: Uint8Array) =>
      Array.from(await embedImage(ort, session, CLIP_MODEL, await clipInputFromBytes(sharp, bytes, CLIP_MODEL)));
    for (const name of ["original", "copy", "other"]) {
      const r = await embedVideoFrames(join(dir, `${name}.mp4`), 6, embed, ffmpeg as string);
      expect(r.clipError).toBeUndefined();
      frames.set(
        name,
        (r.clipFrames ?? []).map((f) => Float32Array.from(f)),
      );
    }
  }, 120_000);
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  test("re-encoded copy is within the review band; a different video is far", () => {
    const copy = videoDistance(frames.get("original") ?? [], frames.get("copy") ?? []);
    const other = videoDistance(frames.get("original") ?? [], frames.get("other") ?? []);
    process.stderr.write(`video distances: copy=${copy.toFixed(4)} other=${other.toFixed(4)}\n`);
    expect(frames.get("original")).toHaveLength(5);
    expect(copy).toBeLessThan(0.06); // review cutoff; measured 0.018 with ffmpeg 6.1
    expect(other).toBeGreaterThan(0.12);
  });
});
