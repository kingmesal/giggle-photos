import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getLogger } from "@giggle-photos/core/logging/logger";
import { Updater } from "electrobun/main";

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

/**
 * The running build's version, from Electrobun's build info: the same version the updater compares
 * (electrobun.config.ts sets it from the root package.json). The desktop package.json's own
 * "version" is not maintained, so it is only a fallback (e.g. when the build info is unavailable).
 */
export async function loadBuildVersion(): Promise<void> {
  try {
    const info = await Updater.getLocalInfo();
    if (info.version) cachedAppVersion = info.version;
    log.debug("Loaded build version", { appVersion: cachedAppVersion, channel: info.channel });
  } catch (error) {
    log.debug("Build info unavailable; keeping the package.json version", { error: String(error) });
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
