/**
 * System health service for checking external dependency availability
 * Works both in dev preview (fallback values) and Electrobun (RPC)
 */

import { getLogger } from "./logger-service";

const log = getLogger("ui:system-health");

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

/**
 * RPC client interface for system health operations
 */
export interface SystemHealthRPC {
  getSystemHealth: () => Promise<SystemHealth>;
}

// Module-level RPC client reference
let rpcClient: SystemHealthRPC | null = null;

// Cached system health for synchronous access
let cachedHealth: SystemHealth | null = null;

/** Default/fallback system health for dev preview */
const defaultHealth: SystemHealth = {
  ffprobe: {
    available: true, // Assume available in dev for easier testing
    path: null,
  },
  platform: "browser",
};

/**
 * Initialize the system health service with an RPC client
 * Call this from mainview.ts when RPC is available
 */
export function initSystemHealthService(rpc: SystemHealthRPC): void {
  rpcClient = rpc;
  log.debug("System health service initialized with RPC");
}

/**
 * Check if RPC is available
 */
export function hasSystemHealthRPC(): boolean {
  return rpcClient !== null;
}

/**
 * Get system health status
 * Uses RPC if available, otherwise returns fallback values
 */
export async function getSystemHealth(): Promise<SystemHealth> {
  if (rpcClient) {
    try {
      const health = await rpcClient.getSystemHealth();
      cachedHealth = health;
      log.debug("System health loaded via RPC", health);
      return health;
    } catch (error) {
      log.error("Failed to load system health via RPC", error);
      return defaultHealth;
    }
  }

  log.debug("Using fallback system health (dev preview)");
  return defaultHealth;
}

/**
 * Get cached system health (for synchronous access)
 * Returns null if not yet fetched
 */
export function getCachedSystemHealth(): SystemHealth | null {
  return cachedHealth;
}

/**
 * Get default system health (for synchronous access)
 */
export function getDefaultSystemHealth(): SystemHealth {
  return { ...defaultHealth };
}
