/**
 * ImageCard component — reusable image card with thumbnail, action badge,
 * hover toggle, and click-to-compare.
 *
 * Note: HTML element functions (div, img, button, span, i, p) are globals
 * provided by Sigment — do NOT import them.
 */

import type { FileDecisionAction, FileWithReviewContext } from "../services/processing";
import { formatBytes, formatGpsCoords, getImageUrl, getVideoThumbnailUrl } from "./ReviewSignals";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ImageCardProps {
  fileCtx: FileWithReviewContext;
  action: FileDecisionAction | undefined;
  onToggle: () => void;
  onCompare: () => void;
  /** When true, overlay a "Suggested Keep" badge */
  isKeep?: boolean;
  /** When true, clicking the thumbnail does not open comparison */
  disableCompare?: boolean;
  /** Time difference relative to keep file (e.g., "+2h 30m") */
  timeDiff?: string | null;
  /** When true, show "Compare Ref" badge (only when keepCount > 1) */
  isCompareThis?: boolean;
  /** Callback to set this file as the compare reference */
  onSetCompareThis?: () => void;
  /** Number of keep files in the current group (controls badge visibility) */
  keepCount?: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function actionBadgeClasses(action: FileDecisionAction | undefined): string {
  switch (action) {
    case "keep":
      return "bg-emerald-600 text-white";
    case "delete":
      return "bg-red-600 text-white";
    default:
      return "bg-surface-inset text-fg-muted";
  }
}

function actionBadgeLabel(action: FileDecisionAction | undefined): string {
  switch (action) {
    case "keep":
      return "Keep";
    case "delete":
      return "Delete";
    default:
      return "Pending";
  }
}

function actionBadgeIcon(action: FileDecisionAction | undefined): string {
  switch (action) {
    case "keep":
      return "fa-check";
    case "delete":
      return "fa-trash";
    default:
      return "fa-question";
  }
}

function borderColorClass(action: FileDecisionAction | undefined): string {
  switch (action) {
    case "keep":
      return "border-emerald-500";
    case "delete":
      return "border-red-500/50";
    default:
      return "border-edge";
  }
}

function toggleLabel(action: FileDecisionAction | undefined): string {
  return action === "keep" ? "Delete" : "Keep";
}

function toggleIcon(action: FileDecisionAction | undefined): string {
  return action === "keep" ? "fa-trash" : "fa-check";
}

function toggleClasses(action: FileDecisionAction | undefined): string {
  return action === "keep"
    ? "bg-red-600 hover:bg-red-500 text-white"
    : "bg-emerald-600 hover:bg-emerald-500 text-white";
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ImageCard({
  fileCtx,
  action,
  onToggle,
  onCompare,
  isKeep,
  disableCompare,
  timeDiff,
  isCompareThis,
  onSetCompareThis,
  keepCount,
}: ImageCardProps) {
  const { file, metadata, phashDistance } = fileCtx;

  // Extract dimensions
  let dimensions: string | null = null;
  if (metadata && "width" in metadata && metadata.width && "height" in metadata && metadata.height) {
    dimensions = `${metadata.width}×${metadata.height}`;
  }

  // Extract GPS coordinates
  let gpsDisplay: string | null = null;
  if (metadata && "gpsLatitude" in metadata && "gpsLongitude" in metadata) {
    gpsDisplay = formatGpsCoords(
      (metadata as Record<string, unknown>).gpsLatitude as number | null,
      (metadata as Record<string, unknown>).gpsLongitude as number | null,
      ("gpsAltitude" in metadata ? (metadata as Record<string, unknown>).gpsAltitude : null) as number | null,
    );
  }

  const border = borderColorClass(action);

  // Build the thumbnail element with onerror fallback
  const isVideo = file.fileType === "video";
  const thumbnailSrc = isVideo ? getVideoThumbnailUrl(file.path) : getImageUrl(file.path);

  const imgEl = img({
    src: thumbnailSrc,
    alt: file.filename,
    class: "w-full h-full object-contain",
    loading: "lazy",
    onerror: (e: Event | string) => {
      if (typeof e === "string") return;
      const target = e.target as HTMLImageElement;
      // Replace broken image with a fallback icon
      const fallback = div(
        { class: "w-full h-full flex items-center justify-center bg-surface-inset" },
        i({
          class: `fadr ${isVideo ? "fa-film" : "fa-image"} text-4xl text-fg-faint`,
        }),
      );
      target.replaceWith(fallback);
    },
  });

  return div(
    {
      class: `rounded-lg border-2 overflow-hidden transition-colors ${disableCompare ? "cursor-default" : "cursor-pointer"} group ${border}`,
    },
    // Thumbnail area — click opens comparison (disabled for keep files)
    div(
      {
        class: "relative aspect-square bg-zinc-100 dark:bg-zinc-800 overflow-hidden",
        onclick: disableCompare ? undefined : () => onCompare(),
      },
      imgEl,
      // Top-left row: Action badge + Compare badge/button
      div(
        { class: "absolute top-2 left-2 flex items-center gap-1" },
        // Action badge
        div(
          {
            class: `px-2 py-0.5 rounded text-xs font-medium flex items-center gap-1 ${actionBadgeClasses(action)}`,
          },
          i({ class: `fadr ${actionBadgeIcon(action)}` }),
          actionBadgeLabel(action),
        ),
        // Compare Ref badge (when this file IS the compare reference)
        ...(isCompareThis && (keepCount ?? 0) > 1
          ? [
              div(
                {
                  class: "px-2 py-0.5 rounded text-xs font-medium bg-blue-600 text-white flex items-center gap-1",
                },
                i({ class: "fadr fa-flag-swallowtail" }),
                "Compare",
              ),
            ]
          : []),
        // "Set Compare" button (when this file CAN become the compare reference)
        ...(onSetCompareThis && !isCompareThis && action === "keep" && (keepCount ?? 0) > 1
          ? [
              button(
                {
                  class:
                    "px-2 py-0.5 rounded text-xs font-medium flex items-center gap-1 bg-zinc-500/70 text-white hover:bg-blue-600",
                  onclick: (e: MouseEvent) => {
                    e.stopPropagation();
                    onSetCompareThis();
                  },
                },
                i({ class: "fadr fa-flag-swallowtail" }),
                "Compare",
              ),
            ]
          : []),
      ),
      // Below top-left: Suggested Keep badge
      ...(isKeep
        ? [
            div(
              {
                class:
                  "absolute top-10 left-2 px-2 py-0.5 rounded text-xs font-medium bg-emerald-600 text-white flex items-center gap-1",
              },
              i({ class: "fadr fa-star" }),
              "Suggested Keep",
            ),
          ]
        : []),
      // Top-right: Toggle button (hover only)
      button(
        {
          class: `absolute top-2 right-2 px-2 py-1 rounded text-xs font-medium flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity ${toggleClasses(action)}`,
          onclick: (e: MouseEvent) => {
            e.stopPropagation();
            onToggle();
          },
        },
        i({ class: `fadr ${toggleIcon(action)}` }),
        toggleLabel(action),
      ),
      // Video indicator overlay (bottom-left play icon)
      ...(isVideo
        ? [
            div(
              {
                class:
                  "absolute bottom-2 left-2 px-1.5 py-0.5 rounded bg-black/60 text-white text-xs flex items-center gap-1",
              },
              i({ class: "fadr fa-play" }),
              "Video",
            ),
          ]
        : []),
    ),
    // File info bar
    div(
      { class: "px-3 py-2 bg-zinc-100/80 dark:bg-zinc-800/80" },
      p({ class: "text-sm font-medium truncate", title: file.filename }, file.filename),
      div(
        { class: "flex items-center gap-2 mt-1 text-sm text-fg-muted flex-wrap" },
        span({}, formatBytes(file.size)),
        dimensions ? span({}, dimensions) : null,
        span({ class: "uppercase" }, file.extension),
        phashDistance !== undefined ? span({ class: "text-orange-400" }, `d=${phashDistance}`) : null,
        timeDiff ? span({ class: "text-blue-400" }, timeDiff) : null,
        gpsDisplay ? span({ class: "text-green-400" }, gpsDisplay) : null,
      ),
    ),
  );
}
