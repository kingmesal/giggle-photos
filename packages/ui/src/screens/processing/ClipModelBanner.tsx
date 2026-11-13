/**
 * First-run CLIP model setup banner (RFD-002): download progress, or the error with Retry and
 * "Import model file…". Nothing is shown until the first status arrives (none without RPC).
 */
import type { ReactNode } from "react";
import { useAction } from "../../external/use-action";
import { importClipModelFile, retryClipModelSetup, useClipSetup } from "../../services/clip-service";

const mb = (bytes: number): string => `${Math.round(bytes / 1048576)} MB`;
const BOX = "mb-4 p-3 rounded-lg border text-sm";

export function ClipModelBanner(): ReactNode {
  const { status, importError } = useClipSetup();
  const retry = useAction(retryClipModelSetup);
  const importFile = useAction(importClipModelFile);
  if (!status) return null;
  if (status.state === "ready") {
    return <div className="mb-3 text-xs text-fg-faint">Visual similarity (CLIP) model ready.</div>;
  }
  if (status.state === "downloading") {
    const pct = status.totalBytes > 0 ? Math.round((status.receivedBytes / status.totalBytes) * 100) : 0;
    return (
      <div className={`${BOX} border-blue-500/30 bg-blue-500/10`}>
        <div>
          {`Downloading the visual similarity model: ${mb(status.receivedBytes)} of ${mb(status.totalBytes)} (${pct}%)`}
        </div>
        <div className="mt-2 h-1.5 rounded bg-zinc-300 dark:bg-zinc-700">
          <div className="h-1.5 rounded bg-blue-500" style={{ width: `${pct}%` }} />
        </div>
        <div className="mt-1 text-xs text-fg-muted">
          You can start processing meanwhile; visual matching runs once the model is ready.
        </div>
      </div>
    );
  }
  if (status.state === "verifying" || status.state === "missing") {
    return <div className={`${BOX} border-blue-500/30 bg-blue-500/10`}>Checking the visual similarity model…</div>;
  }
  const failure = retry.failure ?? importFile.failure;
  return (
    <div className={`${BOX} border-amber-500/40 bg-amber-500/10`}>
      <div>The visual similarity (CLIP) model could not be downloaded. Everything else still works.</div>
      <div className="mt-1 text-xs font-mono text-fg-muted">{status.message}</div>
      {(importError ?? failure) && (
        <div className="mt-1 text-xs text-accent-amber">{importError ?? failure?.message}</div>
      )}
      <div className="mt-2 flex gap-3">
        <button
          type="button"
          className="text-xs underline text-accent-blue"
          disabled={retry.pending}
          onClick={() => void retry.run()}
        >
          Retry download
        </button>
        <button
          type="button"
          className="text-xs underline text-accent-blue"
          disabled={importFile.pending}
          onClick={() => void importFile.run()}
        >
          Import model file…
        </button>
      </div>
    </div>
  );
}
