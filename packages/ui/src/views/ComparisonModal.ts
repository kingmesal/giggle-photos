/**
 * ComparisonModal — full-screen overlay for side-by-side comparison of two images.
 * Left panel shows the "keep" (suggested) image, right shows the compared image.
 * A metadata table below highlights differences.
 *
 * Note: HTML element functions are globals provided by Sigment.
 */

import type { FileDecisionAction, FileWithReviewContext } from "../services/processing";
import {
  type CompareViewMode,
  closeComparison,
  computeTimeDiff,
  formatBytes,
  formatGpsCoords,
  getCompareFile,
  getCompareThisFileId,
  getCompareViewMode,
  getGroupFiles,
  getImageUrl,
  getLocalDecisions,
  getSuggestion,
  getVideoFrameUrl,
  setCompareThisFileId,
  setCompareViewMode,
  setFileAction,
  swapFileActions,
} from "./ReviewSignals";

// ---------------------------------------------------------------------------
// View mode layout helpers
// ---------------------------------------------------------------------------

function viewModeImageClass(mode: CompareViewMode): string {
  switch (mode) {
    case "xl":
      return "flex-[9] min-h-0";
    case "large":
      return "flex-[3] min-h-0";
    case "balanced":
      return "flex-[1] min-h-0";
    case "compact":
      return "flex-[1] min-h-0";
  }
}

function viewModeMetaClass(mode: CompareViewMode): string {
  switch (mode) {
    case "xl":
      return "flex-[1] min-h-0";
    case "large":
      return "flex-[1] min-h-0";
    case "balanced":
      return "flex-[1] min-h-0";
    case "compact":
      return "flex-[3] min-h-0";
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Get the stable reference file for the left panel.
 * Uses the compare-this reference as primary, falling back to
 * the suggestion, then the first file.
 */
function getKeepFile(): FileWithReviewContext | null {
  const files = getGroupFiles();

  // Primary: use compare-this reference
  const compareThisId = getCompareThisFileId();
  if (compareThisId !== null) {
    const found = files.find((f) => f.file.id === compareThisId);
    if (found) return found;
  }

  // Fallback: use the suggestion
  const suggestion = getSuggestion();
  if (suggestion && suggestion.fileId > 0) {
    return files.find((f) => f.file.id === suggestion.fileId) ?? null;
  }

  return files[0] ?? null;
}

function getDimensions(ctx: FileWithReviewContext): string {
  if (
    ctx.metadata &&
    "width" in ctx.metadata &&
    ctx.metadata.width &&
    "height" in ctx.metadata &&
    ctx.metadata.height
  ) {
    return `${ctx.metadata.width} × ${ctx.metadata.height}`;
  }
  return "—";
}

function getFolder(ctx: FileWithReviewContext): string {
  const lastSlash = ctx.file.path.lastIndexOf("/");
  return lastSlash >= 0 ? ctx.file.path.substring(0, lastSlash) : ctx.file.path;
}

function getFormat(ctx: FileWithReviewContext): string {
  if (ctx.metadata && "format" in ctx.metadata && ctx.metadata.format) {
    return String(ctx.metadata.format).toUpperCase();
  }
  return ctx.file.extension.toUpperCase();
}

function getDateTaken(ctx: FileWithReviewContext): string {
  if (ctx.metadata && "dateTaken" in ctx.metadata && ctx.metadata.dateTaken) {
    const d = ctx.metadata.dateTaken;
    return d instanceof Date ? d.toLocaleString() : String(d);
  }
  return "—";
}

function getGpsString(ctx: FileWithReviewContext): string {
  if (!ctx.metadata) return "—";
  const meta = ctx.metadata as Record<string, unknown>;
  const lat = typeof meta.gpsLatitude === "number" ? meta.gpsLatitude : null;
  const lon = typeof meta.gpsLongitude === "number" ? meta.gpsLongitude : null;
  const alt = typeof meta.gpsAltitude === "number" ? meta.gpsAltitude : null;
  return formatGpsCoords(lat, lon, alt) ?? "—";
}

function getMetaField(ctx: FileWithReviewContext, field: string): string {
  if (!ctx.metadata) return "—";
  const val = (ctx.metadata as Record<string, unknown>)[field];
  if (val === null || val === undefined) return "—";
  if (typeof val === "boolean") return val ? "Yes" : "No";
  return String(val);
}

// ---------------------------------------------------------------------------
// Metadata row builder
// ---------------------------------------------------------------------------

interface MetaRow {
  label: string;
  keepVal: string;
  compareVal: string;
}

function buildMetaRows(keepFile: FileWithReviewContext, compareFile: FileWithReviewContext): MetaRow[] {
  // Append time difference to the compare file's date taken value
  const timeDiff = computeTimeDiff(compareFile, keepFile);
  const compareDateStr = getDateTaken(compareFile);
  const compareDateWithDiff = timeDiff && compareDateStr !== "—" ? `${compareDateStr} (${timeDiff})` : compareDateStr;

  const rows: MetaRow[] = [
    { label: "Filename", keepVal: keepFile.file.filename, compareVal: compareFile.file.filename },
    { label: "Path", keepVal: getFolder(keepFile), compareVal: getFolder(compareFile) },
    { label: "Size", keepVal: formatBytes(keepFile.file.size), compareVal: formatBytes(compareFile.file.size) },
    { label: "Dimensions", keepVal: getDimensions(keepFile), compareVal: getDimensions(compareFile) },
    { label: "Format", keepVal: getFormat(keepFile), compareVal: getFormat(compareFile) },
    { label: "Date Taken", keepVal: getDateTaken(keepFile), compareVal: compareDateWithDiff },
  ];

  // Image-specific fields
  if (keepFile.file.fileType === "image" || compareFile.file.fileType === "image") {
    rows.push(
      {
        label: "Camera Make",
        keepVal: getMetaField(keepFile, "cameraMake"),
        compareVal: getMetaField(compareFile, "cameraMake"),
      },
      {
        label: "Camera Model",
        keepVal: getMetaField(keepFile, "cameraModel"),
        compareVal: getMetaField(compareFile, "cameraModel"),
      },
      {
        label: "Color Space",
        keepVal: getMetaField(keepFile, "colorSpace"),
        compareVal: getMetaField(compareFile, "colorSpace"),
      },
      {
        label: "Has Alpha",
        keepVal: getMetaField(keepFile, "hasAlpha"),
        compareVal: getMetaField(compareFile, "hasAlpha"),
      },
      {
        label: "Orientation",
        keepVal: getMetaField(keepFile, "orientation"),
        compareVal: getMetaField(compareFile, "orientation"),
      },
      {
        label: "Location",
        keepVal: getGpsString(keepFile),
        compareVal: getGpsString(compareFile),
      },
    );
  }

  // Video-specific fields
  if (keepFile.file.fileType === "video" || compareFile.file.fileType === "video") {
    rows.push(
      {
        label: "Duration",
        keepVal: getMetaField(keepFile, "duration"),
        compareVal: getMetaField(compareFile, "duration"),
      },
      {
        label: "Frame Rate",
        keepVal: getMetaField(keepFile, "frameRate"),
        compareVal: getMetaField(compareFile, "frameRate"),
      },
      { label: "Codec", keepVal: getMetaField(keepFile, "codec"), compareVal: getMetaField(compareFile, "codec") },
      {
        label: "Audio Codec",
        keepVal: getMetaField(keepFile, "audioCodec"),
        compareVal: getMetaField(compareFile, "audioCodec"),
      },
      {
        label: "Bitrate",
        keepVal: getMetaField(keepFile, "bitrate"),
        compareVal: getMetaField(compareFile, "bitrate"),
      },
    );
  }

  // Always include priority and phash distance
  rows.push({
    label: "Folder Priority",
    keepVal: String(keepFile.folderPriority),
    compareVal: String(compareFile.folderPriority),
  });

  // Show pHash distance only when non-zero (identical = 0 is not useful to display)
  const keepDist = keepFile.phashDistance;
  const compareDist = compareFile.phashDistance;
  if ((keepDist !== undefined && keepDist > 0) || (compareDist !== undefined && compareDist > 0)) {
    rows.push({
      label: "pHash Distance",
      keepVal: keepDist !== undefined && keepDist > 0 ? String(keepDist) : "—",
      compareVal: compareDist !== undefined && compareDist > 0 ? String(compareDist) : "—",
    });
  }

  return rows;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/** Build a row of action buttons (keep/delete) for a file */
function makeActionButtons(fileId: number, decisions: Map<number, string>): HTMLElement {
  const currentAction = decisions.get(fileId);

  const btnData: Array<{ action: FileDecisionAction; icon: string; label: string; activeClass: string }> = [
    { action: "keep", icon: "fa-check", label: "Keep", activeClass: "bg-emerald-600 text-white" },
    { action: "delete", icon: "fa-trash", label: "Delete", activeClass: "bg-red-600 text-white" },
  ];

  return div(
    { class: "flex items-center gap-1.5 mb-2" },
    ...btnData.map((b) => {
      const isActive = currentAction === b.action;
      return button(
        {
          class: `px-2 py-1 rounded text-xs font-medium flex items-center gap-1 ${
            isActive ? b.activeClass : "bg-surface-inset text-fg-muted hover:bg-surface-active hover:text-fg-2"
          }`,
          title: b.label,
          onclick: (e: MouseEvent) => {
            e.stopPropagation();
            setFileAction(fileId, b.action);
          },
        },
        i({ class: `fadr ${b.icon}` }),
        b.label,
      );
    }),
  );
}

export function ComparisonModal() {
  // Use a persistent container that we show/hide via direct DOM manipulation.
  // This avoids relying on Sigment's reactive closure returning null, which
  // can be unreliable for removing complex DOM trees.
  const container = div({ class: "fixed inset-0 z-50 hidden" });

  // Track at component scope so it persists across closure re-runs
  let autoStepTimer: ReturnType<typeof setInterval> | null = null;

  // Escape key handler
  document.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "Escape" && getCompareFile()) {
      closeComparison();
    }
  });

  // Helper to close: clear signal AND force-hide the container
  function doClose(): void {
    if (autoStepTimer) {
      clearInterval(autoStepTimer);
      autoStepTimer = null;
    }
    container.classList.add("hidden");
    closeComparison();
  }

  return () => {
    // Clear any orphaned timer from previous closure run
    if (autoStepTimer) {
      clearInterval(autoStepTimer);
      autoStepTimer = null;
    }

    const compareFile = getCompareFile();

    if (!compareFile) {
      container.classList.add("hidden");
      // Clear children
      container.innerHTML = "";
      return container;
    }

    const keepFile = getKeepFile();
    if (!keepFile) {
      container.classList.add("hidden");
      container.innerHTML = "";
      return container;
    }

    // Show the container
    container.classList.remove("hidden");

    const decisions = getLocalDecisions();
    const metaRows = buildMetaRows(keepFile, compareFile);

    // Check if either/both files are videos
    const bothVideos = keepFile.file.fileType === "video" && compareFile.file.fileType === "video";
    const anyVideo = keepFile.file.fileType === "video" || compareFile.file.fileType === "video";

    // -----------------------------------------------------------------------
    // Frame stepping state (for video comparison)
    // -----------------------------------------------------------------------
    let frameSteps: number[] = [];
    let currentFrameIdx = 0;
    let leftImgEl: HTMLImageElement | null = null;
    let rightImgEl: HTMLImageElement | null = null;
    let frameLabelEl: HTMLElement | null = null;
    let autoStepBtnEl: HTMLElement | null = null;

    if (anyVideo) {
      // Get duration from metadata (seconds). Use the shorter duration for step range.
      const getDuration = (ctx: FileWithReviewContext): number => {
        if (ctx.metadata && "duration" in ctx.metadata && ctx.metadata.duration) {
          const d = Number(ctx.metadata.duration);
          return Number.isFinite(d) && d > 0 ? d : 0;
        }
        return 0;
      };
      const leftDur = getDuration(keepFile);
      const rightDur = getDuration(compareFile);
      const maxDur = bothVideos ? Math.min(leftDur || rightDur, rightDur || leftDur) : leftDur || rightDur;

      // Build step timestamps: first frame (0), then every ~1s (24 frames at 24fps), plus last frame
      const stepInterval = 1.0;
      frameSteps = [0];
      if (maxDur > 0) {
        for (let t = stepInterval; t < maxDur; t += stepInterval) {
          frameSteps.push(Math.round(t * 1000) / 1000);
        }
        // Always include last frame if not already there
        if ((frameSteps[frameSteps.length - 1] ?? 0) < maxDur - 0.01) {
          frameSteps.push(Math.round(maxDur * 1000) / 1000);
        }
      }
    }

    // Capture non-null file references for use in closures below
    const keepFilePath = keepFile.file.path;
    const keepFileType = keepFile.file.fileType;
    const compareFilePath = compareFile.file.path;
    const compareFileType = compareFile.file.fileType;

    /** Update displayed frame images to the current step — preloads both before updating DOM */
    function seekToFrame(idx: number): void {
      if (idx < 0 || idx >= frameSteps.length) return;
      currentFrameIdx = idx;
      const time = frameSteps[idx] ?? 0;

      // Build URLs
      const leftUrl = keepFileType === "video" ? getVideoFrameUrl(keepFilePath, time) : null;
      const rightUrl = compareFileType === "video" ? getVideoFrameUrl(compareFilePath, time) : null;

      // Preload both images before updating DOM
      const preloads: Promise<void>[] = [];
      if (leftUrl) {
        preloads.push(
          new Promise<void>((resolve) => {
            const preImg = new Image();
            preImg.onload = () => resolve();
            preImg.onerror = () => resolve();
            preImg.src = leftUrl;
          }),
        );
      }
      if (rightUrl) {
        preloads.push(
          new Promise<void>((resolve) => {
            const preImg = new Image();
            preImg.onload = () => resolve();
            preImg.onerror = () => resolve();
            preImg.src = rightUrl;
          }),
        );
      }

      // Update frame label immediately (text is cheap)
      if (frameLabelEl) {
        frameLabelEl.textContent = `Frame ${idx + 1} / ${frameSteps.length}  (${time.toFixed(1)}s)`;
      }

      // Wait for all images to load, then update both simultaneously
      Promise.all(preloads).then(() => {
        if (leftImgEl && leftUrl) leftImgEl.src = leftUrl;
        if (rightImgEl && rightUrl) rightImgEl.src = rightUrl;
      });
    }

    function stopAutoStep(): void {
      if (autoStepTimer) {
        clearInterval(autoStepTimer);
        autoStepTimer = null;
      }
      if (autoStepBtnEl) {
        autoStepBtnEl.innerHTML = "";
        autoStepBtnEl.appendChild(i({ class: "fadr fa-play" }));
        autoStepBtnEl.appendChild(document.createTextNode(" Auto"));
      }
    }

    // Build image element for a panel (image files use direct URL, video files use frame URL)
    const makeMediaImg = (ctx: FileWithReviewContext, side: "left" | "right") => {
      const isVideo = ctx.file.fileType === "video";
      const initialSrc = isVideo ? getVideoFrameUrl(ctx.file.path, 0) : getImageUrl(ctx.file.path);

      const imgEl = img({
        src: initialSrc,
        alt: ctx.file.filename,
        class: "max-w-full max-h-full object-contain mx-auto",
        loading: "lazy",
        onerror: (e: Event | string) => {
          if (typeof e === "string") return;
          const target = e.target as HTMLImageElement;
          const fallback = div(
            { class: "w-full h-64 flex items-center justify-center bg-surface-inset rounded" },
            i({ class: `fadr ${isVideo ? "fa-film" : "fa-image"} text-6xl text-fg-faint` }),
          );
          target.replaceWith(fallback);
        },
      });

      // Capture references for frame stepping
      if (isVideo) {
        if (side === "left") leftImgEl = imgEl as unknown as HTMLImageElement;
        else rightImgEl = imgEl as unknown as HTMLImageElement;
      }

      return imgEl;
    };

    // Rebuild content
    container.innerHTML = "";
    container.className = "fixed inset-0 z-50 flex flex-col bg-black/80 backdrop-blur-sm overflow-hidden";

    // View mode toggle buttons — graduated fa-image icons (compact=small → large=big)
    const currentMode = getCompareViewMode();
    const viewModes: Array<{ mode: CompareViewMode; label: string; iconSize: string }> = [
      { mode: "compact", label: "Compact", iconSize: "text-xs" },
      { mode: "balanced", label: "Balanced", iconSize: "text-sm" },
      { mode: "large", label: "Large", iconSize: "text-base" },
      { mode: "xl", label: "Extra Large", iconSize: "text-xl" },
    ];

    // Header
    const headerEl = div(
      { class: "flex-shrink-0 flex items-center justify-between px-6 py-3 bg-surface border-b border-edge" },
      h3({ class: "text-lg font-semibold text-fg" }, anyVideo ? "Compare Videos" : "Compare Images"),
      div(
        { class: "flex items-center gap-4" },
        // View mode toggles
        div(
          { class: "flex items-center gap-1" },
          ...viewModes.map(({ mode, label, iconSize }) =>
            button(
              {
                class: `w-8 h-7 rounded flex items-center justify-center ${
                  currentMode === mode
                    ? "bg-blue-600 text-white"
                    : "bg-surface-inset text-fg-muted hover:bg-surface-active hover:text-fg-2"
                }`,
                title: label,
                onclick: (e: MouseEvent) => {
                  e.stopPropagation();
                  setCompareViewMode(mode);
                },
              },
              i({ class: `fadr fa-image ${iconSize}` }),
            ),
          ),
        ),
        button(
          {
            class:
              "px-3 py-1.5 rounded text-sm font-medium bg-red-600 hover:bg-red-500 text-white flex items-center gap-2",
            onclick: (e: MouseEvent) => {
              e.stopPropagation();
              stopAutoStep();
              doClose();
            },
          },
          i({ class: "fadr fa-xmark" }),
          "Close",
        ),
      ),
    );

    // -----------------------------------------------------------------------
    // Frame stepper bar (only for videos)
    // -----------------------------------------------------------------------
    let frameStepperEl: HTMLElement | null = null;

    if (anyVideo && frameSteps.length > 1) {
      // Build controls with native DOM to avoid Sigment event issues
      const makeCtrlBtn = (icon: string, title: string, onClick: () => void): HTMLElement => {
        const btn = document.createElement("button");
        btn.className =
          "px-2 py-1 rounded text-sm bg-surface-inset hover:bg-surface-active text-fg-3 hover:text-fg flex items-center gap-1";
        btn.title = title;
        btn.appendChild(i({ class: `fadr ${icon}` }));
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          onClick();
        });
        return btn;
      };

      frameLabelEl = document.createElement("span");
      frameLabelEl.className = "text-sm text-fg-muted font-mono min-w-[10rem] text-center";
      frameLabelEl.textContent = `Frame 1 / ${frameSteps.length}  (0.0s)`;

      const autoBtn = document.createElement("button");
      autoBtn.className = "px-2 py-1 rounded text-sm bg-blue-600 hover:bg-blue-500 text-white flex items-center gap-1";
      autoBtn.title = "Auto-step through frames";
      autoBtn.appendChild(i({ class: "fadr fa-play" }));
      autoBtn.appendChild(document.createTextNode(" Auto"));
      autoBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (autoStepTimer) {
          stopAutoStep();
        } else {
          // Start auto-stepping from current position (or restart from 0 if at end)
          if (currentFrameIdx >= frameSteps.length - 1) seekToFrame(0);
          autoStepTimer = setInterval(() => {
            if (currentFrameIdx >= frameSteps.length - 1) {
              stopAutoStep();
              return;
            }
            seekToFrame(currentFrameIdx + 1);
          }, 750);
          autoBtn.innerHTML = "";
          autoBtn.appendChild(i({ class: "fadr fa-pause" }));
          autoBtn.appendChild(document.createTextNode(" Stop"));
        }
      });
      autoStepBtnEl = autoBtn;

      frameStepperEl = div(
        { class: "flex-shrink-0 flex items-center justify-center gap-2 px-6 py-2 bg-surface border-b border-edge" },
        makeCtrlBtn("fa-backward-fast", "First frame", () => {
          stopAutoStep();
          seekToFrame(0);
        }),
        makeCtrlBtn("fa-backward-step", "Previous frame", () => {
          stopAutoStep();
          seekToFrame(currentFrameIdx - 1);
        }),
        frameLabelEl,
        makeCtrlBtn("fa-forward-step", "Next frame", () => {
          stopAutoStep();
          seekToFrame(currentFrameIdx + 1);
        }),
        makeCtrlBtn("fa-forward-fast", "Last frame", () => {
          stopAutoStep();
          seekToFrame(frameSteps.length - 1);
        }),
        autoBtn,
      );
    }

    // Image comparison area — height driven by view mode, solid bg to prevent bleedthrough
    const imageArea = div(
      { class: `${viewModeImageClass(currentMode)} flex items-stretch gap-0 px-6 py-4 bg-surface` },
      // Left: Keep image column
      div(
        { class: "flex-1 flex flex-col items-center min-w-0" },
        makeActionButtons(keepFile.file.id, decisions),
        div(
          {
            class:
              "flex-1 min-h-0 w-full bg-surface-card rounded-lg overflow-hidden p-2 border border-edge flex items-center justify-center",
          },
          makeMediaImg(keepFile, "left"),
        ),
        p(
          { class: "text-sm text-fg-3 mt-2 truncate max-w-full", title: keepFile.file.filename },
          keepFile.file.filename,
        ),
        p({ class: "text-xs text-fg-faint truncate max-w-full", title: keepFile.file.path }, getFolder(keepFile)),
      ),
      // Swap button between columns (aligned to top with action buttons)
      (() => {
        const leftAction = decisions.get(keepFile.file.id) as FileDecisionAction | undefined;
        const rightAction = decisions.get(compareFile.file.id) as FileDecisionAction | undefined;
        // Disable when both are the same (including both undefined)
        const swapDisabled = leftAction === rightAction;

        return div(
          { class: "flex-shrink-0 flex items-start pt-0 px-2" },
          button(
            {
              class: swapDisabled
                ? "p-2 rounded-full bg-surface-inset text-fg-faint cursor-not-allowed opacity-50"
                : "p-2 rounded-full bg-surface-inset hover:bg-surface-active text-fg-3 hover:text-black dark:hover:text-white",
              title: swapDisabled ? "Both files have the same action" : "Swap actions",
              disabled: swapDisabled,
              onclick: swapDisabled
                ? undefined
                : (e: MouseEvent) => {
                    e.stopPropagation();
                    // Only swap the actions, don't move files between panels
                    const newLeft = rightAction ?? (leftAction === "keep" ? "delete" : "keep");
                    const newRight = leftAction ?? (rightAction === "keep" ? "delete" : "keep");
                    const preservedRef = keepFile.file.id;
                    swapFileActions(keepFile.file.id, newLeft, compareFile.file.id, newRight);
                    // Restore compare-this reference so images stay in their original positions
                    // (swapFileActions calls syncCompareThisFile which would change the reference)
                    setCompareThisFileId(preservedRef);
                  },
            },
            i({ class: "fadr fa-right-left text-lg" }),
          ),
        );
      })(),
      // Right: Compared image column
      div(
        { class: "flex-1 flex flex-col items-center min-w-0" },
        makeActionButtons(compareFile.file.id, decisions),
        div(
          {
            class:
              "flex-1 min-h-0 w-full bg-surface-card rounded-lg overflow-hidden p-2 border border-edge flex items-center justify-center",
          },
          makeMediaImg(compareFile, "right"),
        ),
        p(
          { class: "text-sm text-fg-3 mt-2 truncate max-w-full", title: compareFile.file.filename },
          compareFile.file.filename,
        ),
        p({ class: "text-xs text-fg-faint truncate max-w-full", title: compareFile.file.path }, getFolder(compareFile)),
      ),
    );

    // Metadata comparison table — fills remaining space with internal scroll
    const metaEl = div(
      {
        class: `${viewModeMetaClass(currentMode)} overflow-auto mx-6 mb-4 bg-surface-card rounded-lg border border-edge`,
      },
      div(
        { class: "grid grid-cols-3 px-4 py-2 bg-surface-inset border-b border-edge sticky top-0 z-10" },
        h4({ class: "text-sm font-medium text-fg-3" }, "Metadata Comparison"),
        span({ class: "text-sm font-medium text-fg-muted" }, "Left"),
        span({ class: "text-sm font-medium text-fg-muted" }, "Right"),
      ),
      div(
        { class: "divide-y divide-zinc-200 dark:divide-zinc-700" },
        // Data rows
        ...metaRows.map((row) => {
          const differs = row.keepVal !== row.compareVal;
          return div(
            {
              class: `grid grid-cols-3 px-4 py-1.5 ${differs ? "bg-amber-500/5" : ""}`,
            },
            span({ class: "text-fg-muted text-sm" }, row.label),
            span({ class: `text-fg-2 text-sm break-all ${differs ? "text-amber-300" : ""}` }, row.keepVal),
            span({ class: `text-fg-2 text-sm break-all ${differs ? "text-amber-300" : ""}` }, row.compareVal),
          );
        }),
      ),
    );

    container.appendChild(headerEl);
    if (frameStepperEl) container.appendChild(frameStepperEl);
    container.appendChild(imageArea);
    container.appendChild(metaEl);

    return container;
  };
}
