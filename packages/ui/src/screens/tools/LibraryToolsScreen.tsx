/**
 * Library Tools (RFD-007): standalone helpers you can run over the library any time, independent of
 * duplicate checking. The two XMP tools write `<file>.xmp` sidecars (originals untouched); the
 * third removes Google JSON files after an import. One runs at a time, in the background.
 */
import { CircleCheck, FileCode, FileJson, FileX, LoaderCircle } from "lucide-react";
import { type ReactNode, useState } from "react";
import { useAction } from "../../external/use-action";
import { useInterval } from "../../external/use-interval";
import { useRead } from "../../external/use-read";
import {
  getLibraryToolJob,
  type LibraryTool,
  type LibraryToolJob,
  loadLibraryToolsPreview,
  type RemoveJsonOptions,
  startLibraryTool,
} from "../../services/library-tools-service";
import { GuessedDates } from "./GuessedDates";
import { RemoveJsonDialog } from "./RemoveJsonDialog";
import { Stat, ToolCard } from "./ToolCard";

const TOOL_NAMES: Record<LibraryTool, string> = {
  xmp_from_files: "Write XMP from file metadata",
  json_to_xmp: "Convert Google JSON to XMP",
  remove_json: "Remove Google JSON files",
};

function JobStatus({ job }: { job: LibraryToolJob }): ReactNode {
  const name = job.tool ? TOOL_NAMES[job.tool] : "Tool";
  if (job.running) {
    const pct = job.total > 0 ? Math.round((job.done / job.total) * 100) : 0;
    return (
      <div className="mb-4 p-3 rounded-lg border border-blue-500/30 bg-blue-500/10 text-sm" role="status">
        <LoaderCircle size="1em" className="inline animate-spin mr-2" />
        {`${name}: ${job.done.toLocaleString()} of ${job.total.toLocaleString()} (${pct}%)`}
      </div>
    );
  }
  if (job.error) return <div className="mb-4 p-3 rounded-lg bg-red-500/20 text-accent-red text-sm">{job.error}</div>;
  const r = job.result;
  if (!r) return null;
  const parts =
    r.removed !== undefined
      ? [`${r.removed.toLocaleString()} removed`]
      : [`${(r.written ?? 0).toLocaleString()} written`, `${(r.unchanged ?? 0).toLocaleString()} already up to date`];
  if (r.skipped) parts.push(`${r.skipped} skipped (another app's sidecar)`);
  if (r.failed) parts.push(`${r.failed} failed`);
  return (
    <div className="mb-4 p-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-sm" role="status">
      <p>
        <CircleCheck size="1em" className="inline mr-2 text-accent-green" />
        {`${name}: ${parts.join(", ")}.`}
      </p>
      {r.errors.length > 0 && (
        <ul className="mt-1 text-xs text-accent-amber font-mono max-h-32 overflow-y-auto">
          {r.errors.slice(0, 50).map((e) => (
            <li key={e.path} className="truncate" title={e.error}>{`${e.path}: ${e.error}`}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-start gap-2 text-sm text-fg-3 cursor-pointer">
      <input type="checkbox" className="mt-0.5" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

export function LibraryToolsScreen(): ReactNode {
  const [version, setVersion] = useState(0);
  const [job, setJob] = useState<LibraryToolJob | null>(null);
  const [options, setOptions] = useState<RemoveJsonOptions>({});
  const [confirmRemove, setConfirmRemove] = useState(false);
  const preview = useRead(`library-tools:${version}`, () => loadLibraryToolsPreview());
  const start = useAction((tool: LibraryTool, opts?: RemoveJsonOptions) => startLibraryTool(tool, opts));
  useInterval(
    async () => {
      const next = await getLibraryToolJob();
      setJob(next);
      if (next && !next.running) setVersion((v) => v + 1);
    },
    job?.running ? 1000 : null,
  );
  const run = async (tool: LibraryTool, opts?: RemoveJsonOptions) => {
    const started = await start.run(tool, opts);
    if (started) setJob(started);
  };
  const p = preview.value;
  const busy = job?.running === true || start.pending;
  const runningTool = busy ? job?.tool : null;
  const removeCount = p
    ? p.removeJson.converted +
      (options.includeNotConverted ? p.removeJson.notConverted : 0) +
      (options.includeAlbumAndOther ? p.removeJson.albumAndOther : 0)
    : 0;
  return (
    <div className="h-full flex flex-col">
      <header className="flex-shrink-0 bg-surface border-b border-edge px-6 py-4">
        <h2 className="text-xl font-semibold text-fg">Library Tools</h2>
        <p className="text-sm text-fg-muted mt-0.5">
          Run any time, separate from duplicate checking. The XMP tools never change your original files.
        </p>
      </header>
      <div className="flex-1 overflow-auto p-6">
        {job && <JobStatus job={job} />}
        {start.failure && <p className="mb-4 text-sm text-accent-red">{start.failure.message}</p>}
        {!p ? (
          <p className="text-sm text-fg-muted">
            <LoaderCircle size="1em" className="inline animate-spin mr-2" />
            Looking at the library…
          </p>
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 items-stretch">
            <ToolCard
              icon={<FileCode size={18} />}
              title={TOOL_NAMES.xmp_from_files}
              description="An .xmp sidecar for every photo and video with its own date, GPS and camera. A file with no date gets one from its name or folder (a year-only folder means July 1, a month the 15th)."
              stats={
                <>
                  <Stat label="Photos and videos" value={p.xmpFromFiles.files} />
                  <Stat label="Own date" value={p.xmpFromFiles.embeddedDate} />
                  <Stat label="Date from file name" value={p.xmpFromFiles.filenameDate} />
                  <Stat label="Date from folder" value={p.xmpFromFiles.folderDate} />
                  <Stat label="No date found" value={p.xmpFromFiles.noDate} />
                  <Stat label="With GPS" value={p.xmpFromFiles.withGps} />
                </>
              }
              runLabel="Write Sidecars"
              disabled={busy || p.xmpFromFiles.files === 0}
              running={runningTool === "xmp_from_files"}
              onRun={() => void run("xmp_from_files")}
            >
              <GuessedDates
                guessed={p.xmpFromFiles.guessed}
                total={p.xmpFromFiles.filenameDate + p.xmpFromFiles.folderDate}
              />
            </ToolCard>
            <ToolCard
              icon={<FileJson size={18} />}
              title={TOOL_NAMES.json_to_xmp}
              description="Google Takeout's JSON to standard XMP next to each file: capture time, GPS, description, favourite (5 stars) and people. Google's data wins over the file's own; the JSON stays."
              stats={
                <>
                  <Stat label="Photos and videos" value={p.jsonToXmp.files} />
                  <Stat label="Inherited (edits, motion videos)" value={p.jsonToXmp.inherited} />
                  <Stat label="With date" value={p.jsonToXmp.withDate} />
                  <Stat label="With GPS" value={p.jsonToXmp.withGps} />
                  <Stat label="With description" value={p.jsonToXmp.withDescription} />
                  <Stat label="With people" value={p.jsonToXmp.withPeople} />
                  <Stat label="Favourites" value={p.jsonToXmp.favorites} />
                </>
              }
              runLabel="Convert to XMP"
              disabled={busy || p.jsonToXmp.files === 0}
              running={runningTool === "json_to_xmp"}
              onRun={() => void run("json_to_xmp")}
            />
            <ToolCard
              icon={<FileX size={18} />}
              title={TOOL_NAMES.remove_json}
              description="After importing: remove Google's JSON files whose data is already in XMP. immich-go's Google Photos import needs them, so run this afterwards."
              stats={
                <>
                  <Stat label="Converted to XMP" value={p.removeJson.converted} />
                  <Stat label="Not converted yet" value={p.removeJson.notConverted} />
                  <Stat label="Album and other JSON" value={p.removeJson.albumAndOther} />
                </>
              }
              runLabel={`Remove ${removeCount.toLocaleString()} JSON Files`}
              disabled={busy || removeCount === 0}
              running={runningTool === "remove_json"}
              onRun={() => setConfirmRemove(true)}
            >
              <div className="space-y-1">
                <Check
                  label="Also photos' JSON not converted yet (their Google data is lost)"
                  checked={options.includeNotConverted === true}
                  onChange={(v) => setOptions((o) => ({ ...o, includeNotConverted: v }))}
                />
                <Check
                  label="Also album, album-reference and unmatched JSON"
                  checked={options.includeAlbumAndOther === true}
                  onChange={(v) => setOptions((o) => ({ ...o, includeAlbumAndOther: v }))}
                />
              </div>
            </ToolCard>
          </div>
        )}
      </div>
      {confirmRemove && p && (
        <RemoveJsonDialog
          count={removeCount}
          mode={p.removeJson.mode}
          onCancel={() => setConfirmRemove(false)}
          onConfirm={() => {
            setConfirmRemove(false);
            void run("remove_json", options);
          }}
        />
      )}
    </div>
  );
}
