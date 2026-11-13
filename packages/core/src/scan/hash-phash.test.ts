import { describe, expect, test } from "bun:test";
import { HashError } from "./hash-error";
import {
  hammingDistance,
  hammingDistanceHalves,
  lowFrequencyDct,
  PHASH_INPUT_SIZE,
  perceptualHashFromGrey,
  phashHalves,
} from "./hash-phash";

const N = PHASH_INPUT_SIZE;
const image = (f: (x: number, y: number) => number): number[] =>
  Array.from({ length: N * N }, (_, i) => Math.round(f(i % N, Math.floor(i / N))));

function lcg(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return s / 4294967296;
  };
}

/** Independent reference: the textbook 2-D DCT-II written straight from the formula (O(N⁴)). */
function naiveHash(grey: number[]): string {
  const coeffs: number[] = [];
  for (let u = 0; u < 8; u++) {
    for (let v = 0; v < 8; v++) {
      let s = 0;
      for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
          s +=
            (grey[y * N + x] as number) *
            Math.cos((Math.PI * u * (2 * y + 1)) / (2 * N)) *
            Math.cos((Math.PI * v * (2 * x + 1)) / (2 * N));
        }
      }
      coeffs.push(Math.round(4 * s * 1e6) / 1e6);
    }
  }
  const sorted = [...coeffs].sort((a, b) => a - b);
  const median = ((sorted[31] as number) + (sorted[32] as number)) / 2;
  let hex = "";
  for (let i = 0; i < 16; i++) {
    let n = 0;
    for (let b = 0; b < 4; b++) n = (n << 1) | ((coeffs[i * 4 + b] as number) > median ? 1 : 0);
    hex += n.toString(16);
  }
  return hex;
}

const rand = lcg(42);
const GOLDEN: [string, number[], string][] = [
  ["black", image(() => 0), "0000000000000000"],
  ["flat grey (only DC above the zero median)", image(() => 128), "8000000000000000"],
  ["radial gradient", image((x, y) => 255 - Math.min(255, 12 * Math.hypot(x - 15.5, y - 15.5))), "8000220008002200"],
  ["sinusoids", image((x, y) => 127.5 + 60 * Math.sin(x / 3) + 60 * Math.cos(y / 5)), "f0a89d5d615b611d"],
  [
    "blob scene",
    image((x, y) => (x > 8 && x < 20 && y > 4 && y < 14 ? 230 : x + y > 40 ? 90 : 30)),
    "8fcf3030303bce5d",
  ],
  ["seeded noise", image(() => Math.floor(rand() * 256)), "fb8374f826e8380d"],
];

describe("perceptualHashFromGrey", () => {
  for (const [name, grey, expected] of GOLDEN) {
    test(`golden: ${name}`, () => {
      expect(perceptualHashFromGrey(grey)).toBe(expected);
    });
    test(`matches the naive DCT reference: ${name}`, () => {
      expect(perceptualHashFromGrey(grey)).toBe(naiveHash(grey));
    });
  }

  test("is stable under brightness and contrast changes", () => {
    const [, scene] = GOLDEN[4] as [string, number[], string];
    const brighter = scene.map((v) => Math.min(255, v * 1.1 + 10));
    expect(hammingDistance(perceptualHashFromGrey(scene), perceptualHashFromGrey(brighter))).toBeLessThanOrEqual(2);
  });

  test("separates unrelated images", () => {
    const a = perceptualHashFromGrey((GOLDEN[3] as [string, number[], string])[1]);
    const b = perceptualHashFromGrey((GOLDEN[5] as [string, number[], string])[1]);
    expect(hammingDistance(a, b)).toBeGreaterThan(16);
  });

  test("rejects input that is not 32×32", () => {
    expect(() => perceptualHashFromGrey(new Array(100).fill(0))).toThrow(HashError);
    expect(() => lowFrequencyDct(new Uint8Array(N * N + 1))).toThrow(/32×32/);
  });
});

describe("hammingDistance", () => {
  test("counts differing bits across both 32-bit halves", () => {
    expect(hammingDistance("0000000000000000", "0000000000000000")).toBe(0);
    expect(hammingDistance("0000000000000000", "ffffffffffffffff")).toBe(64);
    expect(hammingDistance("8000000000000001", "0000000000000000")).toBe(2);
    expect(hammingDistance("f0f0f0f000000000", "0f0f0f0f00000000")).toBe(32);
  });

  test("is symmetric and matches the pre-split hot-loop form", () => {
    const a = "fb8374f826e8380d";
    const b = "f0a89d5d615b611d";
    expect(hammingDistance(a, b)).toBe(hammingDistance(b, a));
    expect(hammingDistanceHalves(phashHalves(a), phashHalves(b))).toBe(hammingDistance(a, b));
  });

  test("rejects the legacy 64-char bit-string format and malformed hex", () => {
    expect(() => hammingDistance("1".repeat(64), "0000000000000000")).toThrow(HashError);
    expect(() => phashHalves("FB8374F826E8380D")).toThrow(HashError);
    expect(() => phashHalves("abc")).toThrow(HashError);
  });
});
