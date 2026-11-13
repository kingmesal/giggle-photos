/**
 * Capture Dates screen (RFD-006): photos and videos with no capture date, the date each would get
 * (Google JSON, then file name, then dated folder), and a confirmed, background write of those
 * dates into the files.
 */
import { CalendarClock, CircleCheck, Copy, LoaderCircle, Lock } from "lucide-react";
import { type ReactNode, useState } from "react";
import { useAction } from "../../external/use-action";
import { useInterval } from "../../external/use-interval";
import { useRead } from "../../external/use-read";
import {
  type CaptureDateJob,
  getCaptureDateJob,
  loadCaptureDateReport,
  startCaptureDates,
} from "../../services/capture-dates-service";
import { navigateTo } from "../../state/navigation";
import { notifyReviewDataChanged } from "../../state/review-events";
import { ApplyDatesDialog } from "./ApplyDatesDialog";
import { ProposalTable, precisionLabel, sourceLabel } from "./ProposalTable";

function Counts({
  title,
  counts,
  label,
}: {
  title: string;
  counts: Record<string, number>;
  label: (k: string) => string;
}) {
  return (
    <div className="bg-surface-card rounded-lg border border-edge p-4">
      <p className="text-xs text-fg-muted mb-2">{title}</p>
      {Object.keys(counts).length === 0 ? (
        <p className="text-sm text-fg-faint">—</p>
      ) : (
        <ul className="space-y-0.5 text-sm">
          {Object.entries(counts).map(([k, n]) => (
            <li key={k} className="flex justify-between gap-4">
              <span className="text-fg-2">{label(k)}</span>
              <span className="font-mono">{n.toLocaleString()}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Shown until duplicate checks are finished: writing dates changes the files' SHA-256. */
function NotYet({ blockers }: { blockers: string[] }): ReactNode {
  return (
    <div className="mb-6 p-4 rounded-lg border border-amber-500/40 bg-amber-500/10 text-sm" data-testid="dates-locked">
      <p className="font-medium flex items-center gap-2">
        <Lock size="1em" /> Final step: finish the duplicate checks first
      </p>
      <p className="mt-1 text-fg-3">
        Dates are written only for the copies you keep, so review and apply the duplicates first.
      </p>
      <ul className="mt-2 list-disc pl-5 text-fg-2">
        {blockers.map((b) => (
          <li key={b}>{b}</li>
        ))}
      </ul>
      <button
        type="button"
        className="mt-3 px-3 py-1.5 rounded text-sm font-medium bg-surface-inset hover:bg-surface-active text-fg-2 flex items-center gap-2"
        onClick={() => navigateTo("duplicates")}
      >
        <Copy size="1em" /> Go to Duplicates
      </button>
    </div>
  );
}

function JobStatus({ job }: { job: CaptureDateJob }): ReactNode {
  if (job.running) {
    const pct = job.total > 0 ? Math.round((job.done / job.total) * 100) : 0;
    return (
      <div className="mb-4 p-3 rounded-lg border border-blue-500/30 bg-blue-500/10 text-sm" role="status">
        <LoaderCircle size="1em" className="inline animate-spin mr-2" />
        {`Writing dates: ${job.done.toLocaleString()} of ${job.total.toLocaleString()} (${pct}%)`}
      </div>
    );
  }
  if (job.error) return <div className="mb-4 p-3 rounded-lg bg-red-500/20 text-accent-red text-sm">{job.error}</div>;
  if (!job.result) return null;
  const { written, failed, errors } = job.result;
  const skipped = job.result.skipped ?? 0;
  return (
    <div className="mb-4 p-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-sm" role="status">
      <p>
        <CircleCheck size="1em" className="inline mr-2 text-accent-green" />
        {`Wrote ${written.toLocaleString()} date sidecars${skipped > 0 ? `; ${skipped} skipped (another app's sidecar is there)` : ""}${failed > 0 ? `; ${failed} failed` : ""}.`}
      </p>
      {errors.length > 0 && (
        <ul className="mt-1 text-xs text-accent-amber font-mono max-h-32 overflow-y-auto">
          {errors.slice(0, 50).map((e) => (
            <li key={e.fileId} className="truncate" title={e.error}>{`${e.path}: ${e.error}`}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function CaptureDatesScreen(): ReactNode {
  const [version, setVersion] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const [job, setJob] = useState<CaptureDateJob | null>(null);
  const report = useRead(`capture-dates:${version}`, () => loadCaptureDateReport());
  const start = useAction(startCaptureDates);
  useInterval(
    async () => {
      const next = await getCaptureDateJob();
      setJob(next);
      if (next && !next.running) {
        setVersion((v) => v + 1);
        notifyReviewDataChanged(); // hashes changed
      }
    },
    job?.running ? 1000 : null,
  );
  const r = report.value;
  const busy = job?.running === true || start.pending;
  const locked = r !== undefined && !r.readiness.ready;
  const disabled = !r || r.total === 0 || busy || locked;
  const onConfirm = async () => {
    setConfirming(false);
    const started = await start.run();
    if (started) setJob(started);
  };
  return (
    <div className="h-full flex flex-col">
      <header className="flex-shrink-0 bg-surface border-b border-edge px-6 py-4 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-fg">Capture Dates</h2>
          <p className="text-sm text-fg-muted mt-0.5">
            Final step after duplicates: photos and videos with no capture date, dated from their Google JSON, file name
            or folder
          </p>
        </div>
        <button
          type="button"
          className={`px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 ${
            disabled
              ? "bg-amber-600/30 text-amber-200 cursor-not-allowed"
              : "bg-amber-600 hover:bg-amber-500 text-white"
          }`}
          disabled={disabled}
          title={locked ? "Finish the duplicate checks first" : undefined}
          onClick={() => setConfirming(true)}
        >
          <CalendarClock size="1em" />
          {`Write Dates (${(r?.total ?? 0).toLocaleString()})`}
        </button>
      </header>
      <div className="flex-1 overflow-auto p-6">
        {locked && r && <NotYet blockers={r.readiness.blockers} />}
        {job && <JobStatus job={job} />}
        {start.failure && <p className="mb-4 text-sm text-accent-red">{start.failure.message}</p>}
        {!r ? (
          <p className="text-sm text-fg-muted">
            <LoaderCircle size="1em" className="inline animate-spin mr-2" />
            Looking for undated files…
          </p>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
              <Counts title="Date from" counts={r.bySource} label={sourceLabel} />
              <Counts title="Precision" counts={r.byPrecision} label={precisionLabel} />
              <div className="bg-surface-card rounded-lg border border-edge p-4">
                <p className="text-xs text-fg-muted mb-2">No date found anywhere</p>
                <p className="text-2xl font-semibold">{r.undatable.toLocaleString()}</p>
                <p className="text-xs text-fg-faint">Left unchanged</p>
              </div>
            </div>
            {r.total === 0 ? (
              <p className="text-sm text-fg-muted">Every photo and video that could be dated already has a date.</p>
            ) : (
              <>
                {r.total > r.proposals.length && (
                  <p className="text-xs text-fg-faint mb-2">{`First ${r.proposals.length} of ${r.total.toLocaleString()} shown; all are written.`}</p>
                )}
                <ProposalTable proposals={r.proposals} />
              </>
            )}
          </>
        )}
      </div>
      {confirming && r && (
        <ApplyDatesDialog count={r.total} onCancel={() => setConfirming(false)} onConfirm={() => void onConfirm()} />
      )}
    </div>
  );
}
