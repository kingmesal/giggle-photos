/**
 * Google Takeout summary under the scanning step (RFD-003): what was found, what linked, and
 * drill-down lists of sidecars and media that did not (loaded on demand).
 */
import { type ReactNode, useState } from "react";
import { useAction } from "../../external/use-action";
import { loadTakeoutReport, type TakeoutStageStats } from "../../services/takeout-service";

const METHOD_LABELS: Record<string, string> = {
  name_exact: "by name",
  name_truncated: "by truncated name",
  title: "by title",
  edited_name: "edited copy",
  album_reference: "album reference",
};

function PathList({ title, items, total }: { title: string; items: { id: number; path: string }[]; total: number }) {
  return (
    <div className="mt-2">
      <div className="text-xs font-medium text-fg-muted">
        {`${title} (${total}${items.length < total ? `, first ${items.length} shown` : ""})`}
      </div>
      {items.length === 0 ? (
        <div className="text-xs text-fg-faint">None</div>
      ) : (
        <div className="max-h-40 overflow-y-auto text-xs font-mono text-fg-3">
          {items.map((item) => (
            <div key={item.id} className="truncate">
              {item.path}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function TakeoutReportPanel({ takeout }: { takeout: TakeoutStageStats }): ReactNode {
  const [open, setOpen] = useState(false);
  const report = useAction(loadTakeoutReport);
  const s = takeout.summary;
  if (takeout.roots === 0 && takeout.warnings.length === 0) {
    return <div className="text-sm text-fg-faint mt-2">No Google Takeout found in the scanned folders.</div>;
  }
  const methods = s
    ? Object.entries(s.byMethod)
        .map(([m, n]) => `${METHOD_LABELS[m] ?? m}: ${n}`)
        .join(" · ")
    : "";
  const toggle = async (): Promise<void> => {
    if (open) return setOpen(false);
    await report.run();
    setOpen(true);
  };
  const loaded = report.value ?? null;
  return (
    <div className="mt-2 text-sm">
      {takeout.warnings.map((w) => (
        <div key={w} className="text-accent-amber">
          {w}
        </div>
      ))}
      {s && (
        <div className="space-y-0.5">
          <div>{`Google Takeout: ${s.folders.year} year folders, ${s.folders.album} albums, ${s.folders.special} special`}</div>
          <div>{`Sidecars linked: ${s.mediaSidecarsMatched} of ${s.sidecars.media}${methods ? ` (${methods})` : ""}`}</div>
          <div className={s.mediaSidecarsUnmatched + s.mediaWithoutSidecar > 0 ? "text-accent-amber" : ""}>
            {`Unmatched sidecars: ${s.mediaSidecarsUnmatched} · Media without a sidecar: ${s.mediaWithoutSidecar}`}
          </div>
          <div>{`Pairs: ${s.pairs.motion} motion/live, ${s.pairs.edited} original + edited`}</div>
          <button
            type="button"
            className="mt-1 text-xs underline text-accent-blue"
            disabled={report.pending}
            onClick={() => void toggle()}
          >
            {open ? "Hide lists" : "Show unmatched files"}
          </button>
          {open && !loaded && <div className="text-xs text-fg-faint">Report unavailable.</div>}
          {open && loaded && (
            <div>
              <PathList
                title="Unmatched sidecars"
                items={loaded.unmatchedSidecars}
                total={loaded.summary.mediaSidecarsUnmatched}
              />
              <PathList
                title="Media without a sidecar"
                items={loaded.mediaWithoutSidecar}
                total={loaded.summary.mediaWithoutSidecar}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
