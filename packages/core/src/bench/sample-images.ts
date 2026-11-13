/**
 * Deterministic synthetic image generation for the pipeline benchmark sample.
 * Every image is derived from a seed, so the same seed always yields the same set.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import sharp from "sharp";

/** Mulberry32: tiny seeded PRNG (deterministic across platforms). */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type ImageSize = { width: number; height: number };

/** Resolution mix: mostly 12 MP phone photos, some smaller, a few 50 MP. */
export function pickSize(rand: () => number): ImageSize {
  const r = rand();
  if (r < 0.6) return { width: 4032, height: 3024 };
  if (r < 0.9) return { width: 2048, height: 1536 };
  if (r < 0.98) return { width: 1600, height: 1200 };
  return { width: 8160, height: 6120 };
}

function color(rand: () => number): string {
  const c = () => Math.floor(rand() * 256);
  return `rgb(${c()},${c()},${c()})`;
}

/** SVG scene of a gradient plus random shapes, so each seed has a distinct perceptual hash. */
function sceneSvg({ width, height }: ImageSize, rand: () => number): string {
  const shapes: string[] = [];
  const count = 6 + Math.floor(rand() * 8);
  for (let i = 0; i < count; i++) {
    const x = Math.floor(rand() * width);
    const y = Math.floor(rand() * height);
    const s = Math.floor((0.05 + rand() * 0.3) * Math.min(width, height));
    shapes.push(
      rand() < 0.5
        ? `<circle cx="${x}" cy="${y}" r="${s}" fill="${color(rand)}" opacity="0.85"/>`
        : `<rect x="${x}" y="${y}" width="${s * 1.5}" height="${s}" fill="${color(rand)}" opacity="0.85"/>`,
    );
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
<stop offset="0" stop-color="${color(rand)}"/><stop offset="1" stop-color="${color(rand)}"/>
</linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/>${shapes.join("")}</svg>`;
}

const NOISE_TILE = 512;

/**
 * Seeded grey noise tile (approx. gaussian, mean 128, sigma 10). sharp's own `create.noise`
 * is unseeded, so it would make the sample differ between runs.
 */
async function noiseTile(rand: () => number): Promise<Buffer> {
  const pixels = new Uint8Array(NOISE_TILE * NOISE_TILE * 3);
  for (let i = 0; i < pixels.length; i++) {
    // Sum of 4 uniforms ~ normal (Irwin-Hall); variance 4/12 -> scale to sigma 10.
    const n = (rand() + rand() + rand() + rand() - 2) / Math.sqrt(4 / 12);
    pixels[i] = Math.max(0, Math.min(255, Math.round(128 + n * 10)));
  }
  return sharp(pixels, { raw: { width: NOISE_TILE, height: NOISE_TILE, channels: 3 } })
    .png()
    .toBuffer();
}

/** Render a seeded scene as raw RGB pixels, with light sensor-like noise for realistic file sizes. */
export async function renderScene(size: ImageSize, seed: number): Promise<sharp.Sharp> {
  const rand = seededRandom(seed);
  const raw = await sharp(Buffer.from(sceneSvg(size, rand)))
    .composite([{ input: await noiseTile(rand), blend: "overlay", tile: true }])
    .removeAlpha()
    .raw()
    .toBuffer();
  return sharp(raw, { raw: { ...size, channels: 3 } });
}

export async function writeOut(path: string, data: Buffer | Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, data);
}

/** EXIF orientation values that occur on phones (1 = upright, 6 = rotate 90°, 3 = 180°, 8 = 270°). */
export const ORIENTATIONS = [1, 1, 1, 1, 6, 6, 3, 8] as const;

export async function encodeJpeg(img: sharp.Sharp, quality: number, orientation = 1): Promise<Buffer> {
  const out = img.clone().jpeg({ quality, mozjpeg: false });
  return orientation === 1 ? out.toBuffer() : out.withMetadata({ orientation }).toBuffer();
}
