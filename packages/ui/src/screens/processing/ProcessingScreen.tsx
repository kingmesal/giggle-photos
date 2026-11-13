/** Processing screen (RFD-004): step-by-step progress through the deduplication pipeline. */
import { CircleAlert, FolderOpen, FolderPlus, LoaderCircle } from "lucide-react";
import type { ReactNode } from "react";
import { useRead } from "../../external/use-read";
import {
  hasProcessingRPC,
  loadProcessingState,
  type ProcessingViewState,
  useProcessingViewState,
} from "../../services/processing-view-service";
import { navigateTo } from "../../state/navigation";
import { ClipModelBanner } from "./ClipModelBanner";
import { FfmpegWarning } from "./FfmpegWarning";
import { HeaderControls } from "./HeaderControls";
import { INLINE_ICON } from "./icons";
import { PipelinePanel } from "./PipelinePanel";

function NoFolders(): ReactNode {
  return (
    <div className="bg-surface-card rounded-xl border border-edge p-12 text-center">
      <FolderOpen size="1em" className="text-5xl text-zinc-300 dark:text-zinc-600 mb-4 mx-auto" aria-hidden="true" />
      <h3 className="text-lg font-medium text-fg mb-2">No Folders Configured</h3>
      <p className="text-fg-muted mb-6">Add folders to scan for images and videos before processing.</p>
      <button
        type="button"
        className="px-6 py-3 rounded-lg bg-gradient-to-r from-blue-600 to-violet-600 hover:from-blue-500 hover:to-violet-500 text-white font-medium transition-all flex items-center gap-3 mx-auto"
        onClick={() => navigateTo("folders")}
      >
        <FolderPlus size="1em" aria-hidden="true" />
        Add Folders
      </button>
    </div>
  );
}

function PipelineSection({ view }: { view: ProcessingViewState }): ReactNode {
  const { loading, pipelineState: state, health } = view;
  if (loading && state === null) {
    return (
      <div className="flex items-center justify-center py-12 text-fg-muted">
        <LoaderCircle size="1em" className="animate-spin text-2xl mr-3" aria-hidden="true" />
        Loading...
      </div>
    );
  }
  // The pipeline is hidden while ffprobe is missing (the FFmpeg banner explains why)
  if (health && !health.ffprobe.available) return null;
  if (!state?.hasFolders) return <NoFolders />;
  return <PipelinePanel state={state} status={view.status} summary={view.summary} isPaused={view.isPaused} />;
}

export function ProcessingScreen(): ReactNode {
  const view = useProcessingViewState();
  // Re-load the pipeline state each time the screen is shown (writes into the service's store).
  useRead("processing-state", loadProcessingState, { skip: !hasProcessingRPC() });

  return (
    <div className="h-full flex flex-col">
      <header className="flex-shrink-0 bg-zinc-50/95 dark:bg-zinc-900/95 backdrop-blur border-b border-edge px-6 py-4 z-10">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold text-fg">Processing Pipeline</h2>
            <p className="text-sm text-fg-muted mt-0.5">Step-by-step progress through deduplication stages</p>
          </div>
          <HeaderControls view={view} />
        </div>
      </header>
      <div className="flex-1 overflow-auto p-6">
        {view.error && (
          <div className="mb-6 p-4 rounded-lg bg-red-500/20 border border-red-500/30 text-accent-red text-sm">
            <CircleAlert size="1em" className={`${INLINE_ICON} mr-2`} aria-hidden="true" />
            {view.error}
          </div>
        )}
        {view.health && !view.health.ffprobe.available && <FfmpegWarning health={view.health} />}
        <ClipModelBanner />
        <PipelineSection view={view} />
      </div>
    </div>
  );
}
