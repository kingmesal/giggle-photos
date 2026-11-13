/** Takeout report for the UI (RFD-003 §C.3): counts plus drill-down lists of what did not link. */
import { DatabaseProvider } from "../db/database-provider";
import type { TakeoutSummary } from "../db/takeout-provider";

export interface TakeoutReport {
  summary: TakeoutSummary;
  unmatchedSidecars: { id: number; path: string; title: string | null }[];
  mediaWithoutSidecar: { id: number; path: string }[];
  /** Lists are capped; the summary has the full counts. */
  listLimit: number;
}

export async function getTakeoutReport(listLimit = 200): Promise<TakeoutReport> {
  const takeout = (await DatabaseProvider.getInstance()).getTakeoutProvider();
  const [summary, unmatchedSidecars, mediaWithoutSidecar] = await Promise.all([
    takeout.getSummary(),
    takeout.listUnmatchedSidecars(listLimit),
    takeout.listMediaWithoutSidecar(listLimit),
  ]);
  return { summary, unmatchedSidecars, mediaWithoutSidecar, listLimit };
}
