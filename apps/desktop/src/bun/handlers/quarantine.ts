import { quarantineStatus, resolveQuarantineRoot, restoreQuarantine } from "@giggle-photos/core/actions/quarantine";
import { getAppSettings } from "@giggle-photos/core/config/user-config";
import { getLogger } from "@giggle-photos/core/logging/logger";

const log = getLogger("rpc:quarantine");

export interface QuarantineStatusResponse {
  root: string;
  enabled: boolean;
  files: number;
  sidecars: number;
}

/** The quarantine folder from settings, even when quarantine is now off (its files can still come back). */
function quarantineRoot(): { root: string; enabled: boolean } {
  const settings = getAppSettings();
  return {
    root: resolveQuarantineRoot({ ...settings, quarantineEnabled: true }) as string,
    enabled: settings.quarantineEnabled,
  };
}

/** RPC: what is in the quarantine folder. */
export async function getQuarantineStatus(): Promise<QuarantineStatusResponse> {
  const { root, enabled } = quarantineRoot();
  return { root, enabled, ...(await quarantineStatus(root)) };
}

/** RPC: move every quarantined file back to where it came from. Never overwrites. */
export async function restoreQuarantinedFiles(): Promise<{ restored: number; problems: string[] }> {
  const { root } = quarantineRoot();
  log.info("Restoring quarantine", { root });
  try {
    const result = await restoreQuarantine(root);
    log.info("Quarantine restored", { root, restored: result.restored, problems: result.problems.length });
    for (const problem of result.problems) log.warn("Quarantine restore problem", { problem });
    return result;
  } catch (error) {
    log.error("Quarantine restore failed", { root, error: error instanceof Error ? error.message : String(error) });
    throw new Error(`Could not restore the quarantine at ${root}`);
  }
}
