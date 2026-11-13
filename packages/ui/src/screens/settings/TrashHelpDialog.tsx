/**
 * Explains how to install a trash command when none was found.
 */
import { Info } from "lucide-react";
import type { ReactNode } from "react";
import { DIALOG_BUTTON, DialogHeader, DialogShell } from "./controls";

export function TrashHelpDialog({ installHint, onClose }: { installHint: string; onClose: () => void }): ReactNode {
  return (
    <DialogShell maxWidth="max-w-lg" onBackdrop={onClose}>
      <DialogHeader
        icon={<Info size={20} />}
        iconColor="bg-blue-500/20 text-accent-blue"
        title="Enable Trash Support"
        subtitle="Install a trash command to safely move files to trash instead of permanently deleting them"
      />
      <div className="px-6 py-4">
        {installHint ? (
          <pre className="text-sm text-fg-3 bg-surface-inset rounded-lg p-4 whitespace-pre-wrap font-mono leading-relaxed">
            {installHint}
          </pre>
        ) : (
          <p className="text-sm text-fg-3">Trash support is not available on this platform.</p>
        )}
        <p className="text-xs text-fg-faint mt-3">
          After installing, restart the application for the change to take effect.
        </p>
      </div>
      <div className="px-6 py-4 border-t border-edge flex justify-end">
        <button type="button" className={DIALOG_BUTTON} onClick={onClose}>
          Close
        </button>
      </div>
    </DialogShell>
  );
}
