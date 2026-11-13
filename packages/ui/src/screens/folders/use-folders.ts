/**
 * useFolders — all state and actions of the Folders screen.
 *
 * Data comes from one useRead keyed on a local version, bumped after each mutation so it re-reads.
 * Toggles are applied optimistically as patches tied to the data they were made against: once a new
 * answer arrives the patches no longer apply. Folders being quick-scanned show status "scanning".
 * Every person-triggered call runs through one useAction, so `error` is the last call's failure.
 */
import { useState } from "react";
import { useAction } from "../../external/use-action";
import { useRead } from "../../external/use-read";
import {
  addFolder,
  assertFoldersServiceReady,
  type FolderStats,
  type FoldersData,
  loadFoldersData,
  pickFolder,
  removeFolder,
  type ScanFolder,
  scanFolderQuick,
  updateFolder,
  useFoldersServiceReady,
} from "../../services/folders-service";
import { notifyReviewDataChanged } from "../../state/review-events";
import { nextSort, type SortKey, type SortState, sortFolders } from "./format";

export interface RemoveTarget {
  id: number;
  path: string;
}

export interface FoldersModel {
  /** Folders, sorted, with optimistic changes applied. */
  folders: ScanFolder[];
  stats: FolderStats;
  /** A (re-)read of the folder list is in flight. */
  loading: boolean;
  error: string | null;
  sort: SortState;
  removeTarget: RemoveTarget | null;
  sortBy: (key: SortKey) => void;
  addFolder: () => void;
  setPriority: (id: number, priority: number) => void;
  setScanSubdirectories: (id: number, enabled: boolean) => void;
  setIncludeVideos: (id: number, enabled: boolean) => void;
  quickScan: (id: number) => void;
  requestRemove: (folder: RemoveTarget) => void;
  cancelRemove: () => void;
  confirmRemove: () => void;
}

const EMPTY_STATS: FolderStats = { folderCount: 0, totalImages: 0, totalVideos: 0, totalSize: 0 };

interface Patches {
  base: FoldersData | undefined;
  byId: Record<number, Partial<ScanFolder>>;
}

export function useFolders(): FoldersModel {
  const ready = useFoldersServiceReady();
  const [version, setVersion] = useState(0);
  const read = useRead(`folders:${version}`, () => loadFoldersData(), { skip: !ready });
  const [patches, setPatches] = useState<Patches>({ base: undefined, byId: {} });
  const [scanning, setScanning] = useState<ReadonlySet<number>>(() => new Set());
  const [sort, setSort] = useState<SortState>({ by: "priority", direction: "asc" });
  const [removeTarget, setRemoveTarget] = useState<RemoveTarget | null>(null);
  const op = useAction((task: () => Promise<void>) => task());

  const data = read.value;
  const reload = (): void => setVersion((v) => v + 1);

  const patch = (id: number, change: Partial<ScanFolder>): void =>
    setPatches((prev) => {
      const byId = prev.base === data ? prev.byId : {};
      return { base: data, byId: { ...byId, [id]: { ...byId[id], ...change } } };
    });

  const scan = async (id: number): Promise<void> => {
    setScanning((prev) => new Set(prev).add(id));
    try {
      await scanFolderQuick(id);
    } finally {
      setScanning((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      reload();
    }
  };

  const activePatches = patches.base === data ? patches.byId : {};
  const folders = sortFolders(
    (data?.folders ?? []).map((folder) => ({
      ...folder,
      ...activePatches[folder.id],
      ...(scanning.has(folder.id) ? { status: "scanning" as const } : {}),
    })),
    sort,
  );

  return {
    folders,
    stats: data?.stats ?? EMPTY_STATS,
    loading: read.loading,
    error: op.failure?.message ?? read.failure?.message ?? null,
    sort,
    removeTarget,
    sortBy: (key) => setSort((current) => nextSort(current, key)),
    addFolder: () => {
      void op.run(async () => {
        const path = await pickFolder();
        if (!path) return; // cancelled
        const folder = await addFolder(path);
        reload();
        if (folder) await scan(folder.id); // auto quick scan the new folder
      });
    },
    setPriority: (id, priority) => {
      void op.run(async () => {
        await updateFolder({ id, priority });
        reload();
      });
    },
    setScanSubdirectories: (id, enabled) => {
      patch(id, { scanSubdirectories: enabled });
      void op.run(async () => {
        try {
          await updateFolder({ id, scanSubdirectories: enabled });
        } catch (error) {
          reload(); // revert the optimistic change
          throw error;
        }
      });
    },
    setIncludeVideos: (id, enabled) => {
      patch(id, { includeVideos: enabled });
      void op.run(async () => {
        try {
          await updateFolder({ id, includeVideos: enabled });
        } catch (error) {
          reload();
          throw error;
        }
        if (!enabled) reload(); // video rows were deleted: counts changed
      });
    },
    quickScan: (id) => {
      void op.run(() => scan(id));
    },
    requestRemove: (folder) => {
      if (!ready) {
        void op.run(async () => assertFoldersServiceReady());
        return;
      }
      setRemoveTarget(folder);
    },
    cancelRemove: () => setRemoveTarget(null),
    confirmRemove: () => {
      const target = removeTarget;
      setRemoveTarget(null);
      if (!target) return;
      void op.run(async () => {
        await removeFolder(target.id);
        reload();
        notifyReviewDataChanged(); // cached duplicate groups may include the removed folder's files
      });
    },
  };
}
