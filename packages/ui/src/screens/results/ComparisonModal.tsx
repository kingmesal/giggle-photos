/**
 * Full-screen side-by-side comparison: the compare reference on the left, the clicked file on the right,
 * keep/delete per side, swap, view modes, video frame stepping, and a metadata table highlighting differences.
 * Mount with key={`${left id}:${right id}`} so frame state resets when either file changes.
 */
import { ArrowLeftRight, Check, Film, Image, Trash2, X } from "lucide-react";
import { type ReactNode, useState } from "react";
import { useDocumentKeys } from "../../external/use-document-keys";
import type { FileDecisionAction, FileWithReviewContext } from "../../services/processing";
import { useFileServerPort } from "../../services/review-service";
import { buildMetaRows, folderOf, frameSteps, viewModeImageClass, viewModeMetaClass } from "./compare-meta";
import { FrameStepperBar, useFrameStepper } from "./FrameStepper";
import { imageUrl, videoFrameUrl } from "./lib";
import { type CompareViewMode, setCompareViewMode, useReviewPrefs } from "./prefs";
import { closeComparison, setFileAction, swapFileActions } from "./review-store";

const VIEW_MODES: Array<{ mode: CompareViewMode; label: string; iconSize: string }> = [
  { mode: "compact", label: "Compact", iconSize: "text-xs" },
  { mode: "balanced", label: "Balanced", iconSize: "text-sm" },
  { mode: "large", label: "Large", iconSize: "text-base" },
  { mode: "xl", label: "Extra Large", iconSize: "text-xl" },
];

function ActionButtons({ fileId, action }: { fileId: number; action: FileDecisionAction | undefined }): ReactNode {
  const buttons = [
    { action: "keep" as const, icon: <Check size="1em" />, label: "Keep", activeClass: "bg-emerald-600 text-white" },
    { action: "delete" as const, icon: <Trash2 size="1em" />, label: "Delete", activeClass: "bg-red-600 text-white" },
  ];
  return (
    <div className="flex items-center gap-1.5 mb-2">
      {buttons.map((b) => (
        <button
          key={b.action}
          type="button"
          className={`px-2 py-1 rounded text-xs font-medium flex items-center gap-1 ${
            action === b.action
              ? b.activeClass
              : "bg-surface-inset text-fg-muted hover:bg-surface-active hover:text-fg-2"
          }`}
          title={b.label}
          onClick={() => setFileAction(fileId, b.action)}
        >
          {b.icon}
          {b.label}
        </button>
      ))}
    </div>
  );
}

function MediaImage({ ctx, src }: { ctx: FileWithReviewContext; src: string }): ReactNode {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  if (!src || failedSrc === src) {
    return (
      <div className="w-full h-64 flex items-center justify-center bg-surface-inset rounded text-6xl text-fg-faint">
        {ctx.file.fileType === "video" ? <Film size="1em" /> : <Image size="1em" />}
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={ctx.file.filename}
      className="max-w-full max-h-full object-contain mx-auto"
      loading="lazy"
      onError={() => setFailedSrc(src)}
    />
  );
}

function Panel({
  ctx,
  action,
  src,
}: {
  ctx: FileWithReviewContext;
  action: FileDecisionAction | undefined;
  src: string;
}) {
  return (
    <div className="flex-1 flex flex-col items-center min-w-0">
      <ActionButtons fileId={ctx.file.id} action={action} />
      <div className="flex-1 min-h-0 w-full bg-surface-card rounded-lg overflow-hidden p-2 border border-edge flex items-center justify-center">
        <MediaImage ctx={ctx} src={src} />
      </div>
      <p className="text-sm text-fg-3 mt-2 truncate max-w-full" title={ctx.file.filename}>
        {ctx.file.filename}
      </p>
      <p className="text-xs text-fg-faint truncate max-w-full" title={ctx.file.path}>
        {folderOf(ctx)}
      </p>
    </div>
  );
}

export interface ComparisonModalProps {
  keepFile: FileWithReviewContext;
  compareFile: FileWithReviewContext;
  decisions: Map<number, FileDecisionAction>;
}

export function ComparisonModal({ keepFile, compareFile, decisions }: ComparisonModalProps): ReactNode {
  const port = useFileServerPort();
  const { compareViewMode: mode } = useReviewPrefs();
  useDocumentKeys((e) => {
    if (e.key === "Escape") closeComparison();
  });
  const anyVideo = keepFile.file.fileType === "video" || compareFile.file.fileType === "video";
  const frameUrl = (ctx: FileWithReviewContext, t: number) =>
    ctx.file.fileType === "video" ? videoFrameUrl(port, ctx.file.path, t) : null;
  const stepper = useFrameStepper(anyVideo ? frameSteps(keepFile, compareFile) : [0], (t) => [
    frameUrl(keepFile, t),
    frameUrl(compareFile, t),
  ]);
  const srcFor = (ctx: FileWithReviewContext) => frameUrl(ctx, stepper.shownTime) ?? imageUrl(port, ctx.file.path);

  const leftAction = decisions.get(keepFile.file.id);
  const rightAction = decisions.get(compareFile.file.id);
  const swapDisabled = leftAction === rightAction; // includes both undefined
  const swap = () => {
    // Swap only the actions; the files stay in their panels.
    const newLeft = rightAction ?? (leftAction === "keep" ? "delete" : "keep");
    const newRight = leftAction ?? (rightAction === "keep" ? "delete" : "keep");
    swapFileActions(keepFile.file.id, newLeft, compareFile.file.id, newRight, keepFile.file.id);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-black/80 backdrop-blur-sm overflow-hidden"
      role="dialog"
      aria-modal="true"
    >
      <div className="flex-shrink-0 flex items-center justify-between px-6 py-3 bg-surface border-b border-edge">
        <h3 className="text-lg font-semibold text-fg">{anyVideo ? "Compare Videos" : "Compare Images"}</h3>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1">
            {VIEW_MODES.map((v) => (
              <button
                key={v.mode}
                type="button"
                className={`w-8 h-7 rounded flex items-center justify-center ${
                  mode === v.mode
                    ? "bg-blue-600 text-white"
                    : "bg-surface-inset text-fg-muted hover:bg-surface-active hover:text-fg-2"
                }`}
                title={v.label}
                onClick={() => setCompareViewMode(v.mode)}
              >
                <Image size="1em" className={v.iconSize} />
              </button>
            ))}
          </div>
          <button
            type="button"
            className="px-3 py-1.5 rounded text-sm font-medium bg-red-600 hover:bg-red-500 text-white flex items-center gap-2"
            onClick={closeComparison}
          >
            <X size="1em" />
            Close
          </button>
        </div>
      </div>
      {anyVideo && stepper.steps.length > 1 && <FrameStepperBar stepper={stepper} />}
      <div className={`${viewModeImageClass(mode)} flex items-stretch gap-0 px-6 py-4 bg-surface`}>
        <Panel ctx={keepFile} action={leftAction} src={srcFor(keepFile)} />
        <div className="flex-shrink-0 flex items-start pt-0 px-2">
          <button
            type="button"
            className={
              swapDisabled
                ? "p-2 rounded-full bg-surface-inset text-fg-faint cursor-not-allowed opacity-50"
                : "p-2 rounded-full bg-surface-inset hover:bg-surface-active text-fg-3 hover:text-black dark:hover:text-white"
            }
            title={swapDisabled ? "Both files have the same action" : "Swap actions"}
            disabled={swapDisabled}
            onClick={swap}
          >
            <ArrowLeftRight size="1em" className="text-lg" />
          </button>
        </div>
        <Panel ctx={compareFile} action={rightAction} src={srcFor(compareFile)} />
      </div>
      <div
        className={`${viewModeMetaClass(mode)} overflow-auto mx-6 mb-4 bg-surface-card rounded-lg border border-edge`}
      >
        <div className="grid grid-cols-3 px-4 py-2 bg-surface-inset border-b border-edge sticky top-0 z-10">
          <h4 className="text-sm font-medium text-fg-3">Metadata Comparison</h4>
          <span className="text-sm font-medium text-fg-muted">Left</span>
          <span className="text-sm font-medium text-fg-muted">Right</span>
        </div>
        <div className="divide-y divide-zinc-200 dark:divide-zinc-700">
          {buildMetaRows(keepFile, compareFile).map((row) => {
            const differs = row.keepVal !== row.compareVal;
            const val = `text-fg-2 text-sm break-all ${differs ? "text-amber-300" : ""}`;
            return (
              <div key={row.label} className={`grid grid-cols-3 px-4 py-1.5 ${differs ? "bg-amber-500/5" : ""}`}>
                <span className="text-fg-muted text-sm">{row.label}</span>
                <span className={val}>{row.keepVal}</span>
                <span className={val}>{row.compareVal}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
