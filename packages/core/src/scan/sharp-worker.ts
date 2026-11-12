/**
 * Sharp worker — runs in an isolated child process to avoid GLib ref-counting
 * races with Chromium in Electrobun desktop apps.
 *
 * Both Sharp (libvips) and Chromium use GLib. When they coexist in the same
 * process, concurrent GLib ref-counting causes assertion failures. Running
 * Sharp in a separate process eliminates this entirely.
 *
 * Protocol (IPC via Bun.spawn):
 *   Parent → Child: SharpRequest  { id, filePath, computeContentHash, computePerceptualHash }
 *   Child → Parent: SharpResponse { id, contentHash?, perceptualHash?, timings, error? }
 *   Child → Parent: { type: "ready", sharp: boolean, phash: boolean } on startup
 */

import type SharpType from "sharp";

let sharpFn: typeof SharpType | null = null;
let phashFn: ((input: string | Uint8Array) => Promise<string>) | null = null;

// Load Sharp
try {
  const sharpModule = await import("sharp");
  sharpFn = sharpModule.default;
  sharpFn.concurrency(1);
} catch (error) {
  const msg = error instanceof Error ? error.message : String(error);
  console.error(`[sharp-worker] Failed to load sharp: ${msg}`);
}

// Load sharp-phash
try {
  const phashModule = await import("sharp-phash");
  phashFn = phashModule.default;
} catch (error) {
  const msg = error instanceof Error ? error.message : String(error);
  console.error(`[sharp-worker] Failed to load sharp-phash: ${msg}`);
}

interface SharpRequest {
  id: number;
  filePath: string;
  computeContentHash: boolean;
  computePerceptualHash: boolean;
}

interface SharpResponse {
  id: number;
  contentHash?: string | null;
  perceptualHash?: string | null;
  readMs?: number;
  contentHashMs?: number;
  perceptualHashMs?: number;
  error?: string;
}

process.on("message", async (msg: SharpRequest) => {
  const response: SharpResponse = { id: msg.id };

  try {
    // Read file once for both algorithms
    const readStart = performance.now();
    const fileBytes = await Bun.file(msg.filePath).bytes();
    response.readMs = performance.now() - readStart;

    // --- Content hash: decode to raw pixels, SHA-256 of pixel data ---
    if (msg.computeContentHash) {
      if (!sharpFn) {
        response.contentHash = undefined;
        response.error = "Sharp module not available in worker";
      } else {
        try {
          const t0 = performance.now();
          const { data } = await sharpFn(fileBytes).raw().toBuffer({ resolveWithObject: true });

          const hasher = new Bun.CryptoHasher("sha256");
          hasher.update(data);
          response.contentHash = hasher.digest("hex");
          response.contentHashMs = performance.now() - t0;
        } catch {
          response.contentHash = null; // unsupported format
        }
      }
    }

    // --- Perceptual hash: DCT-based 64-bit hash ---
    if (msg.computePerceptualHash) {
      if (!phashFn) {
        response.perceptualHash = undefined;
        response.error = "sharp-phash module not available in worker";
      } else {
        try {
          const t0 = performance.now();
          response.perceptualHash = await phashFn(fileBytes);
          response.perceptualHashMs = performance.now() - t0;
        } catch {
          response.perceptualHash = null; // unsupported format
        }
      }
    }
  } catch (err) {
    response.error = err instanceof Error ? err.message : String(err);
  }

  process.send?.(response);
});

// Signal ready with module availability
process.send?.({
  type: "ready",
  sharp: sharpFn !== null,
  phash: phashFn !== null,
});
