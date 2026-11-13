/**
 * The group's file grid. Small groups render plainly; large ones (thousands of thumbnails) are virtualised
 * by row with @tanstack/react-virtual, so only the visible rows are in the DOM.
 */
import { useVirtualizer } from "@tanstack/react-virtual";
import { type ReactNode, useRef } from "react";
import type { FileDecisionAction, FileWithReviewContext } from "../../services/processing";
import { ImageCard } from "./ImageCard";
import { computeTimeDiff } from "./lib";
import { type GridSize, gridColsClass, gridColumns } from "./prefs";
import { openComparison, setCompareThis, toggleFileAction } from "./review-store";

/** Groups up to this size render without virtualisation. */
export const VIRTUALIZE_AFTER = 120;

export interface ThumbnailGridProps {
  files: FileWithReviewContext[];
  decisions: Map<number, FileDecisionAction>;
  suggestedKeepId: number | null;
  compareThisId: number | null;
  keepCount: number;
  gridSize: GridSize;
}

function Card({
  ctx,
  props,
  keepFile,
}: {
  ctx: FileWithReviewContext;
  props: ThumbnailGridProps;
  keepFile: FileWithReviewContext | null;
}) {
  const isSuggestedKeep = ctx.file.id === props.suggestedKeepId;
  const isCompareThis = ctx.file.id === props.compareThisId;
  return (
    <ImageCard
      fileCtx={ctx}
      action={props.decisions.get(ctx.file.id)}
      onToggle={toggleFileAction}
      onCompare={openComparison}
      onSetCompareThis={setCompareThis}
      isKeep={isSuggestedKeep}
      disableCompare={isCompareThis || props.compareThisId === null}
      timeDiff={!isSuggestedKeep && keepFile ? computeTimeDiff(ctx, keepFile) : null}
      isCompareThis={isCompareThis}
      keepCount={props.keepCount}
    />
  );
}

/** Suggested keep first, then by id. */
function sortFiles(files: FileWithReviewContext[], keepId: number | null): FileWithReviewContext[] {
  return [...files].sort((a, b) => {
    if (a.file.id === keepId) return -1;
    if (b.file.id === keepId) return 1;
    return a.file.id - b.file.id;
  });
}

function VirtualGrid({
  sorted,
  props,
  keepFile,
}: {
  sorted: FileWithReviewContext[];
  props: ThumbnailGridProps;
  keepFile: FileWithReviewContext | null;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const columns = gridColumns(props.gridSize);
  const rowCount = Math.ceil(sorted.length / columns);
  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => (scrollRef.current?.clientWidth ?? 1200) / columns + 72,
    overscan: 2,
  });
  return (
    <div ref={scrollRef} className="flex-1 overflow-auto p-4">
      <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((row) => (
          <div
            key={row.key}
            data-index={row.index}
            ref={virtualizer.measureElement}
            className={`absolute left-0 top-0 w-full grid gap-4 pb-4 ${gridColsClass(props.gridSize)}`}
            style={{ transform: `translateY(${row.start}px)` }}
          >
            {sorted.slice(row.index * columns, row.index * columns + columns).map((ctx) => (
              <Card key={ctx.file.id} ctx={ctx} props={props} keepFile={keepFile} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function ThumbnailGrid(props: ThumbnailGridProps): ReactNode {
  const sorted = sortFiles(props.files, props.suggestedKeepId);
  const keepFile = props.suggestedKeepId
    ? (props.files.find((f) => f.file.id === props.suggestedKeepId) ?? null)
    : null;
  if (sorted.length > VIRTUALIZE_AFTER) {
    return <VirtualGrid key={props.gridSize} sorted={sorted} props={props} keepFile={keepFile} />;
  }
  return (
    <div className="flex-1 overflow-auto p-4">
      <div className={`grid gap-4 ${gridColsClass(props.gridSize)}`}>
        {sorted.map((ctx) => (
          <Card key={ctx.file.id} ctx={ctx} props={props} keepFile={keepFile} />
        ))}
      </div>
    </div>
  );
}
