import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "bun:test";
import sharp from "sharp";
import { ensureSharpProcess, requestImageAnalysis, requestImageEmbedding, shutdownSharpProcess } from "./sharp-process";

const dir = mkdtempSync(join(tmpdir(), "sharp-process-"));
const image = join(dir, "a.jpg");
writeFileSync(
  image,
  await sharp({ create: { width: 400, height: 300, channels: 3, background: "#3a7" } })
    .jpeg()
    .toBuffer(),
);
afterAll(() => {
  shutdownSharpProcess();
  rmSync(dir, { recursive: true, force: true });
});

describe("analysis worker (real child process)", () => {
  test("without a model: hashes, no embedding, clip null", async () => {
    const caps = await ensureSharpProcess(null);
    expect(caps).toMatchObject({ sharp: true, phash: true, clip: null });
    const r = await requestImageAnalysis(image);
    expect(r.perceptualHash).toMatch(/^[0-9a-f]{16}$/);
    expect(r.clipEmbedding).toBeUndefined();
  });

  test("a missing model file is reported, and analysis still works", async () => {
    const caps = await ensureSharpProcess({ modelPath: join(dir, "nope.onnx"), provider: "cpu", threads: 1 });
    expect(caps.clip && "error" in caps.clip).toBe(true);
    expect((await requestImageAnalysis(image)).contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  // Set GIGGLE_TEST_CLIP_MODEL to a downloaded visual/model.onnx to run.
  const modelPath = process.env.GIGGLE_TEST_CLIP_MODEL;
  test.skipIf(!modelPath)("with the model: the same single pass also returns a 512-d embedding", async () => {
    const caps = await ensureSharpProcess({ modelPath: modelPath as string, provider: "cpu", threads: 2 });
    expect(caps.clip).toMatchObject({ provider: "cpu" });
    const r = await requestImageAnalysis(image);
    expect(r.clipEmbedding).toHaveLength(512);
    expect(r.timings.clipInference).toBeGreaterThan(0);
    const e = await requestImageEmbedding(image);
    expect(e.clipEmbedding).toHaveLength(512);
    const dot = (r.clipEmbedding as number[]).reduce(
      (s, v, i) => s + v * ((e.clipEmbedding as number[])[i] as number),
      0,
    );
    expect(dot).toBeCloseTo(1, 4);
  });
});
