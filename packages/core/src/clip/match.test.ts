import { describe, expect, test } from "bun:test";
import * as ort from "onnxruntime-node";
import { type ClipPair, findClipPairs } from "./match";
import { l2Normalize } from "./session";

const D = 512;

function lcg(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return s / 4294967296 - 0.5;
  };
}

/** N random unit vectors, with planted near-copies: row c becomes a noisy copy of row p. */
function dataset(n: number, planted: [number, number, number][], seed = 7) {
  const rand = lcg(seed);
  const rows = Array.from({ length: n }, () => l2Normalize(Float32Array.from({ length: D }, rand)));
  for (const [p, c, noise] of planted) {
    rows[c] = l2Normalize(Float32Array.from(rows[p] as Float32Array, (v) => v + noise * rand()));
  }
  const vectors = new Float32Array(n * D);
  for (const [i, r] of rows.entries()) vectors.set(r, i * D);
  return { ids: Array.from({ length: n }, (_, i) => 1000 + i * 3), vectors };
}

/** Reference: every pair, plain JS. */
function bruteForce(ids: number[], vectors: Float32Array, maxDistance: number): ClipPair[] {
  const out: ClipPair[] = [];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      let dot = 0;
      for (let t = 0; t < D; t++) dot += (vectors[i * D + t] as number) * (vectors[j * D + t] as number);
      const distance = Math.max(0, 1 - dot);
      if (distance <= maxDistance)
        out.push({ mediaFileId1: ids[i] as number, mediaFileId2: ids[j] as number, distance });
    }
  }
  return out;
}

const key = (p: ClipPair) => `${p.mediaFileId1}:${p.mediaFileId2}`;

describe("findClipPairs", () => {
  test("finds exactly the brute-force pairs, across block boundaries", async () => {
    const planted: [number, number, number][] = [
      [0, 1, 0.002],
      [5, 300, 0.004],
      [299, 300, 0.003], // spans a block edge (blockRows 100)
      [10, 11, 0.006],
      [400, 401, 0.02], // too far: should not appear at 0.12
    ];
    const { ids, vectors } = dataset(450, planted);
    const expected = bruteForce(ids, vectors, 0.12);
    const found = await findClipPairs(ort, ids, vectors, {
      dimensions: D,
      maxDistance: 0.12,
      blockRows: 100,
      threads: 2,
    });
    expect(found.map(key).sort()).toEqual(expected.map(key).sort());
    for (const p of found) {
      const ref = expected.find((e) => key(e) === key(p)) as ClipPair;
      expect(p.distance).toBeCloseTo(ref.distance, 4);
      expect(p.mediaFileId1).toBeLessThan(p.mediaFileId2);
    }
    expect(found.length).toBeGreaterThan(0);
  });

  test("topK caps neighbours per image (a 6-image burst with topK 2)", async () => {
    const burst: [number, number, number][] = [1, 2, 3, 4, 5].map((c) => [0, c, 0.001]);
    const { ids, vectors } = dataset(50, burst, 11);
    const all = await findClipPairs(ort, ids, vectors, { dimensions: D, maxDistance: 0.12, topK: 10 });
    const capped = await findClipPairs(ort, ids, vectors, { dimensions: D, maxDistance: 0.12, topK: 2 });
    expect(all.length).toBe(15); // C(6, 2)
    expect(capped.length).toBeLessThan(15);
    expect(capped.length).toBeGreaterThanOrEqual(6);
  });

  test("fewer than two images means no pairs; a size mismatch is an error", async () => {
    expect(await findClipPairs(ort, [1], new Float32Array(D), { dimensions: D, maxDistance: 0.1 })).toEqual([]);
    await expect(
      findClipPairs(ort, [1, 2], new Float32Array(D), { dimensions: D, maxDistance: 0.1 }),
    ).rejects.toThrow();
  });
});
