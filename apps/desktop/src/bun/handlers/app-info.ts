import { getLogger } from "@giggle-photos/core/logging/logger";
import type { AppInfo } from "../app-info";
import { getAppInfoData } from "../app-info";

const log = getLogger("rpc:app-info");

export async function getAppInfo(): Promise<AppInfo> {
  log.debug("getAppInfo called");
  return getAppInfoData();
}
