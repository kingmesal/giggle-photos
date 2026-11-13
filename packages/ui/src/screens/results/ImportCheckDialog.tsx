/**
 * Import check before Immich (RFD-003 §G): paste the report from
 * `immich-go upload from-google-photos --dry-run <Takeout root>` and compare it with the pruned library.
 */
import { CircleAlert, CircleCheck, ClipboardCheck, Info, LoaderCircle } from "lucide-react";
import { type ReactNode, useState } from "react";
import { useAction } from "../../external/use-action";
import { compareImmichGoReport, type ImportCheckRow } from "../../services/takeout-service";
import { Dialog, DialogHeader } from "./Dialog";
import { closeDialog } from "./review-store";

const COMMAND = "immich-go upload from-google-photos --dry-run --server=… --api-key=… <Takeout folder>";
const show = (n: number | null) => (n === null ? "—" : n.toLocaleString());

function StatusIcon({ status }: { status: ImportCheckRow["status"] }): ReactNode {
  if (status === "match") return <CircleCheck size="1em" className="text-accent-green" aria-label="match" />;
  if (status === "differs") return <CircleAlert size="1em" className="text-accent-amber" aria-label="differs" />;
  return <Info size="1em" className="text-fg-faint" aria-label="information" />;
}

function Rows({ rows }: { rows: ImportCheckRow[] }): ReactNode {
  return (
    <table className="w-full text-sm" data-testid="import-check-table">
      <thead>
        <tr className="text-xs text-fg-muted text-left">
          <th className="py-1 font-medium" />
          <th className="py-1 font-medium">Check</th>
          <th className="py-1 font-medium text-right">App</th>
          <th className="py-1 font-medium text-right">immich-go</th>
          <th className="py-1 pl-4 font-medium">Note</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.label} className="border-t border-edge">
            <td className="py-1.5 pr-2">
              <StatusIcon status={r.status} />
            </td>
            <td className="py-1.5 text-fg-2">{r.label}</td>
            <td className="py-1.5 text-right font-mono">{show(r.app)}</td>
            <td className="py-1.5 text-right font-mono">{show(r.immichGo)}</td>
            <td className="py-1.5 pl-4 text-xs text-fg-muted">{r.note}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function ImportCheckDialog(): ReactNode {
  const [report, setReport] = useState("");
  const check = useAction(compareImmichGoReport);
  const result = check.value;
  const parsedNothing = result && report.trim() !== "" && Object.keys(result.events).length === 0;
  return (
    <Dialog onClose={closeDialog} cardClass="max-w-3xl w-full max-h-[90vh] flex flex-col">
      <DialogHeader
        icon={<ClipboardCheck size="1em" />}
        iconClass="bg-blue-500/20 text-accent-blue"
        title="Import Check"
        subtitle="Compare an immich-go dry run with the pruned library before importing"
        className="p-6 pb-4"
      />
      <div className="px-6 pb-4 space-y-3 overflow-y-auto">
        <p className="text-xs text-fg-muted">
          Run this in a terminal, then paste its output (the Event Report at the end is enough):
        </p>
        <code className="block text-xs font-mono bg-surface-inset rounded px-2 py-1.5 text-fg-3 break-all">
          {COMMAND}
        </code>
        <textarea
          aria-label="immich-go report"
          value={report}
          onChange={(e) => setReport(e.target.value)}
          rows={6}
          spellCheck={false}
          placeholder="Event Report: …"
          className="w-full px-3 py-2 rounded-lg bg-surface-inset border border-zinc-300 dark:border-zinc-600 text-xs text-fg-2 font-mono focus:outline-none focus:border-blue-500"
        />
        {check.failure && <p className="text-sm text-accent-red">{check.failure.message}</p>}
        {parsedNothing && (
          <p className="text-sm text-accent-amber">
            No immich-go events found in the pasted text: showing the app only.
          </p>
        )}
        {result && <Rows rows={result.rows} />}
      </div>
      <div className="flex justify-end gap-3 px-6 py-4 border-t border-edge">
        <button
          type="button"
          className="px-4 py-2 rounded-lg text-sm font-medium bg-surface-inset hover:bg-surface-active text-fg-2"
          onClick={closeDialog}
        >
          Close
        </button>
        <button
          type="button"
          className="px-4 py-2 rounded-lg text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white flex items-center gap-2"
          disabled={check.pending}
          onClick={() => void check.run(report)}
        >
          {check.pending && <LoaderCircle size="1em" className="animate-spin" />}
          Compare
        </button>
      </div>
    </Dialog>
  );
}
