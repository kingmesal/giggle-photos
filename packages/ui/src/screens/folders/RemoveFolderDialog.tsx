/** Confirmation overlay before removing a folder from scanning (files on disk are not touched). */
import { Folder, FolderX, Trash2 } from "lucide-react";
import type { ReactElement } from "react";
import { ICON } from "./format";

export function RemoveFolderDialog({
  path,
  onCancel,
  onConfirm,
}: {
  path: string;
  onCancel: () => void;
  onConfirm: () => void;
}): ReactElement {
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: backdrop click-to-dismiss, as in the old view
    // biome-ignore lint/a11y/useKeyWithClickEvents: Cancel button is the keyboard path
    <div
      className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        className="bg-surface-card rounded-xl border border-edge shadow-2xl max-w-md w-full"
        role="dialog"
        aria-modal="true"
        aria-labelledby="remove-folder-title"
      >
        <div className="px-6 py-4 border-b border-edge">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-red-500/20 text-accent-red flex items-center justify-center">
              <FolderX size="1em" className={`${ICON} text-xl`} />
            </div>
            <div>
              <h3 id="remove-folder-title" className="text-lg font-semibold text-fg">
                Confirm Removal
              </h3>
              <p className="text-sm text-fg-muted mt-0.5">This folder will be removed from scanning</p>
            </div>
          </div>
        </div>
        <div className="px-6 py-4 space-y-3">
          <p className="text-fg-3">Are you sure you want to remove this folder?</p>
          <div className="bg-zinc-50/50 dark:bg-zinc-900/50 border border-edge rounded-lg p-3 flex items-center gap-2">
            <Folder size="1em" className={`${ICON} text-fg-faint flex-shrink-0`} />
            <p className="text-sm text-fg-muted break-all">{path}</p>
          </div>
          <p className="text-sm text-fg-faint">
            Your files will not be deleted. Only the folder reference and its scan data will be removed.
          </p>
        </div>
        <div className="px-6 py-4 border-t border-edge flex items-center justify-end gap-3">
          <button
            type="button"
            className="px-4 py-2 rounded-lg bg-surface-inset hover:bg-surface-active text-fg-3 text-sm font-medium transition-colors"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white text-sm font-medium transition-colors flex items-center gap-2"
            onClick={onConfirm}
          >
            <Trash2 size="1em" className={ICON} />
            Remove Folder
          </button>
        </div>
      </div>
    </div>
  );
}
