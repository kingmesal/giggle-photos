/** Confirm before removing Google JSON files (tool 3). */
import { FileX } from "lucide-react";
import type { ReactNode } from "react";
import { Dialog, DialogHeader } from "../results/Dialog";

const HOW = {
  quarantine: "They move to the quarantine folder and can be restored from Settings → Removal.",
  trash: "They move to the system trash.",
  delete: "They are deleted permanently.",
} as const;

export function RemoveJsonDialog({
  count,
  mode,
  onCancel,
  onConfirm,
}: {
  count: number;
  mode: keyof typeof HOW;
  onCancel: () => void;
  onConfirm: () => void;
}): ReactNode {
  return (
    <Dialog onClose={onCancel}>
      <DialogHeader
        icon={<FileX size="1em" />}
        iconClass="bg-amber-500/20 text-accent-amber"
        title="Remove Google JSON files?"
        subtitle={`${count.toLocaleString()} files`}
        className="p-6 pb-4"
      />
      <div className="px-6 pb-4 space-y-2 text-sm text-fg-3">
        <p className="text-accent-amber">
          immich-go's Google Photos import reads these files. Only remove them after you have imported.
        </p>
        <p className={mode === "delete" ? "text-accent-red" : ""}>{HOW[mode]}</p>
      </div>
      <div className="flex justify-end gap-3 px-6 py-4 border-t border-edge">
        <button
          type="button"
          className="px-4 py-2 rounded-lg text-sm font-medium bg-surface-inset hover:bg-surface-active text-fg-2"
          onClick={onCancel}
        >
          Cancel
        </button>
        <button
          type="button"
          className="px-4 py-2 rounded-lg text-sm font-medium bg-amber-600 hover:bg-amber-500 text-white"
          onClick={onConfirm}
        >
          Remove JSON Files
        </button>
      </div>
    </Dialog>
  );
}
