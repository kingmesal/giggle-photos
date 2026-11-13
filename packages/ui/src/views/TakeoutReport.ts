/**
 * Google Takeout summary shown under the scanning step (RFD-003): what was found, what linked,
 * and drill-down lists of sidecars and media that did not. Interim Sigment UI (RFD-004 replaces it).
 */
import { signal } from "sigment";
import { loadTakeoutReport, type TakeoutReport, type TakeoutStageStats } from "../services/takeout-service";

const METHOD_LABELS: Record<string, string> = {
  name_exact: "by name",
  name_truncated: "by truncated name",
  title: "by title",
  edited_name: "edited copy",
  album_reference: "album reference",
};

const [getReport, setReport] = signal<TakeoutReport | null>(null);
const [getOpen, setOpen] = signal(false);

async function toggleLists(): Promise<void> {
  if (getOpen()) return setOpen(false);
  setReport(await loadTakeoutReport());
  setOpen(true);
}

function pathList(title: string, items: { id: number; path: string }[], total: number) {
  return div(
    { class: "mt-2" },
    div(
      { class: "text-xs font-medium text-fg-muted" },
      `${title} (${total}${items.length < total ? `, first ${items.length} shown` : ""})`,
    ),
    items.length === 0
      ? div({ class: "text-xs text-fg-faint" }, "None")
      : div(
          { class: "max-h-40 overflow-y-auto text-xs font-mono text-fg-3" },
          ...items.map((item) => div({ class: "truncate" }, item.path)),
        ),
  );
}

export function TakeoutReportPanel(takeout: TakeoutStageStats) {
  const s = takeout.summary;
  if (takeout.roots === 0 && takeout.warnings.length === 0) {
    return div({ class: "text-sm text-fg-faint mt-2" }, "No Google Takeout found in the scanned folders.");
  }
  const methods = s
    ? Object.entries(s.byMethod)
        .map(([m, n]) => `${METHOD_LABELS[m] ?? m}: ${n}`)
        .join(" · ")
    : "";
  return div(
    { class: "mt-2 text-sm" },
    ...takeout.warnings.map((w) => div({ class: "text-accent-amber" }, w)),
    s
      ? div(
          { class: "space-y-0.5" },
          div(
            {},
            `Google Takeout: ${s.folders.year} year folders, ${s.folders.album} albums, ${s.folders.special} special`,
          ),
          div({}, `Sidecars linked: ${s.mediaSidecarsMatched} of ${s.sidecars.media}${methods ? ` (${methods})` : ""}`),
          div(
            { class: s.mediaSidecarsUnmatched + s.mediaWithoutSidecar > 0 ? "text-accent-amber" : "" },
            `Unmatched sidecars: ${s.mediaSidecarsUnmatched} · Media without a sidecar: ${s.mediaWithoutSidecar}`,
          ),
          div({}, `Pairs: ${s.pairs.motion} motion/live, ${s.pairs.edited} original + edited`),
          button({ class: "mt-1 text-xs underline text-accent-blue", onclick: () => void toggleLists() }, () =>
            getOpen() ? "Hide lists" : "Show unmatched files",
          ),
          () => {
            const report = getReport();
            if (!getOpen()) return null;
            if (!report) return div({ class: "text-xs text-fg-faint" }, "Report unavailable.");
            return div(
              {},
              pathList("Unmatched sidecars", report.unmatchedSidecars, report.summary.mediaSidecarsUnmatched),
              pathList("Media without a sidecar", report.mediaWithoutSidecar, report.summary.mediaWithoutSidecar),
            );
          },
        )
      : null,
  );
}
