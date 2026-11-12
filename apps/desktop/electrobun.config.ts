import { readFileSync } from "node:fs";
import type { ElectrobunConfig } from "electrobun";

// Read version from root package.json. Resolved from this file, not the cwd:
// Hutch loads this config from its own working directory.
const rootPackageJsonUrl = new URL("../../package.json", import.meta.url);
const packageJson = JSON.parse(readFileSync(rootPackageJsonUrl, "utf-8")) as { version: string };

export const config = {
  app: {
    name: "Giggle Photos",
    identifier: "dev.giggle-photos.app",
    version: packageJson.version,
  },
  build: {
    // Electrobun 2.x requires the main-process runtime to be explicit.
    mainProcess: "bun",
    // See: https://docs.electrobun.dev/electrobun/guides/cross-platform-development/
    mac: {
      bundleCEF: true,
      icons: "icon.iconset",
    },
    win: {
      bundleCEF: true,
      icon: "app-icon.png",
    },
    linux: {
      bundleCEF: true,
      icon: "app-icon.png",
    },
    bun: {
      entrypoint: "src/bun/index.ts",
      // Native modules must be external - they can't be bundled
      external: ["sharp", "sharp-phash"],
    },
    views: {
      mainview: {
        entrypoint: "src/views/mainview.ts",
        external: [],
      },
    },
    copy: {
      "src/views/index.html": "views/mainview/index.html",
      "src/views/styles.css": "views/mainview/styles.css",
      // Desktop package.json for About (version + electrobun dependency) at runtime
      "package.json": "bun/package.json",
      // Sharp worker runs in a child process to isolate GLib from Chromium
      "../../packages/core/src/scan/sharp-worker.ts": "bun/sharp-worker.ts",
    },
  },
  release: {
    baseUrl: process.env.RELEASE_BASE_URL || "https://github.com/kingmesal/giggle-photos/releases/latest/download",
  },
} satisfies ElectrobunConfig;

// Default export required by Electrobun build system
export default config;
