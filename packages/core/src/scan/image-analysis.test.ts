import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import sharp from "sharp";
import { ByteBudget } from "./byte-budget";
import { hammingDistance } from "./hash-phash";
import { analyzeImageBytes, analyzeImageFile, estimateDecodeBytes } from "./image-analysis";

const dir = mkdtempSync(join(tmpdir(), "image-analysis-"));
const W = 320;
const H = 200;
let scene: Buffer; // raw RGB, asymmetric so rotations are distinguishable

const sha256 = (data: Uint8Array) => new Bun.CryptoHasher("sha256").update(data).digest("hex");
const write = (name: string, data: Uint8Array): string => {
  const path = join(dir, name);
  writeFileSync(path, data);
  return path;
};
const raw = () => sharp(scene, { raw: { width: W, height: H, channels: 3 } });

beforeAll(async () => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <rect width="100%" height="100%" fill="#2a6"/><circle cx="70" cy="60" r="45" fill="#fd3"/>
    <rect x="180" y="110" width="120" height="70" fill="#c13"/></svg>`;
  scene = await sharp(Buffer.from(svg)).removeAlpha().raw().toBuffer();
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("analyzeImageFile", () => {
  test("one pass yields sha256, unchanged contentHash semantics, pHash, EXIF and decoded info", async () => {
    const path = write("base.jpg", await raw().jpeg({ quality: 92 }).withMetadata({ orientation: 1 }).toBuffer());
    const result = await analyzeImageFile(sharp, path, null);

    expect(result.failure).toBeUndefined();
    expect(result.sha256).toBe(sha256(readFileSync(path)));
    // contentHash = SHA-256 of the stored pixels exactly as before (sharp(bytes).raw()).
    expect(result.contentHash).toBe(sha256(await sharp(readFileSync(path)).raw().toBuffer()));
    expect(result.perceptualHash).toMatch(/^[0-9a-f]{16}$/);
    expect(result.decoded).toEqual({ width: W, height: H, format: "jpeg", hasAlpha: false });
    expect(result.exif?.Orientation).toBe(1);
    for (const t of ["read", "sha256", "exif", "decode", "contentHash", "perceptualHash"] as const) {
      expect(result.timings[t]).toBeGreaterThanOrEqual(0);
    }
  });

  test("an EXIF-rotated photo and a physically rotated copy get (nearly) the same pHash", async () => {
    const tagged = write("tagged.jpg", await raw().jpeg({ quality: 95 }).withMetadata({ orientation: 6 }).toBuffer());
    const rotatedPixels = await raw().rotate(90).raw().toBuffer();
    const physical = write(
      "physical.jpg",
      await sharp(rotatedPixels, { raw: { width: H, height: W, channels: 3 } })
        .jpeg({ quality: 95 })
        .toBuffer(),
    );
    const a = await analyzeImageFile(sharp, tagged, null);
    const b = await analyzeImageFile(sharp, physical, null);
    expect(a.exif?.Orientation).toBe(6);
    expect(hammingDistance(a.perceptualHash as string, b.perceptualHash as string)).toBeLessThanOrEqual(4);
    // contentHash still hashes stored pixels, so the two files differ there.
    expect(a.contentHash).not.toBe(b.contentHash);
  });

  test("same pixels, different bytes: equal contentHash, different sha256", async () => {
    const a = write("a.png", await raw().png({ compressionLevel: 9 }).toBuffer());
    const b = write("b.png", await raw().png({ compressionLevel: 1 }).toBuffer());
    const [ra, rb] = await Promise.all([analyzeImageFile(sharp, a, null), analyzeImageFile(sharp, b, null)]);
    expect(ra.sha256).not.toBe(rb.sha256);
    expect(ra.contentHash).toBe(rb.contentHash as string);
    expect(ra.perceptualHash).toBe(rb.perceptualHash as string);
  });

  test("16-bit and RGBA images are analysed", async () => {
    const rgba = write("rgba.png", await raw().ensureAlpha(0.5).png().toBuffer());
    const deep = write("deep.png", await raw().toColourspace("rgb16").png().toBuffer());
    const base = await analyzeImageFile(sharp, write("plain.png", await raw().png().toBuffer()), null);
    for (const path of [rgba, deep]) {
      const result = await analyzeImageFile(sharp, path, null);
      expect(result.failure).toBeUndefined();
      expect(hammingDistance(result.perceptualHash as string, base.perceptualHash as string)).toBeLessThanOrEqual(2);
    }
  });

  test("failures are categorized, and sha256 is still reported when the bytes were read", async () => {
    const empty = await analyzeImageFile(sharp, write("empty.jpg", new Uint8Array()), null);
    expect(empty.failure?.category).toBe("empty_file");
    expect(empty.sha256).toBe(sha256(new Uint8Array()));

    const full = await raw().jpeg().toBuffer();
    const truncated = await analyzeImageFile(sharp, write("cut.jpg", full.subarray(0, full.length / 2)), null);
    expect(truncated.failure?.category).toBe("corrupt_or_truncated");
    expect(truncated.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(truncated.contentHash).toBeUndefined();

    const garbage = await analyzeImageFile(sharp, write("fake.heic", new TextEncoder().encode("not an image")), null);
    expect(garbage.failure).toMatchObject({ category: "unsupported_format", format: "heic" });

    const missing = await analyzeImageFile(sharp, join(dir, "nope.jpg"), null);
    expect(missing.failure?.category).toBe("file_not_found");
    expect(missing.sha256).toBeUndefined();
  });
});

describe("memory budget", () => {
  test("estimateDecodeBytes counts compressed bytes plus raw pixels", () => {
    expect(estimateDecodeBytes(1000, 4000, 3000, 3)).toBe(1000 + 72_000_000);
    expect(estimateDecodeBytes(0, 10, 10, 1)).toBe(600); // at least 3 channels
    expect(estimateDecodeBytes(0, 10, 10, 3, "ushort")).toBe(1200);
  });

  test("an image larger than the budget still decodes, and the budget is released", async () => {
    const budget = new ByteBudget(1024); // far smaller than one decode
    const bytes = await raw().jpeg().toBuffer();
    const results = await Promise.all([1, 2, 3].map(() => analyzeImageBytes(sharp, bytes, "x.jpg", budget)));
    for (const result of results) expect(result.failure).toBeUndefined();
    expect(budget.bytesInUse).toBe(0);
  });
});
