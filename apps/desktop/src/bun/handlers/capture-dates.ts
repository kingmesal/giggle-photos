import { type ApplyCaptureDatesResult, applyCaptureDates } from "@giggle-photos/core/dates/capture-date-writer";
import { type CaptureDateProposal, findCaptureDateProposals } from "@giggle-photos/core/dates/capture-dates";
import { DatabaseProvider } from "@giggle-photos/core/db/database-provider";
import { getLogger } from "@giggle-photos/core/logging/logger";

const log = getLogger("rpc:capture-dates");
const LIST_LIMIT = 500;

export interface CaptureDateReportResponse {
  total: number;
  bySource: Record<string, number>;
  byPrecision: Record<string, number>;
  /** First LIST_LIMIT proposals (the counts cover all of them). */
  proposals: CaptureDateProposal[];
  undatable: number;
  undatableSample: string[];
  listLimit: number;
}

export interface CaptureDateJob {
  running: boolean;
  done: number;
  total: number;
  result: ApplyCaptureDatesResult | null;
  error: string | null;
}

let job: CaptureDateJob = { running: false, done: 0, total: 0, result: null, error: null };

const count = (items: string[]) =>
  items.reduce<Record<string, number>>((acc, k) => {
    acc[k] = (acc[k] ?? 0) + 1;
    return acc;
  }, {});

/** RPC: what would be dated, and from which source (RFD-006). */
export async function getCaptureDateReport(): Promise<CaptureDateReportResponse> {
  const { proposals, undatable } = await findCaptureDateProposals(await DatabaseProvider.getInstance());
  return {
    total: proposals.length,
    bySource: count(proposals.map((p) => p.source)),
    byPrecision: count(proposals.map((p) => p.precision)),
    proposals: proposals.slice(0, LIST_LIMIT),
    undatable: undatable.length,
    undatableSample: undatable.slice(0, 100).map((u) => u.path),
    listLimit: LIST_LIMIT,
  };
}

/** RPC: start writing every proposal into its file; poll getCaptureDateJob for progress. */
export async function startCaptureDates(): Promise<CaptureDateJob> {
  if (job.running) return job;
  job = { running: true, done: 0, total: 0, result: null, error: null };
  void (async () => {
    try {
      const result = await applyCaptureDates(await DatabaseProvider.getInstance(), {
        onProgress: (done, total) => {
          job.done = done;
          job.total = total;
        },
      });
      job = { ...job, running: false, result };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.error("Capture dates failed", { error: message });
      job = { ...job, running: false, error: "Could not write the capture dates; see the log" };
    }
  })();
  return job;
}

/** RPC: progress of the capture-date job. */
export async function getCaptureDateJob(): Promise<CaptureDateJob> {
  return job;
}
