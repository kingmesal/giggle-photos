/**
 * Folders service: holds the RPC client for source-folder operations (initialised from mainview.ts)
 * and wraps each call. Without an RPC client (browser preview, E2E harness) every call throws
 * FoldersServiceError("RPC client not initialized"); the screen does not read until the service is ready.
 */
import { createStore, useStore } from "../external/store";
import { getLogger } from "./logger-service";

const log = getLogger("ui:folders");

export type FolderStatus = "added" | "scanning" | "ready" | "error";

/** ScanFolder as the UI sees it (dates are ISO strings from RPC). */
export interface ScanFolder {
  id: number;
  path: string;
  priority: number;
  status: FolderStatus;
  scanSubdirectories: boolean;
  includeVideos: boolean;
  imageCount: number;
  videoCount: number;
  totalSize: number;
  createdAt: string;
  updatedAt: string;
}

export interface FolderStats {
  folderCount: number;
  totalImages: number;
  totalVideos: number;
  totalSize: number;
}

export interface FolderUpdate {
  id: number;
  priority?: number;
  status?: FolderStatus;
  scanSubdirectories?: boolean;
  includeVideos?: boolean;
}

/** RPC client interface for folder operations (the object mainview.ts passes in). */
export interface FoldersRPC {
  listFolders: () => Promise<ScanFolder[]>;
  getFolderStats: () => Promise<FolderStats>;
  addFolder: (params: {
    path: string;
    priority?: number;
    scanSubdirectories?: boolean;
  }) => Promise<{ success: boolean; folder: ScanFolder }>;
  updateFolder: (params: FolderUpdate) => Promise<{ success: boolean; folder: ScanFolder }>;
  removeFolder: (params: { id: number }) => Promise<{ success: boolean }>;
  showFolderPicker: () => Promise<{ success: boolean; path: string | null }>;
  scanFolderQuick: (params: { id: number }) => Promise<{ success: boolean; folder: ScanFolder }>;
}

/** Thrown when a folder operation cannot run or fails. `message` is shown to the person. */
export class FoldersServiceError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "FoldersServiceError";
  }
}

const client = createStore<FoldersRPC | null>(null);

/** Initialize the folders service with an RPC client (null clears it). */
export function initFoldersService(rpc: FoldersRPC | null): void {
  client.set(rpc);
  log.debug("Folders service initialized", { ready: rpc !== null });
}

/** Whether an RPC client is set, re-rendering when that changes. */
export function useFoldersServiceReady(): boolean {
  return useStore(client) !== null;
}

/** Throws FoldersServiceError if no RPC client is set. */
export function assertFoldersServiceReady(): void {
  requireRpc();
}

function requireRpc(): FoldersRPC {
  const rpc = client.get();
  if (!rpc) throw new FoldersServiceError("RPC client not initialized");
  return rpc;
}

/** Run an RPC call; log and rethrow failures as FoldersServiceError with a readable message. */
async function call<T>(fallback: string, run: (rpc: FoldersRPC) => Promise<T>): Promise<T> {
  const rpc = requireRpc();
  try {
    return await run(rpc);
  } catch (error) {
    log.error(fallback, error);
    throw new FoldersServiceError(error instanceof Error && error.message ? error.message : fallback, {
      cause: error,
    });
  }
}

export interface FoldersData {
  folders: ScanFolder[];
  stats: FolderStats;
}

/** Load all folders and the summary stats. */
export function loadFoldersData(): Promise<FoldersData> {
  return call("Failed to load folders", async (rpc) => {
    const [folders, stats] = await Promise.all([rpc.listFolders(), rpc.getFolderStats()]);
    return { folders, stats };
  });
}

/** Show the native folder picker; resolves with the chosen path, or null if cancelled. */
export function pickFolder(): Promise<string | null> {
  return call("Failed to add folder", async (rpc) => {
    const result = await rpc.showFolderPicker();
    return result.success && result.path ? result.path : null;
  });
}

/** Add a folder; resolves with the new folder, or null if the backend did not add it. */
export function addFolder(path: string): Promise<ScanFolder | null> {
  return call("Failed to add folder", async (rpc) => {
    const result = await rpc.addFolder({ path });
    return result.success && result.folder ? result.folder : null;
  });
}

export function updateFolder(update: FolderUpdate): Promise<void> {
  return call("Failed to update folder", async (rpc) => {
    await rpc.updateFolder(update);
  });
}

export function removeFolder(id: number): Promise<void> {
  return call("Failed to remove folder", async (rpc) => {
    await rpc.removeFolder({ id });
  });
}

/** Quick scan (count files) of one folder. */
export function scanFolderQuick(id: number): Promise<void> {
  return call("Failed to scan folder", async (rpc) => {
    await rpc.scanFolderQuick({ id });
  });
}
