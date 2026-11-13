/** The proposed capture dates: file, date, and where the date came from. */
import type { ReactNode } from "react";
import type { CaptureDateProposal } from "../../services/capture-dates-service";

const SOURCE: Record<CaptureDateProposal["source"], string> = {
  sidecar: "Google JSON",
  filename: "File name",
  folder: "Folder",
};
const PRECISION: Record<CaptureDateProposal["precision"], string> = {
  exact: "exact (UTC)",
  second: "to the second",
  day: "day (noon)",
  month: "month (15th)",
  year: "year (July 1)",
};

export const sourceLabel = (s: string): string => SOURCE[s as CaptureDateProposal["source"]] ?? s;
export const precisionLabel = (p: string): string => PRECISION[p as CaptureDateProposal["precision"]] ?? p;

/** "2019-05-12T14:30:00(.000Z)" → "2019-05-12 14:30" (+ " UTC" for exact instants). */
const shown = (p: CaptureDateProposal) =>
  `${p.takenAt.slice(0, 16).replace("T", " ")}${p.precision === "exact" ? " UTC" : ""}`;

export function ProposalTable({ proposals }: { proposals: CaptureDateProposal[] }): ReactNode {
  return (
    <table className="w-full text-sm" data-testid="capture-date-table">
      <thead>
        <tr className="text-xs text-fg-muted text-left">
          <th className="py-2 font-medium">File</th>
          <th className="py-2 font-medium">Date</th>
          <th className="py-2 font-medium">From</th>
          <th className="py-2 font-medium">Precision</th>
        </tr>
      </thead>
      <tbody>
        {proposals.map((p) => (
          <tr key={p.fileId} className="border-t border-edge">
            <td className="py-1.5 pr-3 font-mono text-xs text-fg-3 truncate max-w-md" title={p.path}>
              {p.path}
            </td>
            <td className="py-1.5 pr-3 font-mono text-xs whitespace-nowrap">{shown(p)}</td>
            <td className="py-1.5 pr-3 text-xs" title={p.detail}>
              {`${sourceLabel(p.source)}${p.source === "sidecar" ? "" : `: ${p.detail}`}`}
            </td>
            <td className="py-1.5 text-xs text-fg-muted whitespace-nowrap">{precisionLabel(p.precision)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
