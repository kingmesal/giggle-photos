/**
 * Logs service for opening logs folder
 * Works both in dev preview (fallback) and Electrobun (RPC)
 */

import { getLogger } from "./logger-service";

const log = getLogger("ui:logs");

/** RPC client interface for logs operations */
export interface LogsRPC {
  getLogsPath: () => Promise<{ path: string }>;
  selectLogsFolder: () => Promise<{ success: boolean; path: string | null }>;
}

// Module-level RPC client reference
let rpcClient: LogsRPC | null = null;

/**
 * Initialize the logs service with an RPC client
 * Call this from mainview.ts when RPC is available
 */
export function initLogsService(rpc: LogsRPC): void {
  rpcClient = rpc;
  log.debug("Logs service initialized with RPC");
}

/**
 * Check if RPC is available
 */
export function hasRPC(): boolean {
  return rpcClient !== null;
}

/**
 * Get logs directory path
 * Uses RPC if available, otherwise falls back to default value
 */
export async function getLogsPath(): Promise<string> {
  if (rpcClient) {
    try {
      const result = await rpcClient.getLogsPath();
      log.debug("Logs path loaded via RPC", result.path);
      return result.path;
    } catch (error) {
      log.error("Failed to get logs path via RPC", error);
      return "~/.local/share/giggle-photos/logs/";
    }
  }

  // Fallback for dev preview
  return "~/.local/share/giggle-photos/logs/";
}

/**
 * Select a new logs folder location
 * Uses RPC if available
 */
export async function selectLogsFolder(): Promise<string | null> {
  if (rpcClient) {
    const result = await rpcClient.selectLogsFolder();
    return result.path;
  }

  // Fallback for dev preview
  alert("Folder selection is not available in dev preview. Please use the desktop app.");
  return null;
}
