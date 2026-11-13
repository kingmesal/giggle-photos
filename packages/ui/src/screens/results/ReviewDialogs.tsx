/** Delete-all confirmation (no file kept in a group) and unsaved-changes guard (switching tabs). */
import { ArrowRight, Trash2, TriangleAlert } from "lucide-react";
import { type ReactNode, useState } from "react";
import { CANCEL_BUTTON, Dialog, DialogHeader } from "./Dialog";
import { confirmDeleteAll, confirmUnsavedChanges } from "./review-actions";
import { closeDialog } from "./review-store";

const AMBER_BUTTON = "px-4 py-2 rounded-lg text-sm font-medium bg-amber-600 hover:bg-amber-500 text-white";

export function DeleteAllDialog(): ReactNode {
  const [remember, setRemember] = useState(false);
  return (
    <Dialog onClose={closeDialog}>
      <DialogHeader
        icon={<TriangleAlert size="1em" />}
        iconClass="bg-amber-500/20 text-amber-700 dark:text-amber-400"
        title="Delete All Files?"
        subtitle="No file will be kept in this group"
      />
      <div className="px-6 py-4">
        <p className="text-sm text-fg-3">All files in this group will be marked for deletion. No file will be kept.</p>
        <label className="flex items-center gap-2 mt-4 cursor-pointer select-none">
          <input
            type="checkbox"
            className="w-4 h-4 rounded border-edge accent-amber-500"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
          />
          <span className="text-sm text-fg-muted">Don't ask again for future groups</span>
        </label>
      </div>
      <div className="px-6 py-4 border-t border-edge flex justify-end gap-3">
        <button type="button" className={CANCEL_BUTTON} onClick={closeDialog}>
          Cancel
        </button>
        <button
          type="button"
          className={`${AMBER_BUTTON} flex items-center`}
          onClick={() => confirmDeleteAll(remember)}
        >
          <Trash2 size="1em" className="mr-2" />
          Delete All
        </button>
      </div>
    </Dialog>
  );
}

export function UnsavedChangesDialog(): ReactNode {
  return (
    <Dialog onClose={closeDialog} cardClass="max-w-md w-full p-6 space-y-4">
      <div className="flex items-center gap-3">
        <TriangleAlert size="1em" className="text-amber-500 text-2xl" />
        <h3 className="text-lg font-semibold text-fg-1">Unsaved Changes</h3>
      </div>
      <p className="text-sm text-fg-3">
        You have unsaved review decisions for the current group. Switching tabs will discard them.
      </p>
      <div className="flex justify-end gap-3 pt-2">
        <button type="button" className={CANCEL_BUTTON} onClick={closeDialog}>
          Stay Here
        </button>
        <button type="button" className={`${AMBER_BUTTON} flex items-center`} onClick={confirmUnsavedChanges}>
          <ArrowRight size="1em" className="mr-2" />
          Discard &amp; Switch
        </button>
      </div>
    </Dialog>
  );
}
