import { getSystemHealth as getSystemHealthCore, type SystemHealth } from "@giggle-photos/core/config/system-health";
import { getLogger } from "@giggle-photos/core/logging/logger";

const log = getLogger("rpc:system-health");

/**
 * RPC handler to get system health status
 */
export async function getSystemHealth(): Promise<SystemHealth> {
  log.debug("getSystemHealth called");
  return getSystemHealthCore();
}
