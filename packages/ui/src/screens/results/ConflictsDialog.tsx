/** Files with both keep and delete decisions in different groups: resolve each as keep or delete everywhere. */
import { Check, CircleCheck, File, LoaderCircle, Trash2, TriangleAlert } from "lucide-react";
import { type ReactNode, useState } from "react";
import { useRead } from "../../external/use-read";
import { reviewService } from "../../services/processing";
import { resolveConflict } from "./apply-actions";
import { Dialog, DialogHeader } from "./Dialog";
import { closeDialog } from "./review-store";

type Conflict = Awaited<ReturnType<typeof reviewService.getConflicts>>["conflicts"][number];

const shortKey = (key: string): string => (key.length > 20 ? `${key.slice(0, 20)}...` : key);

function ConflictRow({ conflict, onResolve }: { conflict: Conflict; onResolve: (a: "keep" | "delete") => void }) {
  return (
    <div className="bg-surface-inset rounded-lg border border-edge p-4">
      <div className="flex items-center gap-2 mb-3">
        <File size="1em" className="text-fg-muted" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-fg truncate">{conflict.fileName}</p>
          <p className="text-xs text-fg-faint truncate">{conflict.filePath}</p>
        </div>
      </div>
      <div className="flex items-center gap-2 mb-3 text-xs text-fg-muted flex-wrap">
        {conflict.decisions.map((d) => (
          <span
            key={`${d.reviewGroupKey}:${d.action}`}
            className={`px-2 py-0.5 rounded-full ${
              d.action === "keep" ? "bg-emerald-500/20 text-accent-green" : "bg-red-500/20 text-accent-red"
            }`}
          >
            {`${d.action} in ${shortKey(d.reviewGroupKey)}`}
          </span>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="px-3 py-1.5 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 text-accent-green text-sm font-medium border border-emerald-500/30 flex items-center gap-2"
          onClick={() => onResolve("keep")}
        >
          <Check size="1em" />
          Keep Everywhere
        </button>
        <button
          type="button"
          className="px-3 py-1.5 rounded-lg bg-red-600/20 hover:bg-red-600/30 text-accent-red text-sm font-medium border border-red-500/30 flex items-center gap-2"
          onClick={() => onResolve("delete")}
        >
          <Trash2 size="1em" />
          Delete Everywhere
        </button>
      </div>
    </div>
  );
}

export function ConflictsDialog(): ReactNode {
  const read = useRead("review-conflicts", () => reviewService.getConflicts());
  const [resolved, setResolved] = useState<ReadonlySet<number>>(new Set());
  const conflicts = (read.value?.conflicts ?? []).filter((c) => !resolved.has(c.mediaFileId));

  async function handleResolve(mediaFileId: number, action: "keep" | "delete"): Promise<void> {
    if (!(await resolveConflict(mediaFileId, action))) return;
    setResolved((prev) => new Set(prev).add(mediaFileId));
    if (conflicts.every((c) => c.mediaFileId === mediaFileId)) closeDialog();
  }

  let body: ReactNode;
  if (read.loading) {
    body = (
      <div className="flex items-center justify-center py-8 text-fg-muted">
        <LoaderCircle size="1em" className="animate-spin text-xl mr-3" />
        Loading conflicts...
      </div>
    );
  } else if (read.failure) {
    body = <div className="flex items-center justify-center py-8 text-accent-red">{read.failure.message}</div>;
  } else if (conflicts.length === 0) {
    body = (
      <div className="flex items-center justify-center py-8 text-fg-muted">
        <CircleCheck size="1em" className="text-accent-green text-xl mr-3" />
        No conflicts remaining!
      </div>
    );
  } else {
    body = (
      <div className="space-y-3">
        {conflicts.map((c) => (
          <ConflictRow key={c.mediaFileId} conflict={c} onResolve={(a) => void handleResolve(c.mediaFileId, a)} />
        ))}
      </div>
    );
  }

  return (
    <Dialog onClose={closeDialog} cardClass="max-w-2xl w-full max-h-[80vh] flex flex-col">
      <DialogHeader
        className="flex-shrink-0"
        icon={<TriangleAlert size="1em" />}
        iconClass="bg-amber-500/20 text-accent-amber"
        title="Resolve Conflicts"
        subtitle="These files have both 'keep' and 'delete' decisions in different groups"
      />
      <div className="flex-1 overflow-auto px-6 py-4">{body}</div>
      <div className="px-6 py-4 border-t border-edge flex-shrink-0 flex justify-end">
        <button
          type="button"
          className="px-4 py-2 rounded-lg bg-surface-inset hover:bg-surface-active text-fg-3 text-sm font-medium"
          onClick={closeDialog}
        >
          Close
        </button>
      </div>
    </Dialog>
  );
}
