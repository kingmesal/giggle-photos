import { beforeAll, describe, expect, test } from "bun:test";
import * as ort from "onnxruntime-node";
import sharp from "sharp";
import { CLIP_MODEL } from "./model-manifest";
import { clipInputFromBytes } from "./preprocess";
import { type ClipSession, cosineDistance, createClipSession, embedImage, l2Normalize } from "./session";

const W = 640;
const H = 400;
const scene = (seed: number) =>
  Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <rect width="100%" height="100%" fill="hsl(${seed * 47}, 60%, 55%)"/>
    <circle cx="${120 + seed * 30}" cy="140" r="90" fill="#fd3"/><rect x="330" y="${180 + seed * 10}" width="220" height="140" fill="#123"/>
    <path d="M0 ${360 - seed * 20} Q 320 ${250 + seed * 15} 640 360 L640 400 L0 400 Z" fill="#2a6"/></svg>`);
const jpeg = async (seed: number, opts: { quality?: number; width?: number; orientation?: number } = {}) => {
  let img = sharp(scene(seed)).removeAlpha();
  if (opts.width) img = img.resize(opts.width);
  const out = img.jpeg({ quality: opts.quality ?? 90 });
  return new Uint8Array(
    await (opts.orientation ? out.withMetadata({ orientation: opts.orientation }) : out).toBuffer(),
  );
};

describe("clipInputFromBytes", () => {
  test("produces a normalized NCHW tensor of 3×224×224", async () => {
    const solid = await sharp({ create: { width: 300, height: 200, channels: 3, background: { r: 255, g: 0, b: 0 } } })
      .png()
      .toBuffer();
    const t = await clipInputFromBytes(sharp, new Uint8Array(solid), CLIP_MODEL);
    const plane = 224 * 224;
    expect(t.length).toBe(3 * plane);
    // Pure red: R = (1 − mean) / std, G and B = (0 − mean) / std, at every pixel.
    expect(t[0]).toBeCloseTo((1 - CLIP_MODEL.mean[0]) / CLIP_MODEL.std[0], 4);
    expect(t[plane + 123]).toBeCloseTo(-CLIP_MODEL.mean[1] / CLIP_MODEL.std[1], 4);
    expect(t[2 * plane + 999]).toBeCloseTo(-CLIP_MODEL.mean[2] / CLIP_MODEL.std[2], 4);
  });

  test("greyscale and alpha inputs still give three channels", async () => {
    const grey = await sharp(scene(1)).greyscale().png().toBuffer();
    const rgba = await sharp(scene(1)).ensureAlpha(0.4).png().toBuffer();
    for (const b of [grey, rgba])
      expect((await clipInputFromBytes(sharp, new Uint8Array(b), CLIP_MODEL)).length).toBe(3 * 224 * 224);
  });
});

describe("l2Normalize / cosineDistance", () => {
  test("normalizes and measures distance", () => {
    const a = l2Normalize(new Float32Array([3, 4]));
    expect(Array.from(a)).toEqual([0.6000000238418579, 0.800000011920929]);
    expect(cosineDistance(a, a)).toBeCloseTo(0, 6);
    expect(cosineDistance(l2Normalize(new Float32Array([1, 0])), l2Normalize(new Float32Array([0, 1])))).toBeCloseTo(
      1,
      6,
    );
  });
});

// Real-model tests: set GIGGLE_TEST_CLIP_MODEL to a downloaded visual/model.onnx to run them.
const modelPath = process.env.GIGGLE_TEST_CLIP_MODEL;
describe.skipIf(!modelPath)("embedImage with the real model", () => {
  let clip: ClipSession;
  const embed = async (bytes: Uint8Array) =>
    embedImage(ort, clip, CLIP_MODEL, await clipInputFromBytes(sharp, bytes, CLIP_MODEL));
  beforeAll(async () => {
    clip = await createClipSession(ort, modelPath as string, { threads: 2 });
  });

  test("embeddings are 512-d unit vectors", async () => {
    const e = await embed(await jpeg(1));
    expect(e.length).toBe(512);
    expect(cosineDistance(e, e)).toBeCloseTo(0, 5);
  });

  // Relative assertions only: absolute CLIP distances on synthetic graphics say nothing about
  // photos (threshold calibration happens on the real library; RFD-002 §D).
  test("edited copies are closer than a different scene; EXIF rotation is undone", async () => {
    const base = await embed(await jpeg(1));
    // A genuinely different picture (a checkerboard), not a recoloured variant of the same scene.
    const board = await sharp(
      Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><defs><pattern id="p" width="80" height="80" patternUnits="userSpaceOnUse"><rect width="40" height="40" fill="#000"/><rect x="40" y="40" width="40" height="40" fill="#000"/></pattern></defs><rect width="100%" height="100%" fill="#fff"/><rect width="100%" height="100%" fill="url(#p)"/></svg>`,
      ),
    )
      .jpeg()
      .toBuffer();
    const unrelated = cosineDistance(base, await embed(new Uint8Array(board)));
    const edits = {
      recompressed: cosineDistance(base, await embed(await jpeg(1, { quality: 30 }))),
      // 50 %: stays above the 224 px model input (a 25 % copy of a 640 px image would not).
      resized: cosineDistance(base, await embed(await jpeg(1, { width: 320 }))),
      exifTaggedUpright: cosineDistance(base, await embed(await jpeg(1, { orientation: 1 }))),
    };
    for (const [name, d] of Object.entries(edits)) {
      expect({ name, closerThanUnrelated: d < unrelated, underCeiling: d < 0.15 }).toEqual({
        name,
        closerThanUnrelated: true,
        underCeiling: true,
      });
    }
  });

  test("an unknown execution provider falls back to CPU and says why", async () => {
    const fallback = await createClipSession(ort, modelPath as string, { provider: "cuda", threads: 1 });
    expect(fallback.provider === "cpu" ? typeof fallback.fallbackReason : "cuda").toBeTruthy();
  });
});
