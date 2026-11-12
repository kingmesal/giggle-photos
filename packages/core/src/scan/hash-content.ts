import { getLogger } from "../logging/logger";

const log = getLogger("core:hash-content");

/**
 * Computes a content hash for an image, ignoring all metadata.
 *
 * Decodes the image to raw pixel data (stripping EXIF, ICC profiles, etc.)
 * and computes a SHA-256 hash of the raw pixel buffer.
 *
 * Two images that are visually identical but differ only in metadata will
 * have the same content hash.
 *
 * @param input - Image bytes (Uint8Array/Buffer) or an absolute file path
 * @returns SHA-256 hash of the raw pixel data as a hex string, or null if
 *          the image format is not supported or decoding fails
 */
export async function computeContentHash(input: string | Uint8Array): Promise<string | null> {
  // Lazy import to avoid loading Sharp/libvips in the main process.
  // Sharp operations are routed through the child process (sharp-worker.ts).
  const { getSharp } = await import("./sharp-loader");
  const sharp = await getSharp();
  if (!sharp) {
    throw new Error("Sharp module not available — cannot compute content hash");
  }

  try {
    // Decode to raw pixel data — strips all metadata
    const { data } = await sharp(input).raw().toBuffer({ resolveWithObject: true });

    const hasher = new Bun.CryptoHasher("sha256");
    hasher.update(data);
    const hex = hasher.digest("hex");
    log.debug(
      `Content hash from ${typeof input === "string" ? input : `buffer (${input.length} bytes)`}: ${hex.substring(0, 16)}...`,
    );
    return hex;
  } catch (error) {
    // Return null for unsupported formats or processing errors
    log.debug(
      `Failed to compute content hash for ${typeof input === "string" ? input : `buffer (${input.length} bytes)`}: ${error}`,
    );
    return null;
  }
}
