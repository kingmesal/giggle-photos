/**
 * Update status in the sidebar: while a new version downloads in the background, a card with its
 * progress, so it is clear the update is coming; when it is ready, "Restart to update".
 * Nothing is shown while checking, when up to date, or without RPC.
 */
import { CircleAlert, Download, LoaderCircle, RefreshCw } from "lucide-react";
import { type ReactNode, useState } from "react";
import { useAction } from "../external/use-action";
import { useInterval } from "../external/use-interval";
import { useRead } from "../external/use-read";
import {
  isInProgress,
  loadUpdateState,
  restartToUpdate,
  retryUpdate,
  type UpdateState,
} from "../services/update-service";

const mb = (bytes?: number) => (bytes === undefined ? "?" : `${Math.round(bytes / 1048576)} MB`);
const CARD = "mx-3 mb-2 p-3 rounded-lg border text-xs";

export function UpdateStatus(): ReactNode {
  const first = useRead("update-state", () => loadUpdateState());
  const [polled, setPolled] = useState<UpdateState | null>(null);
  const state = polled ?? first.value ?? null;
  useInterval(async () => setPolled(await loadUpdateState()), isInProgress(state) ? 1000 : null);
  const restart = useAction(async () => setPolled(await restartToUpdate()));
  const retry = useAction(async () => setPolled(await retryUpdate()));
  if (!state) return null;

  if (state.phase === "downloading") {
    const pct = Math.max(0, Math.min(100, state.progress ?? 0));
    return (
      <div className={`${CARD} border-blue-500/30 bg-blue-500/10`} role="status" data-testid="update-downloading">
        <p className="font-medium text-fg-2 flex items-center gap-1.5">
          <Download size={14} className="text-accent-blue" />
          {`Downloading version ${state.version ?? "update"}`}
        </p>
        <div
          className="mt-2 h-1.5 rounded bg-zinc-300 dark:bg-zinc-700"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div className="h-1.5 rounded bg-blue-500" style={{ width: `${pct}%` }} />
        </div>
        <p className="mt-1 text-fg-muted">
          {state.totalBytes ? `${pct}% · ${mb(state.bytesDownloaded)} of ${mb(state.totalBytes)}` : `${pct}%`}
        </p>
        <p className="mt-1 text-fg-faint">Keep working; you can restart into it when it is ready.</p>
      </div>
    );
  }
  if (state.phase === "ready" || state.phase === "applying") {
    return (
      <div className={`${CARD} border-emerald-500/40 bg-emerald-500/10`} role="status" data-testid="update-ready">
        <p className="font-medium text-fg-2">{`Version ${state.version ?? ""} is ready`}</p>
        <button
          type="button"
          className="mt-2 w-full px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white font-medium flex items-center justify-center gap-1.5"
          disabled={state.phase === "applying" || restart.pending}
          onClick={() => void restart.run()}
        >
          {state.phase === "applying" ? <LoaderCircle size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          {state.phase === "applying" ? "Restarting…" : "Restart to update"}
        </button>
      </div>
    );
  }
  if (state.phase === "error") {
    return (
      <div className={`${CARD} border-amber-500/30 bg-amber-500/5 text-fg-muted`} data-testid="update-error">
        <p className="flex items-center gap-1.5" title={state.message}>
          <CircleAlert size={14} className="text-accent-amber" /> Couldn't check for updates
        </p>
        <button
          type="button"
          className="mt-1 underline text-accent-blue"
          disabled={retry.pending}
          onClick={() => void retry.run()}
        >
          Try again
        </button>
      </div>
    );
  }
  return null;
}
