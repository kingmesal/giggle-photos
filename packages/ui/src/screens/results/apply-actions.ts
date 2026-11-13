/** Apply deletions (dry run first, RFD-003) and conflict resolution. */
import { getLogger } from "../../services/logger-service";
import { reviewService } from "../../services/processing";
import { checkTrashAvailable, loadSettings } from "../../services/settings-service";
import { loadNextGroup } from "./review-actions";
import { getReview, patchReview } from "./review-store";

const log = getLogger("ui:review-apply");
let applyRound = 0;

/** Open the confirm dialog and fetch the dry-run plan it shows. */
export async function openApplyDialog(): Promise<void> {
  if (getReview().summary.decidedDelete === 0) {
    patchReview({ error: "No files are marked for deletion. Review groups and mark duplicates first." });
    return;
  }
  const mine = ++applyRound;
  let useTrash = false;
  try {
    const [settings, trashInfo] = await Promise.all([loadSettings(), checkTrashAvailable()]);
    useTrash = settings.moveToTrash && trashInfo.available;
  } catch {
    useTrash = false;
  }
  if (mine !== applyRound) return;
  patchReview({ applyUseTrash: useTrash, applyPreview: null, dialog: "apply" });
  try {
    const preview = await reviewService.applyDeletions({ dryRun: true, moveToTrash: useTrash });
    if (mine === applyRound && getReview().dialog === "apply") patchReview({ applyPreview: preview });
  } catch (error) {
    if (mine !== applyRound) return;
    log.error("Dry run failed", error);
    patchReview({
      dialog: "none",
      error: error instanceof Error ? error.message : "Could not prepare the deletion plan",
    });
  }
}

export function cancelApplyDialog(): void {
  applyRound++;
  patchReview({ dialog: "none", applyPreview: null });
}

/** Run the deletions for real, then reload. */
export async function confirmApply(): Promise<void> {
  applyRound++;
  patchReview({ dialog: "none", actionLoading: true, error: null });
  try {
    let moveToTrash = true;
    try {
      moveToTrash = (await loadSettings()).moveToTrash;
    } catch {
      // Fall back to true if settings can't be loaded
    }
    const result = await reviewService.applyDeletions({ moveToTrash });
    log.info("Deletions applied", result);
    await loadNextGroup();
  } catch (error) {
    log.error("Failed to apply deletions", error);
    patchReview({ error: error instanceof Error ? error.message : "Failed to apply deletions" });
  } finally {
    patchReview({ actionLoading: false, applyPreview: null });
  }
}

/** Resolve one conflict, then refresh the summary (and conflict count). */
export async function resolveConflict(mediaFileId: number, action: "keep" | "delete"): Promise<boolean> {
  try {
    await reviewService.resolveConflict({ mediaFileId, action });
    await loadNextGroup();
    return true;
  } catch (error) {
    log.error("Failed to resolve conflict", error);
    return false;
  }
}
