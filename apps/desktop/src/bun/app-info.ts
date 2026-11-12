import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getLogger } from "@giggle-photos/core/logging/logger";

const log = getLogger("desktop:app-info");

export type AppInfo = {
  appVersion: string;
  bunVersion: string;
  electrobunVersion: string;
  platform: string;
  arch: string;
};

let cachedAppVersion = "Unknown";
let cachedElectrobunVersion = "N/A";

export function loadVersionsFromPackageJson(): void {
  const baseDir = import.meta.dir;
  const candidates = [
    join(baseDir, "package.json"), // Built app: electrobun copies package.json → bun/package.json
    join(baseDir, "../../package.json"), // Dev: apps/desktop/src/bun → apps/desktop/package.json
  ];
  for (const packageJsonPath of candidates) {
    try {
      if (existsSync(packageJsonPath)) {
        const pkg = JSON.parse(readFileSync(packageJsonPath, "utf-8")) as {
          version?: string;
          dependencies?: Record<string, string>;
        };
        if (pkg.version) cachedAppVersion = pkg.version;
        if (pkg.dependencies?.electrobun) cachedElectrobunVersion = pkg.dependencies.electrobun;
        log.debug("Loaded versions from package.json", {
          path: packageJsonPath,
          appVersion: cachedAppVersion,
          electrobunVersion: cachedElectrobunVersion,
        });
        return;
      }
    } catch {
      // try next path
    }
  }
}

export function getAppInfoData(): AppInfo {
  return {
    appVersion: cachedAppVersion,
    bunVersion: Bun.version,
    electrobunVersion: cachedElectrobunVersion,
    platform: process.platform,
    arch: process.arch,
  };
}
