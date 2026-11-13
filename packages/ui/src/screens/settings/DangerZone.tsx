/**
 * Reset Application: the button row and its confirmation dialog (shown inside the Database section).
 */
import { CircleAlert, CircleCheck, LoaderCircle, Trash2, TriangleAlert } from "lucide-react";
import { type ReactNode, useRef, useState } from "react";
import { useAction } from "../../external/use-action";
import { getLogger } from "../../services/logger-service";
import { DIALOG_BUTTON, DialogHeader, DialogShell, SettingsRow } from "./controls";

const log = getLogger("ui:settings-view");

type ResetStatus = "idle" | "clearing" | "success" | "error";

/** How long the success message stays before the dialog closes itself. */
const CLOSE_AFTER_SUCCESS_MS = 1500;

function DialogBody({ status }: { status: ResetStatus }): ReactNode {
  if (status === "clearing") {
    return (
      <div className="flex items-center gap-3 text-fg-3">
        <LoaderCircle size={16} className="animate-spin" />
        <span>Resetting application...</span>
      </div>
    );
  }
  if (status === "success") {
    return (
      <div className="flex items-center gap-3 text-accent-green">
        <CircleCheck size={16} />
        <span>Application reset successfully!</span>
      </div>
    );
  }
  if (status === "error") {
    return (
      <div className="flex items-center gap-3 text-accent-red">
        <CircleAlert size={16} />
        <span>Failed to reset application. Please check the console for details.</span>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <p className="text-fg-3">
        Are you sure you want to reset the application? This will remove all data and start fresh.
      </p>
      <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3">
        <p className="text-sm text-accent-red font-medium mb-1">This will permanently delete:</p>
        <ul className="text-sm text-red-400/80 space-y-1 list-disc list-inside">
          <li>All indexed scan folders and file data</li>
          <li>All duplicate detection results and review decisions</li>
          <li>Cached video thumbnails</li>
          <li>Application log files</li>
        </ul>
      </div>
      <p className="text-sm text-fg-muted">Your preferences (theme, window size, settings) will be preserved.</p>
    </div>
  );
}

/**
 * `reset` performs the reset and resolves true on success; `onReset` runs after a successful reset
 * (refresh what the screen shows).
 */
export function ResetApplication({
  reset,
  onReset,
}: {
  reset: () => Promise<boolean>;
  onReset: () => void;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<ResetStatus>("idle");
  // Each open/close bumps the round, so a stale auto-close timer cannot close a newer dialog.
  const round = useRef(0);

  const close = () => {
    round.current += 1;
    setOpen(false);
    setStatus("idle");
  };

  const action = useAction(async () => {
    try {
      return await reset();
    } catch (error) {
      log.error("Failed to reset application", error);
      return false;
    }
  });

  const confirm = async () => {
    const mine = round.current;
    setStatus("clearing");
    const ok = await action.run();
    if (mine !== round.current) return;
    if (!ok) return setStatus("error");
    onReset();
    setStatus("success");
    setTimeout(() => {
      if (mine === round.current) close();
    }, CLOSE_AFTER_SUCCESS_MS);
  };

  return (
    <>
      <SettingsRow
        label="Reset Application"
        description="Reset all data, thumbnails, and logs"
        control={
          <button
            type="button"
            className="px-3 py-1.5 rounded-lg bg-red-600/20 hover:bg-red-600/30 text-accent-red text-sm border border-red-500/30 transition-colors flex items-center gap-2"
            onClick={() => {
              round.current += 1;
              setStatus("idle");
              setOpen(true);
            }}
          >
            <Trash2 size={14} />
            Reset Application
          </button>
        }
      />
      {open && (
        <DialogShell maxWidth="max-w-md" onBackdrop={status === "idle" ? close : undefined}>
          <DialogHeader
            icon={<TriangleAlert size={20} />}
            iconColor="bg-red-500/20 text-accent-red"
            title="Reset Application"
            subtitle="This action cannot be undone"
          />
          <div className="px-6 py-4">
            <DialogBody status={status} />
          </div>
          <div className="px-6 py-4 border-t border-edge flex items-center justify-end gap-3">
            {status === "idle" ? (
              <>
                <button type="button" className={DIALOG_BUTTON} onClick={close}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white text-sm font-medium transition-colors flex items-center gap-2"
                  onClick={confirm}
                >
                  <Trash2 size={14} />
                  Reset Application
                </button>
              </>
            ) : (
              <button type="button" className={DIALOG_BUTTON} onClick={close}>
                Close
              </button>
            )}
          </div>
        </DialogShell>
      )}
    </>
  );
}
