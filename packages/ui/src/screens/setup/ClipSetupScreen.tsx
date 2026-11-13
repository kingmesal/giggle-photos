/**
 * First-run setup screen (RFD-002, RFD-004): shown over the app while the visual similarity (CLIP)
 * model downloads, is checked, or fails. The download is automatic; the person can continue in the
 * background at any time (the processing screen keeps a banner), retry, or import a downloaded file.
 */
import { CircleAlert, CircleCheck, Download, LoaderCircle, ScanEye } from "lucide-react";
import type { ReactNode } from "react";
import { useAction } from "../../external/use-action";
import {
  type ClipModelStatus,
  dismissClipSetup,
  importClipModelFile,
  retryClipModelSetup,
  showClipSetup,
  useClipSetup,
} from "../../services/clip-service";

const mb = (bytes: number): string => `${Math.round(bytes / 1048576)} MB`;
const SOURCE = "huggingface.co/immich-app/ViT-B-32__openai (pinned revision, SHA-256 verified)";
const BUTTON = "px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2";

function Progress({ status }: { status: ClipModelStatus }): ReactNode {
  if (status.state === "downloading") {
    const pct = status.totalBytes > 0 ? Math.round((status.receivedBytes / status.totalBytes) * 100) : 0;
    return (
      <div>
        <div className="flex justify-between text-sm text-fg-2">
          <span>{`Downloading ${status.file}`}</span>
          <span className="font-mono">{`${mb(status.receivedBytes)} / ${mb(status.totalBytes)}`}</span>
        </div>
        <div
          className="mt-2 h-2 rounded bg-zinc-300 dark:bg-zinc-700"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div className="h-2 rounded bg-blue-500" style={{ width: `${pct}%` }} />
        </div>
      </div>
    );
  }
  if (status.state === "ready") {
    return (
      <p className="text-sm text-accent-green flex items-center gap-2">
        <CircleCheck size="1em" /> Model ready. Visual matching runs in the next processing pass.
      </p>
    );
  }
  if (status.state === "error") {
    return (
      <div className="text-sm">
        <p className="text-accent-amber flex items-center gap-2">
          <CircleAlert size="1em" /> The model could not be downloaded. Everything else still works.
        </p>
        <p className="mt-1 text-xs font-mono text-fg-muted break-all">{status.message}</p>
      </div>
    );
  }
  return (
    <p className="text-sm text-fg-2 flex items-center gap-2">
      <LoaderCircle size="1em" className="animate-spin" /> Checking the model…
    </p>
  );
}

export function ClipSetupScreen(): ReactNode {
  const setup = useClipSetup();
  const retry = useAction(retryClipModelSetup);
  const importFile = useAction(importClipModelFile);
  const { status } = setup;
  if (!showClipSetup(setup) || !status) return null;
  const failed = status.state === "error";
  const ready = status.state === "ready";
  const problem = setup.importError ?? retry.failure?.message ?? importFile.failure?.message;
  return (
    <div className="fixed inset-0 z-40 bg-surface/95 backdrop-blur-sm flex items-center justify-center p-4">
      <section
        aria-labelledby="clip-setup-title"
        className="max-w-lg w-full bg-surface-card rounded-xl border border-edge shadow-2xl p-6 space-y-4"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-teal-500/20 text-teal-400 flex items-center justify-center">
            <ScanEye size={20} />
          </div>
          <div>
            <h2 id="clip-setup-title" className="text-lg font-semibold text-fg">
              Setting up visual similarity
            </h2>
            <p className="text-xs text-fg-muted">One-time download, about 335 MB</p>
          </div>
        </div>
        <p className="text-sm text-fg-3">
          Giggle Photos uses a CLIP model to find edited copies and near-identical shots that hashes miss. It runs
          entirely on this computer; only the model file is downloaded.
        </p>
        <p className="text-xs text-fg-faint break-all">{`Source: ${SOURCE}`}</p>
        <Progress status={status} />
        {problem && <p className="text-xs text-accent-amber">{problem}</p>}
        <div className="flex flex-wrap justify-end gap-3 pt-2">
          {!ready && (
            <button
              type="button"
              className={`${BUTTON} bg-surface-inset hover:bg-surface-active text-fg-2`}
              disabled={importFile.pending}
              onClick={() => void importFile.run()}
            >
              Import model file…
            </button>
          )}
          {failed && (
            <button
              type="button"
              className={`${BUTTON} bg-surface-inset hover:bg-surface-active text-fg-2`}
              disabled={retry.pending}
              onClick={() => void retry.run()}
            >
              <Download size="1em" /> Retry download
            </button>
          )}
          <button
            type="button"
            className={`${BUTTON} bg-blue-600 hover:bg-blue-500 text-white`}
            onClick={dismissClipSetup}
          >
            {ready ? "Get started" : failed ? "Continue without it" : "Continue in background"}
          </button>
        </div>
      </section>
    </div>
  );
}
