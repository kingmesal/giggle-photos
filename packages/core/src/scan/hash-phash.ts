/**
 * Perceptual hash (pHash), in-house. ⚠️ FRAGILE: See _FRAGILE.md
 *
 * Changing ANY step changes every stored hash, so the algorithm is fixed and documented:
 *
 *   1. Input: 32×32 greyscale luminance (0–255), row-major, already EXIF-oriented. The worker
 *      produces it with sharp from the file bytes (image-analysis.ts):
 *      `.rotate().removeAlpha().greyscale().resize(32, 32, { fit: "fill" }).raw({ depth: "uchar" })`.
 *   2. Unnormalised 2-D DCT-II (as scipy.fft.dct, norm=None, applied to rows then columns):
 *        X[k] = 2 · Σₙ x[n] · cos(π · k · (2n + 1) / (2N)),  N = 32
 *      Only the 8 lowest frequencies per axis are needed, so only those are computed.
 *   3. Keep the top-left 8×8 block (k_row, k_col ∈ 0..7), DC included, each coefficient rounded
 *      to 1e-6. Rounding removes floating-point noise, so coefficients that are mathematically
 *      equal (e.g. the zero AC terms of a flat image) compare equal regardless of summation order.
 *   4. Threshold at the median of those 64 values (mean of the 32nd and 33rd smallest):
 *      bit = coefficient > median.
 *   5. Bits in row-major order (k_row, then k_col), first bit most significant, written as
 *      16 lower-case hex characters.
 *
 * This is the classic DCT pHash (as in the `imagehash` Python package). Distances between
 * hashes are Hamming distances (0–64).
 */
import { HashError } from "./hash-error";

export const PHASH_INPUT_SIZE = 32;
const LOW = 8;
const N = PHASH_INPUT_SIZE;
const HEX_PATTERN = /^[0-9a-f]{16}$/;
/** Coefficients are rounded to 1/ROUNDING before thresholding (step 3). */
const ROUNDING = 1e6;

/** COS[k][n] = cos(π·k·(2n+1)/(2N)) for k < 8, n < 32. */
const COS: Float64Array[] = Array.from({ length: LOW }, (_, k) =>
  Float64Array.from({ length: N }, (_, n) => Math.cos((Math.PI * k * (2 * n + 1)) / (2 * N))),
);

/** The 8×8 low-frequency block of the unnormalised 2-D DCT-II of a 32×32 image (rounded, row-major). */
export function lowFrequencyDct(grey: ArrayLike<number>): Float64Array {
  if (grey.length !== N * N) {
    throw new HashError("invalid_hash", `pHash input must be ${N}×${N} = ${N * N} values, got ${grey.length}`);
  }
  // Row transform: rows[y][kx] for the 8 lowest horizontal frequencies.
  const rows = new Float64Array(N * LOW);
  for (let y = 0; y < N; y++) {
    for (let kx = 0; kx < LOW; kx++) {
      const cos = COS[kx] as Float64Array;
      let sum = 0;
      for (let x = 0; x < N; x++) sum += (grey[y * N + x] as number) * (cos[x] as number);
      rows[y * LOW + kx] = 2 * sum;
    }
  }
  // Column transform on the row results, again keeping the 8 lowest frequencies.
  const block = new Float64Array(LOW * LOW);
  for (let ky = 0; ky < LOW; ky++) {
    const cos = COS[ky] as Float64Array;
    for (let kx = 0; kx < LOW; kx++) {
      let sum = 0;
      for (let y = 0; y < N; y++) sum += (rows[y * LOW + kx] as number) * (cos[y] as number);
      block[ky * LOW + kx] = Math.round(2 * sum * ROUNDING) / ROUNDING;
    }
  }
  return block;
}

/** pHash of a 32×32 greyscale image as 16 lower-case hex characters. */
export function perceptualHashFromGrey(grey: ArrayLike<number>): string {
  const block = lowFrequencyDct(grey);
  const sorted = Float64Array.from(block).sort();
  const median = ((sorted[31] as number) + (sorted[32] as number)) / 2;
  let hex = "";
  for (let nibble = 0; nibble < 16; nibble++) {
    let value = 0;
    for (let bit = 0; bit < 4; bit++) {
      value = (value << 1) | ((block[nibble * 4 + bit] as number) > median ? 1 : 0);
    }
    hex += value.toString(16);
  }
  return hex;
}

function popcount32(v: number): number {
  let x = v - ((v >>> 1) & 0x55555555);
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

/** Split a 16-hex-char pHash into its two 32-bit halves (validated). */
export function phashHalves(hash: string): [number, number] {
  if (!HEX_PATTERN.test(hash)) {
    throw new HashError("invalid_hash", `Not a 16-character hex pHash: "${hash}"`);
  }
  return [Number.parseInt(hash.slice(0, 8), 16), Number.parseInt(hash.slice(8), 16)];
}

/** Hamming distance between two pre-split hashes (hot loop: no parsing, no allocation). */
export function hammingDistanceHalves(a: readonly [number, number], b: readonly [number, number]): number {
  return popcount32((a[0] ^ b[0]) >>> 0) + popcount32((a[1] ^ b[1]) >>> 0);
}

/** Hamming distance (0–64) between two 16-hex-char pHashes. */
export function hammingDistance(hash1: string, hash2: string): number {
  return hammingDistanceHalves(phashHalves(hash1), phashHalves(hash2));
}
