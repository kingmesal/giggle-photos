/** Confirm before writing capture-date sidecars (.xmp) next to the files. */
import { CalendarClock } from "lucide-react";
import type { ReactNode } from "react";
import { Dialog, DialogHeader } from "../results/Dialog";

export function ApplyDatesDialog({
  count,
  onCancel,
  onConfirm,
}: {
  count: number;
  onCancel: () => void;
  onConfirm: () => void;
}): ReactNode {
  return (
    <Dialog onClose={onCancel}>
      <DialogHeader
        icon={<CalendarClock size="1em" />}
        iconClass="bg-amber-500/20 text-accent-amber"
        title="Write capture dates?"
        subtitle={`${count.toLocaleString()} sidecar files will be written`}
        className="p-6 pb-4"
      />
      <div className="px-6 pb-4 space-y-2 text-sm text-fg-3">
        <p>
          Each date goes into a small XMP sidecar next to the file (for example <code>IMG_1.jpg.xmp</code>). Your
          original files are not changed.
        </p>
        <p>Immich, Lightroom and digiKam read these sidecars. A sidecar another app already wrote is left alone.</p>
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
          Write Dates
        </button>
      </div>
    </Dialog>
  );
}
