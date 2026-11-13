/**
 * Build the Tailwind stylesheet (v3, tailwind.config.js) to .build-assets/tailwind.css.
 * Run by the Electrobun preBuild step and by the E2E server; replaces the runtime CDN script so the
 * app renders styled without network access.
 */
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const appRoot = join(import.meta.dir, "..");

export function buildCss(outFile = join(appRoot, ".build-assets", "tailwind.css")): string {
  const cli = join(appRoot, "node_modules", ".bin", "tailwindcss");
  const run = spawnSync(
    cli,
    [
      "-c",
      join(appRoot, "tailwind.config.js"),
      "-i",
      join(appRoot, "src/views/tailwind.css"),
      "-o",
      outFile,
      "--minify",
    ],
    { cwd: appRoot, encoding: "utf8" },
  );
  if (run.status !== 0) throw new Error(`Tailwind build failed:\n${run.stderr}`);
  return outFile;
}

if (import.meta.main) {
  process.stdout.write(`tailwind css built -> ${buildCss()}\n`);
}
