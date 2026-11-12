/**
 * Database service for loading database information
 * Works both in dev preview (fallback values) and Electrobun (RPC)
 */

import { getLogger } from "./logger-service";

const log = getLogger("ui:database");

/** Database info shape */
export interface DatabaseInfo {
  path: string;
  size: number; // Size in bytes
  sizeFormatted: string; // Human-readable size (e.g., "24.7 MB")
}

/** RPC client interface for database operations */
export interface DatabaseRPC {
  getDatabaseInfo: () => Promise<DatabaseInfo>;
  openDatabaseFolder: () => Promise<{ success: boolean }>;
  resetApplication: () => Promise<{ success: boolean }>;
}

// Module-level RPC client reference
let rpcClient: DatabaseRPC | null = null;

/**
 * Initialize the database service with an RPC client
 * Call this from mainview.ts when RPC is available
 */
export function initDatabaseService(rpc: DatabaseRPC): void {
  rpcClient = rpc;
  log.debug("Database service initialized with RPC");
}

/**
 * Check if RPC is available
 */
export function hasRPC(): boolean {
  return rpcClient !== null;
}

/**
 * Get database information (path and size)
 * Uses RPC if available, otherwise falls back to default values
 */
export async function getDatabaseInfo(): Promise<DatabaseInfo> {
  if (rpcClient) {
    try {
      const info = await rpcClient.getDatabaseInfo();
      log.debug("Database info loaded via RPC", info);
      return info;
    } catch (error) {
      log.error("Failed to load database info via RPC", error);
      return {
        path: "~/.local/share/giggle-photos/app.db",
        size: 0,
        sizeFormatted: "0 B",
      };
    }
  }

  // Fallback for dev preview
  return {
    path: "~/.local/share/giggle-photos/app.db",
    size: 0,
    sizeFormatted: "0 B",
  };
}

/**
 * Open the database folder in the file explorer
 * Uses RPC if available
 */
export async function openDatabaseFolder(): Promise<boolean> {
  if (rpcClient) {
    try {
      const result = await rpcClient.openDatabaseFolder();
      log.debug("Open database folder via RPC", result);
      return result.success;
    } catch (error) {
      log.error("Failed to open database folder via RPC", error);
      return false;
    }
  }

  // Fallback for dev preview
  log.debug("Open database folder (dev preview - not implemented)");
  return false;
}

/**
 * Reset the application (database, thumbnails, logs)
 * Uses RPC if available
 */
export async function resetApplication(): Promise<boolean> {
  if (rpcClient) {
    try {
      const result = await rpcClient.resetApplication();
      log.debug("Reset application via RPC", result);
      return result.success;
    } catch (error) {
      log.error("Failed to reset application via RPC", error);
      return false;
    }
  }

  // Fallback for dev preview
  log.debug("Reset application (dev preview - not implemented)");
  return false;
}
