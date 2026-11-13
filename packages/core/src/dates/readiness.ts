/**
 * Capture dates are the final step, after duplicate checks (RFD-006): writing dates changes the
 * files' bytes (SHA-256), so exact-duplicate review and deletions must be finished first.
 * CLIP ("visually similar") groups are review-only and do not block.
 */
import type { ReviewSummary } from "../review/review-queries";

export interface CaptureDatesReadiness {
  ready: boolean;
  /** Why writing is blocked, one line each (empty when ready). */
  blockers: string[];
}

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

export function captureDatesReadiness(
  s: Pick<ReviewSummary, "pendingSha256" | "pendingContentHash" | "pendingPhash" | "decidedDelete" | "conflictCount">,
): CaptureDatesReadiness {
  const blockers: string[] = [];
  const pending = s.pendingSha256 + s.pendingContentHash + s.pendingPhash;
  if (pending > 0) blockers.push(`${plural(pending, "duplicate group")} still to review`);
  if (s.conflictCount > 0) blockers.push(`${plural(s.conflictCount, "conflict")} to resolve`);
  if (s.decidedDelete > 0)
    blockers.push(`${plural(s.decidedDelete, "file")} marked for deletion; apply the deletions first`);
  return { ready: blockers.length === 0, blockers };
}
