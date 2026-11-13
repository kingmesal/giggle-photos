/** Folders screen: manage the source folders to scan (RFD-004 port of the Sigment FoldersView). */
import { CircleAlert, FolderPlus, Info } from "lucide-react";
import type { ReactElement } from "react";
import { FolderList } from "./FolderList";
import { ICON } from "./format";
import { RemoveFolderDialog } from "./RemoveFolderDialog";
import { StatsCards } from "./StatsCards";
import { useFolders } from "./use-folders";

export function FoldersScreen(): ReactElement {
  const model = useFolders();
  return (
    <div className="h-full flex flex-col">
      <header className="flex-shrink-0 bg-surface border-b border-edge px-6 py-4 z-10">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold text-fg">Source Folders</h2>
            <p className="text-sm text-fg-muted mt-0.5">Manage folders to scan for images and videos</p>
          </div>
          <button
            type="button"
            className="px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium transition-colors flex items-center gap-2"
            onClick={model.addFolder}
          >
            <FolderPlus size="1em" className={ICON} />
            Add Folder
          </button>
        </div>
      </header>
      <div className="flex-1 overflow-auto p-6">
        {model.error && (
          <div
            role="alert"
            className="mb-4 p-4 rounded-lg bg-red-500/20 border border-red-500/30 text-accent-red text-sm"
          >
            <CircleAlert size="1em" className={`${ICON} mr-2`} />
            {model.error}
          </div>
        )}
        <StatsCards stats={model.stats} />
        <div className="bg-zinc-100/50 dark:bg-zinc-800/50 rounded-lg border border-zinc-200/50 dark:border-zinc-700/50 p-4 mb-4 flex items-start gap-3">
          <Info size="1em" className={`${ICON} text-blue-400 mt-0.5 flex-shrink-0`} />
          <div className="text-sm">
            <p className="text-fg-3 font-medium">Folder Priority for Duplicate Resolution</p>
            <p className="text-fg-faint mt-1">
              When duplicates are found, files from higher priority folders will be suggested to keep. Click the
              'Folder' column header to sort by name or priority. You can always override suggestions when reviewing
              duplicates.
            </p>
          </div>
        </div>
        <FolderList
          folders={model.folders}
          loading={model.loading}
          sort={model.sort}
          onSort={model.sortBy}
          actions={model}
        />
      </div>
      {model.removeTarget && (
        <RemoveFolderDialog
          path={model.removeTarget.path}
          onCancel={model.cancelRemove}
          onConfirm={model.confirmRemove}
        />
      )}
    </div>
  );
}
