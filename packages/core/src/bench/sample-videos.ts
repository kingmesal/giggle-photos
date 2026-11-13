/**
 * Deterministic synthetic videos for the pipeline benchmark sample (ffmpeg lavfi sources).
 */
import { copyFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { $ } from "bun";

export type VideoPlan = { originals: number; copies: number; reencodes: number };

export const DEFAULT_VIDEO_PLAN: VideoPlan = { originals: 40, copies: 10, reencodes: 10 };

/** 6 s 1080p H.264 clip; the seed changes the hue and pattern so clips differ. */
async function makeOriginal(path: string, seed: number): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const filter = `testsrc2=size=1920x1080:rate=30:duration=6,hue=h=${(seed * 37) % 360}:s=${1 + (seed % 3)}`;
  await $`ffmpeg -hide_banner -loglevel error -y -f lavfi -i ${filter} -c:v libx264 -preset veryfast -crf 23 -pix_fmt yuv420p ${path}`;
}

async function makeReencode(source: string, path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await $`ffmpeg -hide_banner -loglevel error -y -i ${source} -c:v libx265 -preset ultrafast -crf 28 -x265-params log-level=error -tag:v hvc1 ${path}`;
}

/** Generate the video part of the sample under `root`. Returns the paths written. */
export async function generateVideos(root: string, plan: VideoPlan = DEFAULT_VIDEO_PLAN): Promise<string[]> {
  const written: string[] = [];
  const originals: string[] = [];
  for (let i = 0; i < plan.originals; i++) {
    const path = join(root, "Videos", `VID_${String(i).padStart(4, "0")}.mp4`);
    await makeOriginal(path, i);
    originals.push(path);
    written.push(path);
  }
  for (let i = 0; i < plan.copies; i++) {
    const source = originals[i % originals.length] as string;
    const path = join(root, "Album - Clips", `VID_${String(i).padStart(4, "0")}.mp4`);
    await mkdir(dirname(path), { recursive: true });
    await copyFile(source, path);
    written.push(path);
  }
  for (let i = 0; i < plan.reencodes; i++) {
    const source = originals[(i * 3) % originals.length] as string;
    const path = join(root, "Videos (HEVC)", `VID_${String(i).padStart(4, "0")}_hevc.mov`);
    await makeReencode(source, path);
    written.push(path);
  }
  return written;
}
