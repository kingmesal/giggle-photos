/**
 * Generate the deterministic benchmark sample for RFD-002 (about 2,000 mixed files).
 *
 *   bun packages/core/src/bench/make-sample.ts [outDir] [--seed=1] [--scale=1]
 *
 * Default outDir: ~/.cache/giggle-photos/bench-sample. --scale=0.05 makes a quick smoke set.
 * HEIC is not generated (no encoder available); drop real .heic files into <outDir>/HEIC by hand.
 */
import { copyFile, mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, relative } from "node:path";
import sharp from "sharp";
import {
  encodeJpeg,
  type ImageSize,
  ORIENTATIONS,
  pickSize,
  renderScene,
  seededRandom,
  writeOut,
} from "./sample-images";
import { generateVideos } from "./sample-videos";

type Kind =
  | "base"
  | "exact-copy"
  | "reencode-q55"
  | "resize-50"
  | "crop-10"
  | "rotated-90"
  | "webp"
  | "avif"
  | "png-a"
  | "png-b"
  | "truncated"
  | "empty"
  | "video";

const PLAN = {
  base: 1350,
  exactCopy: 150,
  reencode: 100,
  resize: 80,
  crop: 60,
  rotated: 40,
  webp: 40,
  avif: 20,
  pngPairs: 40,
  truncated: 20,
  empty: 5,
};

function parseArgs(argv: string[]): { outDir: string; seed: number; scale: number } {
  const flag = (name: string) => argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
  const positional = argv.find((a) => !a.startsWith("--"));
  return {
    outDir: positional ?? join(homedir(), ".cache", "giggle-photos", "bench-sample"),
    seed: Number(flag("seed") ?? 1),
    scale: Number(flag("scale") ?? 1),
  };
}

async function pool<T>(items: T[], concurrency: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: concurrency }, async () => {
    while (next < items.length) {
      const item = items[next++] as T;
      await fn(item);
    }
  });
  await Promise.all(workers);
}

async function main(): Promise<void> {
  const { outDir, seed, scale } = parseArgs(process.argv.slice(2));
  const n = (count: number) => Math.max(1, Math.round(count * scale));
  const plan = Object.fromEntries(Object.entries(PLAN).map(([k, v]) => [k, n(v)])) as typeof PLAN;
  await rm(outDir, { recursive: true, force: true });
  const manifest: { path: string; kind: Kind }[] = [];
  const add = (path: string, kind: Kind) => manifest.push({ path: relative(outDir, path), kind });
  const name = (i: number) => `IMG_${String(i).padStart(5, "0")}`;
  const yearDir = (i: number) => join(outDir, `Photos from ${2015 + (i % 10)}`);

  // Variant ranges over base indices, in order: copy, reencode, resize, crop, rotate, webp, avif.
  const ranges: [Kind, number][] = [
    ["exact-copy", plan.exactCopy],
    ["reencode-q55", plan.reencode],
    ["resize-50", plan.resize],
    ["crop-10", plan.crop],
    ["rotated-90", plan.rotated],
    ["webp", plan.webp],
    ["avif", plan.avif],
  ];
  const variantFor = (i: number): Kind | null => {
    let start = 0;
    for (const [kind, count] of ranges) {
      if (i < start + count) return kind;
      start += count;
    }
    return null;
  };

  let done = 0;
  await pool(
    Array.from({ length: plan.base }, (_, i) => i),
    4,
    async (i) => {
      const rand = seededRandom(seed * 100_003 + i);
      const size = pickSize(rand);
      const orientation = ORIENTATIONS[Math.floor(rand() * ORIENTATIONS.length)] ?? 1;
      const scene = await renderScene(size, seed * 100_003 + i);
      const basePath = join(yearDir(i), `${name(i)}.jpg`);
      await writeOut(basePath, await encodeJpeg(scene, 88, orientation));
      add(basePath, "base");
      const variant = variantFor(i);
      if (variant) {
        const path = await writeVariant(variant, join(outDir, `Album - Set ${i % 7}`, name(i)), {
          basePath,
          scene,
          size,
          orientation,
        });
        add(path, variant);
      }
      done++;
      if (done % 50 === 0) process.stdout.write(`images ${done}/${plan.base}\n`);
    },
  );

  // PNG pairs: identical pixels, different compression -> different bytes, same content hash.
  for (let p = 0; p < plan.pngPairs; p++) {
    const scene = await renderScene({ width: 1600, height: 1200 }, seed * 7_919 + p);
    const a = join(outDir, "Screenshots", `SCR_${p}.png`);
    const b = join(outDir, "Album - Screenshots", `SCR_${p}.png`);
    await writeOut(a, await scene.clone().png({ compressionLevel: 9 }).toBuffer());
    await writeOut(b, await scene.clone().png({ compressionLevel: 1 }).toBuffer());
    add(a, "png-a");
    add(b, "png-b");
  }

  // Broken files: truncated JPEGs and zero-byte files exercise the error paths.
  for (let t = 0; t < plan.truncated; t++) {
    const source = join(yearDir(t), `${name(t)}.jpg`);
    const bytes = await readFile(source);
    const path = join(outDir, "Broken", `${name(t)}-truncated.jpg`);
    await writeOut(path, bytes.subarray(0, Math.floor(bytes.length * 0.4)));
    add(path, "truncated");
  }
  for (let e = 0; e < plan.empty; e++) {
    const path = join(outDir, "Broken", `EMPTY_${e}.jpg`);
    await writeOut(path, new Uint8Array());
    add(path, "empty");
  }

  const videos = await generateVideos(outDir, {
    originals: n(40),
    copies: n(10),
    reencodes: n(10),
  });
  for (const v of videos) add(v, "video");

  const files = await countFiles(outDir);
  const counts: Record<string, number> = {};
  for (const m of manifest) counts[m.kind] = (counts[m.kind] ?? 0) + 1;
  await writeOut(
    join(outDir, "..", "bench-sample.manifest.json"),
    Buffer.from(JSON.stringify({ seed, scale, files, bytes: await dirBytes(outDir), counts }, null, 2)),
  );
  process.stdout.write(`done: ${files} files in ${outDir}\n${JSON.stringify(counts)}\n`);
  await sharp.cache(false);
}

type VariantInput = { basePath: string; scene: sharp.Sharp; size: ImageSize; orientation: number };

/** Write one derived copy of a base image; `stem` is the path without extension. Returns the path. */
async function writeVariant(kind: Kind, stem: string, { basePath, scene, size, orientation }: VariantInput) {
  if (kind === "exact-copy") {
    await mkdir(dirname(stem), { recursive: true });
    await copyFile(basePath, `${stem}.jpg`);
    return `${stem}.jpg`;
  }
  let path: string;
  let data: Buffer;
  if (kind === "reencode-q55") {
    path = `${stem}-q55.jpg`;
    data = await encodeJpeg(scene, 55, orientation);
  } else if (kind === "resize-50") {
    path = `${stem}-small.jpg`;
    data = await encodeJpeg(scene.clone().resize(Math.round(size.width / 2)), 85, orientation);
  } else if (kind === "crop-10") {
    const dx = Math.round(size.width * 0.05);
    const dy = Math.round(size.height * 0.05);
    const box = { left: dx, top: dy, width: size.width - 2 * dx, height: size.height - 2 * dy };
    path = `${stem}-crop.jpg`;
    data = await encodeJpeg(scene.clone().extract(box), 88, orientation);
  } else if (kind === "rotated-90") {
    path = `${stem}-rot.jpg`;
    data = await encodeJpeg(scene.clone().rotate(90), 88);
  } else if (kind === "webp") {
    path = `${stem}.webp`;
    data = await scene.clone().webp({ quality: 85 }).toBuffer();
  } else if (kind === "avif") {
    path = `${stem}.avif`;
    data = await scene.clone().avif({ quality: 60, effort: 2 }).toBuffer();
  } else {
    throw new Error(`not a variant kind: ${kind}`);
  }
  await writeOut(path, data);
  return path;
}

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((e) => (e.isDirectory() ? walk(join(dir, e.name)) : Promise.resolve([join(dir, e.name)]))),
  );
  return nested.flat();
}

async function countFiles(dir: string): Promise<number> {
  return (await walk(dir)).length;
}

async function dirBytes(dir: string): Promise<number> {
  const sizes = await Promise.all((await walk(dir)).map(async (f) => (await stat(f)).size));
  return sizes.reduce((a, b) => a + b, 0);
}

await main();
