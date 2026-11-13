/** Dry-run plan in the apply-deletions dialog (RFD-003): what will be removed, how, and what is refused. */
import type { ApplyDecisionResult } from "../services/processing";

const MODE_TEXT: Record<ApplyDecisionResult["mode"], string> = {
  quarantine: "moved to the quarantine folder (restorable, the Takeout layout is preserved)",
  trash: "moved to your system trash",
  delete: "permanently removed from disk",
};

export function ApplyPlanSummary(preview: ApplyDecisionResult | null) {
  if (!preview) return p({ class: "text-sm text-fg-muted" }, "Preparing the deletion plan (dry run)…");
  const partners = preview.plan.remove.filter((r) => r.because === "motion_partner").length;
  const reasons = new Map<string, number>();
  for (const s of preview.plan.skipped) {
    const reason = s.reason.replace(/ group .*: kept$/, " group: kept"); // group keys vary; count by kind
    reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
  }
  const files = (n: number) => `${n} ${n === 1 ? "file" : "files"}`;
  return div(
    { class: "space-y-2 text-sm text-fg-3" },
    p({}, `${files(preview.success)} will be ${MODE_TEXT[preview.mode]}.`),
    partners > 0 ? p({}, `Includes ${files(partners)} removed with their motion photo (pairs move together).`) : null,
    preview.sidecarsRemoved > 0 ? p({}, `${preview.sidecarsRemoved} JSON sidecars go with their photos.`) : null,
    reasons.size > 0
      ? div(
          { class: "text-accent-amber" },
          p({}, `${files(preview.skipped)} will NOT be removed:`),
          ...[...reasons].map(([reason, n]) => p({ class: "ml-3 text-xs" }, `${n} × ${reason}`)),
        )
      : null,
  );
}
