import { getLogger } from "../logging/logger";

const log = getLogger("core:hash-phash");

// Cache the distance function once loaded
let distanceFn: ((hash1: string, hash2: string) => number) | null = null;

/**
 * Compute perceptual hash (pHash) of an image.
 *
 * Uses DCT-based perceptual hashing that is robust to resizing,
 * compression, and minor edits. Returns a 64-character binary string.
 *
 * @param input - Image bytes (Uint8Array/Buffer) or an absolute file path
 * @returns 64-character binary hash string, or null if hashing fails
 */
export async function computePerceptualHash(input: string | Uint8Array): Promise<string | null> {
  // Lazy import to avoid loading Sharp/libvips in the main process.
  // Sharp operations are routed through the child process (sharp-worker.ts).
  const { getSharpPhash } = await import("./sharp-loader");
  const sharpPhash = await getSharpPhash();
  if (!sharpPhash) {
    throw new Error("Sharp-phash module not available — cannot compute perceptual hash");
  }

  try {
    const hash = await sharpPhash(input);
    log.debug(
      `pHash from ${typeof input === "string" ? input : `buffer (${input.length} bytes)`}: ${hash.substring(0, 16)}...`,
    );
    return hash;
  } catch (error) {
    log.debug(
      `Failed to compute pHash for ${typeof input === "string" ? input : `buffer (${input.length} bytes)`}: ${error}`,
    );
    return null;
  }
}

/**
 * Calculate the Hamming distance between two perceptual hashes.
 *
 * The Hamming distance is the number of positions at which the
 * corresponding bits differ. Lower distance = more similar images.
 *
 * Typical thresholds:
 * - 0: Identical images
 * - 1-5: Very similar (likely duplicates)
 * - 6-10: Somewhat similar
 * - >10: Different images
 *
 * @param hash1 - First perceptual hash (64-char binary string)
 * @param hash2 - Second perceptual hash (64-char binary string)
 * @returns Number of differing bits (0-64), or -1 if module not available
 */
export async function hammingDistance(hash1: string, hash2: string): Promise<number> {
  if (!distanceFn) {
    try {
      const distanceModule = await import("sharp-phash/distance");
      distanceFn = distanceModule.default;
    } catch {
      log.debug("Sharp-phash distance not available");
      return -1;
    }
  }
  return distanceFn(hash1, hash2);
}
