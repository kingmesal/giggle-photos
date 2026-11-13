/** Dates the XMP tool fills in from file and folder names (files with no date of their own). */
import { type ReactNode, useState } from "react";
import type { GuessedDate } from "../../services/library-tools-service";

const PRECISION: Record<GuessedDate["precision"], string> = {
  second: "to the second",
  day: "day (noon)",
  month: "month (15th)",
  year: "year (July 1)",
};

export function GuessedDates({ guessed, total }: { guessed: GuessedDate[]; total: number }): ReactNode {
  const [open, setOpen] = useState(false);
  if (total === 0) return null;
  return (
    <div>
      <button type="button" className="text-xs underline text-accent-blue" onClick={() => setOpen(!open)}>
        {open ? "Hide guessed dates" : `Show the ${total.toLocaleString()} guessed dates`}
      </button>
      {open && (
        <div className="mt-2 max-h-72 overflow-y-auto">
          {total > guessed.length && <p className="text-xs text-fg-faint mb-1">{`First ${guessed.length} shown.`}</p>}
          <table className="w-full text-xs" data-testid="guessed-dates">
            <tbody>
              {guessed.map((g) => (
                <tr key={g.fileId} className="border-t border-edge">
                  <td className="py-1 pr-2 font-mono text-fg-3 truncate max-w-xs" title={g.path}>
                    {g.path.split(/[\\/]/).slice(-2).join("/")}
                  </td>
                  <td className="py-1 pr-2 font-mono whitespace-nowrap">{g.takenAt.slice(0, 16).replace("T", " ")}</td>
                  <td className="py-1 text-fg-muted" title={g.detail}>
                    {`${g.source === "filename" ? "name" : "folder"} · ${PRECISION[g.precision]}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
