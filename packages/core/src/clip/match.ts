/**
 * All-pairs CLIP matching (RFD-002 §D): for every image, its top-K most similar images via the
 * MatMul + TopK graph, in row blocks; keep pairs at or under `maxDistance` (cosine distance).
 * ⚠️ FRAGILE: See _FRAGILE.md
 *
 * TopK makes each row's neighbour list asymmetric, so a pair is kept if either side finds the other,
 * and de-duplicated. An image with more than `topK` neighbours under the threshold (long bursts)
 * keeps only its closest `topK`: raise `topK` if that matters.
 */
import type * as Ort from "onnxruntime-node";
import { buildMatMulTopKModel } from "./onnx-topk";

export interface ClipPair {
  mediaFileId1: number;
  mediaFileId2: number;
  distance: number;
}

export interface ClipMatchOptions {
  dimensions: number;
  /** Keep pairs with cosine distance ≤ this (RFD-002: store everything ≤ 0.12). */
  maxDistance: number;
  /** Neighbours considered per image (default 64). */
  topK?: number;
  /** Rows per MatMul block; memory ≈ blockRows × N × 4 bytes (default 256). */
  blockRows?: number;
  threads?: number;
  onProgress?: (done: number, total: number) => void;
}

/**
 * @param ids media file ids, one per row of `vectors`
 * @param vectors L2-normalised embeddings, row-major (ids.length × dimensions)
 */
export async function findClipPairs(
  ort: typeof Ort,
  ids: readonly number[],
  vectors: Float32Array,
  options: ClipMatchOptions,
): Promise<ClipPair[]> {
  const n = ids.length;
  const d = options.dimensions;
  if (vectors.length !== n * d) throw new Error(`Expected ${n}×${d} values, got ${vectors.length}`);
  if (n < 2) return [];

  const session = await ort.InferenceSession.create(buildMatMulTopKModel(d), {
    intraOpNumThreads: options.threads || 4,
    interOpNumThreads: 1,
    executionProviders: ["cpu"],
  });
  const bt = new Float32Array(d * n);
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < d; col++) bt[col * n + row] = vectors[row * d + col] as number;
  }
  const btTensor = new ort.Tensor("float32", bt, [d, n]);
  const k = Math.min((options.topK ?? 64) + 1, n); // +1: each row also finds itself
  const kTensor = new ort.Tensor("int64", BigInt64Array.from([BigInt(k)]), [1]);
  const blockRows = options.blockRows ?? 256;

  const pairs = new Map<string, ClipPair>();
  for (let start = 0; start < n; start += blockRows) {
    const rows = Math.min(blockRows, n - start);
    const a = new ort.Tensor("float32", vectors.subarray(start * d, (start + rows) * d), [rows, d]);
    const out = await session.run({ a, bt: btTensor, k: kTensor });
    const values = out.values?.data as Float32Array;
    const indices = out.indices?.data as BigInt64Array;
    for (let r = 0; r < rows; r++) {
      const i = start + r;
      for (let c = 0; c < k; c++) {
        const j = Number(indices[r * k + c]);
        if (j === i) continue;
        const distance = Math.max(0, 1 - (values[r * k + c] as number));
        if (distance > options.maxDistance) break; // sorted descending by similarity
        const id1 = Math.min(ids[i] as number, ids[j] as number);
        const id2 = Math.max(ids[i] as number, ids[j] as number);
        const key = `${id1}:${id2}`;
        if (!pairs.has(key)) pairs.set(key, { mediaFileId1: id1, mediaFileId2: id2, distance });
      }
    }
    options.onProgress?.(start + rows, n);
  }
  await session.release();
  return [...pairs.values()];
}
