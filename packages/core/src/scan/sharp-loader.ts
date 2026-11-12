/**
 * Lazy loader for sharp module to handle cases where native bindings aren't available.
 * This allows the app to start even if sharp can't be loaded (e.g., in bundled builds).
 */

import { getLogger } from "../logging/logger";

const log = getLogger("core:sharp-loader");

import type sharp from "sharp";

// When dynamically importing, we get the module namespace with default export
type SharpFunction = typeof sharp;
type SharpPhashFunction = (input: string | Uint8Array) => Promise<string>;

let sharpFn: SharpFunction | null = null;
let sharpPhashFn: SharpPhashFunction | null = null;
let sharpLoadAttempted = false;
let sharpPhashLoadAttempted = false;

/**
 * Attempts to load the sharp module.
 * Returns null if the module can't be loaded (e.g., native bindings not available).
 */
export async function getSharp(): Promise<SharpFunction | null> {
  if (sharpLoadAttempted) {
    return sharpFn;
  }

  sharpLoadAttempted = true;

  try {
    const module = await import("sharp");
    sharpFn = module.default;
    // Limit libvips internal thread pool to 1 to prevent GLib ref-counting
    // races with Chromium's GLib usage in the same process.
    sharpFn.concurrency(1);
    log.debug("Sharp module loaded successfully (concurrency=1)");
    return sharpFn;
  } catch (error) {
    log.warn(
      "Sharp module could not be loaded. Image content hashing and metadata extraction will be disabled.",
      error,
    );
    return null;
  }
}

/**
 * Attempts to load the sharp-phash module.
 * Returns null if the module can't be loaded.
 */
export async function getSharpPhash(): Promise<SharpPhashFunction | null> {
  if (sharpPhashLoadAttempted) {
    return sharpPhashFn;
  }

  sharpPhashLoadAttempted = true;

  try {
    const module = await import("sharp-phash");
    sharpPhashFn = module.default;
    log.debug("Sharp-phash module loaded successfully");
    return sharpPhashFn;
  } catch (error) {
    log.warn("Sharp-phash module could not be loaded. Perceptual hashing will be disabled.", error);
    return null;
  }
}

/**
 * Check if sharp is available without loading it.
 */
export function isSharpAvailable(): boolean {
  return sharpFn !== null;
}

/**
 * Check if sharp-phash is available without loading it.
 */
export function isSharpPhashAvailable(): boolean {
  return sharpPhashFn !== null;
}
