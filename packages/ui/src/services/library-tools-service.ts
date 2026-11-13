/**
 * Library Tools (RFD-007): previews and the background job for the three tools. Without RPC (dev
 * preview / E2E) the previews are empty and running is unavailable.
 */

/** Mirrors core/desktop types (the UI only talks to core over RPC). */
export type LibraryTool = "xmp_from_files" | "json_to_xmp" | "remove_json";

export interface GuessedDate {
  fileId: number;
  path: string;
  fileType: "image" | "video";
  takenAt: string;
  precision: "second" | "day" | "month" | "year";
  source: "filename" | "folder";
  detail: string;
}

export interface LibraryToolsPreview {
  xmpFromFiles: {
    files: number;
    embeddedDate: number;
    filenameDate: number;
    folderDate: number;
    noDate: number;
    withGps: number;
    guessed: GuessedDate[];
    listLimit: number;
  };
  jsonToXmp: {
    files: number;
    inherited: number;
    withDate: number;
    withGps: number;
    withDescription: number;
    withPeople: number;
    favorites: number;
  };
  removeJson: {
    converted: number;
    notConverted: number;
    albumAndOther: number;
    mode: "quarantine" | "trash" | "delete";
  };
}

export interface RemoveJsonOptions {
  includeNotConverted?: boolean;
  includeAlbumAndOther?: boolean;
}

export interface LibraryToolJob {
  tool: LibraryTool | null;
  running: boolean;
  done: number;
  total: number;
  /** Sidecar tools: written/unchanged/skipped/failed. Removal: removed/failed/mode. */
  result: {
    written?: number;
    unchanged?: number;
    skipped?: number;
    removed?: number;
    mode?: string;
    failed: number;
    errors: { path: string; error: string }[];
  } | null;
  error: string | null;
}

export interface LibraryToolsRPC {
  getLibraryToolsPreview: () => Promise<LibraryToolsPreview>;
  startLibraryTool: (tool: LibraryTool, options?: RemoveJsonOptions) => Promise<LibraryToolJob>;
  getLibraryToolJob: () => Promise<LibraryToolJob>;
}

const EMPTY: LibraryToolsPreview = {
  xmpFromFiles: {
    files: 0,
    embeddedDate: 0,
    filenameDate: 0,
    folderDate: 0,
    noDate: 0,
    withGps: 0,
    guessed: [],
    listLimit: 500,
  },
  jsonToXmp: { files: 0, inherited: 0, withDate: 0, withGps: 0, withDescription: 0, withPeople: 0, favorites: 0 },
  removeJson: { converted: 0, notConverted: 0, albumAndOther: 0, mode: "quarantine" },
};

let rpcClient: LibraryToolsRPC | null = null;

export function initLibraryToolsService(rpc: LibraryToolsRPC): void {
  rpcClient = rpc;
}

/** Test helper. */
export function clearLibraryToolsService(): void {
  rpcClient = null;
}

export async function loadLibraryToolsPreview(): Promise<LibraryToolsPreview> {
  return rpcClient ? rpcClient.getLibraryToolsPreview() : EMPTY;
}

export async function startLibraryTool(tool: LibraryTool, options?: RemoveJsonOptions): Promise<LibraryToolJob> {
  if (!rpcClient) throw new Error("Library tools are only available in the desktop app");
  return rpcClient.startLibraryTool(tool, options);
}

export async function getLibraryToolJob(): Promise<LibraryToolJob | null> {
  return rpcClient ? rpcClient.getLibraryToolJob() : null;
}
