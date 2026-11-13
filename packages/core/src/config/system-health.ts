/**
 * System health checks for required external dependencies
 */

import { getLogger } from "../logging/logger";
import { findTool, resetToolCache } from "../util/find-tool";

const log = getLogger("core:system-health");

/**
 * System health status
 */
export interface SystemHealth {
  ffprobe: {
    available: boolean;
    path: string | null;
  };
  platform: "win32" | "darwin" | "linux" | string;
}

// Cached ffprobe check result
let ffprobeChecked = false;
let ffprobeResult: { available: boolean; path: string | null } = {
  available: false,
  path: null,
};

/**
 * Check if ffprobe is available on the system.
 * Results are cached after first check.
 *
 * @returns Object with available flag and path if found
 */
export async function checkFfprobeAvailable(): Promise<{ available: boolean; path: string | null }> {
  if (ffprobeChecked) {
    return ffprobeResult;
  }

  ffprobeChecked = true;
  // PATH, then the usual install folders: apps started from a menu or Finder get a minimal PATH.
  const path = findTool("ffprobe");
  if (path) {
    log.debug(`ffprobe found at: ${path}`);
    ffprobeResult = { available: true, path };
  } else {
    ffprobeResult = { available: false, path: null };
    log.warn("ffprobe not found - video processing will not be available", { PATH: process.env.PATH });
  }
  return ffprobeResult;
}

/**
 * Get complete system health status.
 * Checks all required external dependencies.
 *
 * @returns SystemHealth object with status of all dependencies
 */
export async function getSystemHealth(): Promise<SystemHealth> {
  const ffprobe = await checkFfprobeAvailable();

  return {
    ffprobe,
    platform: process.platform,
  };
}

/**
 * Reset cached health check results.
 * Useful for testing or after user installs dependencies.
 */
export function resetHealthCache(): void {
  ffprobeChecked = false;
  ffprobeResult = { available: false, path: null };
  resetToolCache();
}
