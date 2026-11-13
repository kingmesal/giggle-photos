import { getLogger } from "@giggle-photos/core/logging/logger";
import {
  getTakeoutReport as getTakeoutReportCore,
  type TakeoutReport,
} from "@giggle-photos/core/takeout/takeout-report";

const log = getLogger("rpc:takeout");

/**
 * RPC handler: Google Takeout sidecar/album report with drill-down lists (RFD-003).
 */
export async function getTakeoutReport(): Promise<TakeoutReport> {
  log.debug("getTakeoutReport called");
  return getTakeoutReportCore();
}
