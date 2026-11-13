/**
 * Restore from quarantine: shows how many removed files are in the (saved) quarantine folder and moves
 * them all back. Restored files are not in the database any more, so their folders need a re-scan.
 */
import { LoaderCircle, Undo2 } from "lucide-react";
import { type ReactNode, useState } from "react";
import { useAction } from "../../external/use-action";
import { useRead } from "../../external/use-read";
import { loadQuarantineStatus, type RestoreResult, restoreQuarantine } from "../../services/quarantine-service";

const SHOWN_PROBLEMS = 5;

function Outcome({ result }: { result: RestoreResult }): ReactNode {
  const more = result.problems.length - SHOWN_PROBLEMS;
  return (
    <div className="mt-2 text-xs" data-testid="quarantine-restore-result">
      <p className="text-accent-green">
        {`Restored ${result.restored} file${result.restored === 1 ? "" : "s"}.`}
        {result.restored > 0 && " Re-scan their folders to review them again."}
      </p>
      {result.problems.length > 0 && (
        <ul className="mt-1 text-accent-amber space-y-0.5">
          {result.problems.slice(0, SHOWN_PROBLEMS).map((p) => (
            <li key={p} className="font-mono break-all">
              {p}
            </li>
          ))}
          {more > 0 && <li>{`…and ${more} more (see the log)`}</li>}
        </ul>
      )}
    </div>
  );
}

export function QuarantineRestore(): ReactNode {
  const [version, setVersion] = useState(0);
  const status = useRead(`quarantine:${version}`, () => loadQuarantineStatus());
  const restore = useAction(restoreQuarantine);
  const s = status.value;
  if (!s) return null; // dev preview (no RPC) or still loading the first time

  const count = s.files + s.sidecars;
  const onRestore = async () => {
    await restore.run();
    setVersion((v) => v + 1);
  };
  return (
    <div className="rounded-lg bg-surface-inset border border-edge px-3 py-2" data-testid="quarantine-restore">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-fg-2">
            {s.files === 0
              ? "Quarantine is empty"
              : `${s.files} file${s.files === 1 ? "" : "s"} in quarantine${s.sidecars > 0 ? ` (+${s.sidecars} sidecars)` : ""}`}
          </p>
          <p className="text-xs text-fg-faint font-mono truncate" title={s.root}>
            {s.root}
          </p>
        </div>
        <button
          type="button"
          className={`px-3 py-1.5 rounded text-sm font-medium flex items-center gap-1.5 flex-shrink-0 ${
            count === 0 || restore.pending
              ? "bg-zinc-300 dark:bg-zinc-700 text-fg-faint cursor-not-allowed"
              : "bg-amber-600/20 hover:bg-amber-600/30 text-accent-amber border border-amber-500/30"
          }`}
          disabled={count === 0 || restore.pending}
          onClick={() => void onRestore()}
        >
          {restore.pending ? <LoaderCircle size="1em" className="animate-spin" /> : <Undo2 size="1em" />}
          Restore All
        </button>
      </div>
      {restore.value && <Outcome result={restore.value} />}
      {restore.failure && <p className="mt-2 text-xs text-accent-red">{restore.failure.message}</p>}
    </div>
  );
}
