import { DatabaseProvider } from "@giggle-photos/core/db/database-provider";
import { getLogger } from "@giggle-photos/core/logging/logger";
import {
  compareImport,
  getLibraryCounts,
  type ImportCheckResult,
  parseImmichGoReport,
} from "@giggle-photos/core/takeout/import-check";
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

/**
 * RPC handler: compare a pasted `immich-go upload from-google-photos --dry-run` report with the
 * pruned library (RFD-003 §G). An empty report returns the app's side alone.
 */
export async function compareImmichGoReport(params: { report: string }): Promise<ImportCheckResult> {
  const db = await DatabaseProvider.getInstance();
  const [counts, summary] = await Promise.all([getLibraryCounts(db), db.getTakeoutProvider().getSummary()]);
  const events = parseImmichGoReport(params.report ?? "");
  log.info("Import check", { events: Object.keys(events).length, ...counts });
  return compareImport(counts, summary, events);
}
