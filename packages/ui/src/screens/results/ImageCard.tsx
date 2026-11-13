/** One file in the group grid: thumbnail, action badge, hover toggle, compare reference, click-to-compare. */
import { Check, CircleQuestionMark, Film, Flag, Image, Play, Star, Trash2 } from "lucide-react";
import { memo, type ReactNode, useState } from "react";
import type { FileDecisionAction, FileWithReviewContext } from "../../services/processing";
import { useFileServerPort } from "../../services/review-service";
import { fileGps, formatBytes, imageUrl, videoThumbnailUrl } from "./lib";

export interface ImageCardProps {
  fileCtx: FileWithReviewContext;
  action: FileDecisionAction | undefined;
  onToggle: (id: number) => void;
  onCompare: (file: FileWithReviewContext) => void;
  onSetCompareThis: (id: number) => void;
  /** Overlay a "Suggested Keep" badge. */
  isKeep: boolean;
  /** Clicking the thumbnail does not open comparison. */
  disableCompare: boolean;
  /** Time difference relative to the suggested keep file (e.g. "+2h 30m"). */
  timeDiff: string | null;
  isCompareThis: boolean;
  /** Keep files in the group (the compare badges show only with more than one). */
  keepCount: number;
}

const BADGE: Record<string, { cls: string; label: string; icon: ReactNode }> = {
  keep: { cls: "bg-emerald-600 text-white", label: "Keep", icon: <Check size="1em" /> },
  delete: { cls: "bg-red-600 text-white", label: "Delete", icon: <Trash2 size="1em" /> },
  pending: { cls: "bg-surface-inset text-fg-muted", label: "Pending", icon: <CircleQuestionMark size="1em" /> },
};

const BORDER: Record<string, string> = {
  keep: "border-emerald-500",
  delete: "border-red-500/50",
  pending: "border-edge",
};

function dimensionsOf(ctx: FileWithReviewContext): string | null {
  const m = ctx.metadata;
  if (m && "width" in m && m.width && "height" in m && m.height) return `${m.width}×${m.height}`;
  return null;
}

function Thumbnail({ ctx }: { ctx: FileWithReviewContext }): ReactNode {
  const port = useFileServerPort();
  const isVideo = ctx.file.fileType === "video";
  const src = isVideo ? videoThumbnailUrl(port, ctx.file.path) : imageUrl(port, ctx.file.path);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  if (!src || failedSrc === src) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-surface-inset text-4xl text-fg-faint">
        {isVideo ? <Film size="1em" /> : <Image size="1em" />}
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={ctx.file.filename}
      className="w-full h-full object-contain"
      loading="lazy"
      onError={() => setFailedSrc(src)}
    />
  );
}

function ImageCardInner(props: ImageCardProps): ReactNode {
  const { fileCtx, action, isKeep, disableCompare, timeDiff, isCompareThis, keepCount } = props;
  const { file, phashDistance } = fileCtx;
  const key = action ?? "pending";
  const badge = BADGE[key] ?? BADGE.pending;
  const dimensions = dimensionsOf(fileCtx);
  const gps = fileGps(fileCtx);
  const isVideo = file.fileType === "video";
  const isKept = action === "keep";

  return (
    <div
      data-testid="image-card"
      className={`rounded-lg border-2 overflow-hidden transition-colors ${disableCompare ? "cursor-default" : "cursor-pointer"} group ${BORDER[key]}`}
    >
      {/* biome-ignore lint/a11y/noStaticElementInteractions: thumbnail click opens comparison (mouse affordance) */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: the card's buttons provide keyboard access */}
      <div
        className="relative aspect-square bg-zinc-100 dark:bg-zinc-800 overflow-hidden"
        onClick={disableCompare ? undefined : () => props.onCompare(fileCtx)}
      >
        <Thumbnail ctx={fileCtx} />
        <div className="absolute top-2 left-2 flex items-center gap-1">
          <div className={`px-2 py-0.5 rounded text-xs font-medium flex items-center gap-1 ${badge?.cls}`}>
            {badge?.icon}
            {badge?.label}
          </div>
          {isCompareThis && keepCount > 1 && (
            <div className="px-2 py-0.5 rounded text-xs font-medium bg-blue-600 text-white flex items-center gap-1">
              <Flag size="1em" />
              Compare
            </div>
          )}
          {!isCompareThis && isKept && keepCount > 1 && (
            <button
              type="button"
              className="px-2 py-0.5 rounded text-xs font-medium flex items-center gap-1 bg-zinc-500/70 text-white hover:bg-blue-600"
              onClick={(e) => {
                e.stopPropagation();
                props.onSetCompareThis(file.id);
              }}
            >
              <Flag size="1em" />
              Compare
            </button>
          )}
        </div>
        {isKeep && (
          <div className="absolute top-10 left-2 px-2 py-0.5 rounded text-xs font-medium bg-emerald-600 text-white flex items-center gap-1">
            <Star size="1em" />
            Suggested Keep
          </div>
        )}
        <button
          type="button"
          className={`absolute top-2 right-2 px-2 py-1 rounded text-xs font-medium flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity ${
            isKept ? "bg-red-600 hover:bg-red-500 text-white" : "bg-emerald-600 hover:bg-emerald-500 text-white"
          }`}
          onClick={(e) => {
            e.stopPropagation();
            props.onToggle(file.id);
          }}
        >
          {isKept ? <Trash2 size="1em" /> : <Check size="1em" />}
          {isKept ? "Delete" : "Keep"}
        </button>
        {isVideo && (
          <div className="absolute bottom-2 left-2 px-1.5 py-0.5 rounded bg-black/60 text-white text-xs flex items-center gap-1">
            <Play size="1em" />
            Video
          </div>
        )}
      </div>
      <div className="px-3 py-2 bg-zinc-100/80 dark:bg-zinc-800/80">
        <p className="text-sm font-medium truncate" title={file.filename}>
          {file.filename}
        </p>
        <div className="flex items-center gap-2 mt-1 text-sm text-fg-muted flex-wrap">
          <span>{formatBytes(file.size)}</span>
          {dimensions && <span>{dimensions}</span>}
          <span className="uppercase">{file.extension}</span>
          {phashDistance !== undefined && <span className="text-orange-400">{`d=${phashDistance}`}</span>}
          {timeDiff && <span className="text-blue-400">{timeDiff}</span>}
          {gps && <span className="text-green-400">{gps}</span>}
        </div>
      </div>
    </div>
  );
}

/** Memoised: a decision change re-renders only the cards whose props changed (large groups). */
export const ImageCard = memo(ImageCardInner);
