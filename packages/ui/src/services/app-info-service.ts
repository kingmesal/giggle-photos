/**
 * App info service for retrieving application information
 * Works both in dev preview (fallback values) and Electrobun (RPC)
 */

import { getLogger } from "./logger-service";

const log = getLogger("ui:app-info");

/** App info shape */
export interface AppInfo {
  appVersion: string;
  bunVersion: string;
  electrobunVersion: string;
  platform: string;
  arch: string;
}

/** RPC client interface for app info operations */
export interface AppInfoRPC {
  getAppInfo: () => Promise<AppInfo>;
}

// Module-level RPC client reference
let rpcClient: AppInfoRPC | null = null;

/** Default/fallback app info for dev preview */
const defaultAppInfo: AppInfo = {
  appVersion: "0.1.0",
  bunVersion: "dev preview",
  electrobunVersion: "N/A",
  platform: "browser",
  arch: "N/A",
};

/**
 * Initialize the app info service with an RPC client
 * Call this from mainview.ts when RPC is available
 */
export function initAppInfoService(rpc: AppInfoRPC): void {
  rpcClient = rpc;
  log.debug("App info service initialized with RPC");
}

/**
 * Check if RPC is available
 */
export function hasAppInfoRPC(): boolean {
  return rpcClient !== null;
}

/**
 * Get application info
 * Uses RPC if available, otherwise returns fallback values
 */
export async function getAppInfo(): Promise<AppInfo> {
  if (rpcClient) {
    try {
      const info = await rpcClient.getAppInfo();
      log.debug("App info loaded via RPC", info);
      return info;
    } catch (error) {
      log.error("Failed to load app info via RPC", error);
      return defaultAppInfo;
    }
  }

  log.debug("Using fallback app info (dev preview)");
  return defaultAppInfo;
}

/**
 * Get default app info (for synchronous access)
 */
export function getDefaultAppInfo(): AppInfo {
  return { ...defaultAppInfo };
}
