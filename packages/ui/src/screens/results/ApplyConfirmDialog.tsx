/** Apply-deletions confirmation: shows the dry-run plan; confirm stays disabled until it has something to remove. */
import { Trash2, TriangleAlert, Undo2 } from "lucide-react";
import type { ReactNode } from "react";
import type { ApplyDecisionResult } from "../../services/processing";
import { cancelApplyDialog, confirmApply } from "./apply-actions";
import { CANCEL_BUTTON, Dialog, DialogHeader } from "./Dialog";

type Mode = ApplyDecisionResult["mode"];

const TITLE: Record<Mode, string> = {
  quarantine: "Move to quarantine?",
  trash: "Move to Trash?",
  delete: "Permanently Delete?",
};
const SUBTITLE: Record<Mode, string> = {
  quarantine: "Files can be restored from the quarantine folder",
  trash: "Files can be restored from your trash",
  delete: "This action cannot be undone",
};
const CONFIRM: Record<Mode, string> = {
  quarantine: "Move to Quarantine",
  trash: "Move to Trash",
  delete: "Delete Files",
};
const MODE_TEXT: Record<Mode, string> = {
  quarantine: "moved to the quarantine folder (restorable, the Takeout layout is preserved)",
  trash: "moved to your system trash",
  delete: "permanently removed from disk",
};

const files = (n: number): string => `${n} ${n === 1 ? "file" : "files"}`;

/** What the dry run will remove, how, and what it refuses. */
export function ApplyPlanSummary({ preview }: { preview: ApplyDecisionResult | null }): ReactNode {
  if (!preview) return <p className="text-sm text-fg-muted">Preparing the deletion plan (dry run)…</p>;
  const partners = preview.plan.remove.filter((r) => r.because === "motion_partner").length;
  const reasons = new Map<string, number>();
  for (const s of preview.plan.skipped) {
    const reason = s.reason.replace(/ group .*: kept$/, " group: kept"); // group keys vary; count by kind
    reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
  }
  return (
    <div className="space-y-2 text-sm text-fg-3">
      <p>{`${files(preview.success)} will be ${MODE_TEXT[preview.mode]}.`}</p>
      {partners > 0 && <p>{`Includes ${files(partners)} removed with their motion photo (pairs move together).`}</p>}
      {preview.sidecarsRemoved > 0 && <p>{`${preview.sidecarsRemoved} JSON sidecars go with their photos.`}</p>}
      {reasons.size > 0 && (
        <div className="text-accent-amber">
          <p>{`${files(preview.skipped)} will NOT be removed:`}</p>
          {[...reasons].map(([reason, n]) => (
            <p key={reason} className="ml-3 text-xs">{`${n} × ${reason}`}</p>
          ))}
        </div>
      )}
    </div>
  );
}

export interface ApplyConfirmDialogProps {
  preview: ApplyDecisionResult | null;
  useTrash: boolean;
}

export function ApplyConfirmDialog({ preview, useTrash }: ApplyConfirmDialogProps): ReactNode {
  const mode: Mode = preview?.mode ?? (useTrash ? "trash" : "delete");
  const recoverable = mode !== "delete"; // quarantine and trash are both recoverable
  const canConfirm = preview !== null && preview.success > 0;
  return (
    <Dialog onClose={cancelApplyDialog}>
      <DialogHeader
        icon={recoverable ? <Undo2 size="1em" /> : <TriangleAlert size="1em" />}
        iconClass={recoverable ? "bg-amber-500/20 text-accent-amber" : "bg-red-500/20 text-accent-red"}
        title={TITLE[mode]}
        subtitle={SUBTITLE[mode]}
      />
      <div className="px-6 py-4">
        <ApplyPlanSummary preview={preview} />
      </div>
      <div className="px-6 py-4 border-t border-edge flex justify-end gap-3">
        <button type="button" className={CANCEL_BUTTON} onClick={cancelApplyDialog}>
          Cancel
        </button>
        <button
          type="button"
          className={`px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-50 flex items-center ${
            recoverable ? "bg-amber-600 hover:bg-amber-500" : "bg-red-600 hover:bg-red-500"
          }`}
          disabled={!canConfirm}
          onClick={() => {
            if (canConfirm) void confirmApply();
          }}
        >
          <Trash2 size="1em" className="mr-2" />
          {CONFIRM[mode]}
        </button>
      </div>
    </Dialog>
  );
}
