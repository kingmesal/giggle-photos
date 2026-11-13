/** CLIP results under the Similarity step (RFD-002): pairs per band, or why CLIP did not run. */

export interface ClipStageStats {
  skipped: null | "disabled" | "model_not_ready" | "model_load_failed";
  detail?: string;
  provider?: string;
  embedded: number;
  embedErrors: number;
  pairsStored: number;
  pairsInReview: number;
  pairsStrong: number;
  thresholds: { strong: number; review: number; store: number };
}

const SKIP_REASONS: Record<string, string> = {
  disabled: "Visual similarity (CLIP) is turned off in Settings.",
  model_not_ready: "Visual similarity (CLIP) skipped: the model is not ready yet.",
  model_load_failed: "Visual similarity (CLIP) skipped: the model could not be loaded.",
};

export function ClipStatsLine(clip: ClipStageStats | { error: string }) {
  if ("error" in clip)
    return div({ class: "mt-1 text-sm text-accent-amber" }, `Visual similarity (CLIP) failed: ${clip.error}`);
  if (clip.skipped) {
    return div(
      { class: "mt-1 text-sm text-fg-muted" },
      SKIP_REASONS[clip.skipped] ?? clip.skipped,
      clip.detail ? span({ class: "ml-1 text-xs font-mono" }, `(${clip.detail})`) : null,
    );
  }
  const t = clip.thresholds;
  return div(
    { class: "mt-1 text-sm" },
    div(
      {},
      `Visual similarity (CLIP): ${clip.pairsInReview} pairs to review (≤ ${t.review}), ${clip.pairsStrong} strong (≤ ${t.strong}); ${clip.pairsStored} stored (≤ ${t.store})`,
    ),
    clip.embedded + clip.embedErrors > 0
      ? div(
          { class: clip.embedErrors > 0 ? "text-accent-amber" : "text-fg-muted" },
          `Embedded later: ${clip.embedded}${clip.embedErrors > 0 ? `, failed: ${clip.embedErrors}` : ""}${clip.provider ? ` (${clip.provider})` : ""}`,
        )
      : null,
  );
}
