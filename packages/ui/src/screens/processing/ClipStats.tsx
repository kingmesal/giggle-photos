/** CLIP results under the Similarity step (RFD-002): pairs per band, or why CLIP did not run. */
import type { ReactNode } from "react";
import type { ClipStageStats } from "../../services/clip-service";

const SKIP_REASONS: Record<string, string> = {
  disabled: "Visual similarity (CLIP) is turned off in Settings.",
  model_not_ready: "Visual similarity (CLIP) skipped: the model is not ready yet.",
  model_load_failed: "Visual similarity (CLIP) skipped: the model could not be loaded.",
};

function VideoLine({ clip }: { clip: ClipStageStats }): ReactNode {
  if (clip.videoSkipped === "no_ffmpeg") {
    return <div className="text-accent-amber">Videos skipped: install ffmpeg to compare video frames.</div>;
  }
  const embedded = clip.videosEmbedded ?? 0;
  const failed = clip.videoEmbedErrors ?? 0;
  if (clip.videoPairs === undefined && embedded + failed === 0) return null;
  const parts = [`Videos: ${clip.videoPairs ?? 0} pairs`];
  if (embedded > 0) parts.push(`${embedded} newly embedded`);
  if (failed > 0) parts.push(`${failed} failed`);
  return <div className={failed > 0 ? "text-accent-amber" : "text-fg-muted"}>{parts.join(", ")}</div>;
}

export function ClipStatsLine({ clip }: { clip: ClipStageStats | { error: string } }): ReactNode {
  if ("error" in clip) {
    return <div className="mt-1 text-sm text-accent-amber">{`Visual similarity (CLIP) failed: ${clip.error}`}</div>;
  }
  if (clip.skipped) {
    return (
      <div className="mt-1 text-sm text-fg-muted">
        {SKIP_REASONS[clip.skipped] ?? clip.skipped}
        {clip.detail && <span className="ml-1 text-xs font-mono">{`(${clip.detail})`}</span>}
      </div>
    );
  }
  const t = clip.thresholds;
  const embeddedText = `Embedded later: ${clip.embedded}${clip.embedErrors > 0 ? `, failed: ${clip.embedErrors}` : ""}${clip.provider ? ` (${clip.provider})` : ""}`;
  return (
    <div className="mt-1 text-sm">
      <div>
        {`Visual similarity (CLIP): ${clip.pairsInReview} pairs to review (≤ ${t.review}), ${clip.pairsStrong} strong (≤ ${t.strong}); ${clip.pairsStored} stored (≤ ${t.store})`}
      </div>
      {clip.embedded + clip.embedErrors > 0 && (
        <div className={clip.embedErrors > 0 ? "text-accent-amber" : "text-fg-muted"}>{embeddedText}</div>
      )}
      <VideoLine clip={clip} />
    </div>
  );
}
