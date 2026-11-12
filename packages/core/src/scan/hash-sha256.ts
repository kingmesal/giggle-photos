import { getLogger } from "../logging/logger";

const log = getLogger("core:hash-sha256");

/**
 * Compute SHA-256 hash of file bytes or a file on disk.
 *
 * When given a Uint8Array/Buffer, hashes it directly (zero I/O).
 * When given a file path string, streams the file for memory efficiency.
 *
 * @param input - File bytes (Uint8Array/Buffer) or an absolute file path
 * @returns SHA-256 hash as a hex string
 */
export async function computeSha256(input: string | Uint8Array): Promise<string> {
  const hasher = new Bun.CryptoHasher("sha256");

  if (typeof input !== "string") {
    // Buffer: hash directly — no I/O needed
    hasher.update(input);
    const hex = hasher.digest("hex");
    log.debug(`SHA-256 from buffer (${input.length} bytes): ${hex.substring(0, 16)}...`);
    return hex;
  }

  // File path: stream for memory efficiency (standalone usage)
  const file = Bun.file(input);
  const stream = file.stream();
  const reader = stream.getReader();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      hasher.update(value);
    }
  } finally {
    reader.releaseLock();
  }

  return hasher.digest("hex");
}
