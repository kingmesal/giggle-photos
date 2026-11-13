/**
 * Lightweight Bun HTTP server for E2E tests.
 * Bundles the UI entry point for the browser and serves it alongside
 * the HTML shell, CSS, and icon assets.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildCss } from "../../apps/desktop/scripts/build-css";

const PROJECT_ROOT = join(import.meta.dir, "../..");

// Set PROJECT_ROOT and DOTENV_ENV so env.ts finds .env files and loads .env.test
process.env.PROJECT_ROOT = PROJECT_ROOT;
process.env.DOTENV_ENV = "test";

const VIEWS_DIR = join(PROJECT_ROOT, "apps/desktop/src/views");

// Bundle the test entry point for the browser
const buildResult = await Bun.build({
  entrypoints: [join(import.meta.dir, "test-entry.ts")],
  outdir: join(import.meta.dir, ".test-build"),
  target: "browser",
  format: "esm",
  minify: false,
  sourcemap: "inline",
});

if (!buildResult.success) {
  console.error("Build failed:");
  for (const log of buildResult.logs) {
    console.error(log);
  }
  process.exit(1);
}

const bundlePath = join(import.meta.dir, ".test-build/test-entry.js");

// Read static assets
const stylesCSS = readFileSync(join(VIEWS_DIR, "styles.css"), "utf-8");
// Same build-time Tailwind stylesheet the app ships (no CDN).
const tailwindCSS = readFileSync(buildCss(join(import.meta.dir, ".test-build/tailwind.css")), "utf-8");

// HTML shell (mirrors apps/desktop/src/views/index.html but uses test bundle)
const html = `<!DOCTYPE html>
<html lang="en" class="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Giggle Photos</title>
  <style>${tailwindCSS}</style>
  <style>${stylesCSS}</style>
</head>
<body class="bg-surface text-fg">
  <div id="app"></div>
  <script type="module" src="/test-entry.js"></script>
</body>
</html>`;

const PORT = Number(process.env.E2E_PORT ?? 3000);

const server = Bun.serve({
  port: PORT,
  fetch(req) {
    const url = new URL(req.url);
    const pathname = url.pathname;

    // Serve the HTML shell
    if (pathname === "/" || pathname === "/index.html") {
      return new Response(html, {
        headers: { "Content-Type": "text/html" },
      });
    }

    // Serve the bundled test entry
    if (pathname === "/test-entry.js") {
      try {
        const bundle = readFileSync(bundlePath, "utf-8");
        return new Response(bundle, {
          headers: { "Content-Type": "application/javascript" },
        });
      } catch {
        return new Response("Bundle not found", { status: 404 });
      }
    }

    return new Response("Not found", { status: 404 });
  },
});

console.log(`E2E test server running on http://localhost:${PORT}`);
