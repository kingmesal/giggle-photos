/**
 * Library Tools (RFD-007): previews and one background job at a time for the three tools.
 * They run any time, independent of duplicate checking.
 */
import { deleteFile } from "@giggle-photos/core/actions/file-removal";
import { quarantineFile, resolveQuarantineRoot } from "@giggle-photos/core/actions/quarantine";
import { getAppSettings } from "@giggle-photos/core/config/user-config";
import { DatabaseProvider } from "@giggle-photos/core/db/database-provider";
import type { ToolRunResult } from "@giggle-photos/core/library/sidecar-file";
import { type JsonToXmpPreview, previewJsonToXmp, runJsonToXmp } from "@giggle-photos/core/library/tool-json-to-xmp";
import {
  previewRemoveJson,
  type RemoveFile,
  type RemoveJsonOptions,
  type RemoveJsonPreview,
  type RemoveJsonResult,
  runRemoveJson,
} from "@giggle-photos/core/library/tool-remove-json";
import {
  previewXmpFromFiles,
  runXmpFromFiles,
  type XmpFromFilesPreview,
} from "@giggle-photos/core/library/tool-xmp-from-files";
import { getLogger } from "@giggle-photos/core/logging/logger";

const log = getLogger("rpc:library-tools");

export type LibraryTool = "xmp_from_files" | "json_to_xmp" | "remove_json";

export interface LibraryToolsPreview {
  xmpFromFiles: XmpFromFilesPreview;
  jsonToXmp: JsonToXmpPreview;
  removeJson: RemoveJsonPreview & { mode: RemoveJsonResult["mode"] };
}

export interface LibraryToolJob {
  tool: LibraryTool | null;
  running: boolean;
  done: number;
  total: number;
  result: ToolRunResult | RemoveJsonResult | null;
  error: string | null;
}

let job: LibraryToolJob = { tool: null, running: false, done: 0, total: 0, result: null, error: null };

/** How tool 3 removes files: quarantine when on, else trash or delete, as in Settings → Removal. */
function removal(): { remove: RemoveFile; mode: RemoveJsonResult["mode"] } {
  const settings = getAppSettings();
  const root = resolveQuarantineRoot(settings);
  if (root) {
    return {
      mode: "quarantine",
      remove: async (path, scanFolderPath) => {
        await quarantineFile(root, scanFolderPath, path, "sidecar");
        return { success: true };
      },
    };
  }
  return {
    mode: settings.moveToTrash ? "trash" : "delete",
    remove: (path) => deleteFile(path, settings.moveToTrash, false),
  };
}

/** RPC: what each tool would do. */
export async function getLibraryToolsPreview(): Promise<LibraryToolsPreview> {
  const db = await DatabaseProvider.getInstance();
  const [xmpFromFiles, jsonToXmp, removeJson] = await Promise.all([
    previewXmpFromFiles(db),
    previewJsonToXmp(db),
    previewRemoveJson(db),
  ]);
  return { xmpFromFiles, jsonToXmp, removeJson: { ...removeJson, mode: removal().mode } };
}

/** RPC: start a tool in the background; poll getLibraryToolJob. One tool at a time. */
export async function startLibraryTool(params: {
  tool: LibraryTool;
  options?: RemoveJsonOptions;
}): Promise<LibraryToolJob> {
  if (job.running) return job;
  job = { tool: params.tool, running: true, done: 0, total: 0, result: null, error: null };
  const onProgress = (done: number, total: number) => {
    job.done = done;
    job.total = total;
  };
  void (async () => {
    try {
      const db = await DatabaseProvider.getInstance();
      let result: LibraryToolJob["result"];
      if (params.tool === "xmp_from_files") result = await runXmpFromFiles(db, onProgress);
      else if (params.tool === "json_to_xmp") result = await runJsonToXmp(db, onProgress);
      else {
        const { remove, mode } = removal();
        result = await runRemoveJson(db, params.options ?? {}, remove, mode, onProgress);
      }
      log.info("Library tool finished", { tool: params.tool, result: { ...result, errors: result.errors.length } });
      job = { ...job, running: false, result };
    } catch (error) {
      log.error("Library tool failed", {
        tool: params.tool,
        error: error instanceof Error ? error.message : String(error),
      });
      job = { ...job, running: false, error: "The tool stopped with an error; see the log" };
    }
  })();
  return job;
}

/** RPC: progress of the running (or last) tool. */
export async function getLibraryToolJob(): Promise<LibraryToolJob> {
  return job;
}
