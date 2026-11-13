/**
 * Electrobun preBuild step: bundle the sharp worker into one self-contained JS file.
 *
 * The worker runs as its own process (`bun run sharp-worker.js`) to keep libvips' GLib away
 * from Chromium, so it is not part of the main bundle. Bundling inlines its imports (exifr,
 * the in-house pHash) and leaves native `sharp` external, resolved from node_modules at runtime.
 */
import { join } from "node:path";

const appRoot = join(import.meta.dir, "..");
const entry = join(appRoot, "../../packages/core/src/scan/sharp-worker.ts");
const outdir = join(appRoot, ".worker-build");

const result = await Bun.build({
  entrypoints: [entry],
  outdir,
  target: "bun",
  format: "esm",
  external: ["sharp"],
  naming: "sharp-worker.js",
});

if (!result.success) {
  for (const message of result.logs) process.stderr.write(`${String(message)}\n`);
  throw new Error("sharp worker bundle failed");
}
process.stdout.write(`sharp worker bundled -> ${join(outdir, "sharp-worker.js")}\n`);
