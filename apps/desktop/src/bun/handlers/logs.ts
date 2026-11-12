import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname } from "node:path";
import { getLogsPath } from "@giggle-photos/core/config/app-paths";
import { updateAppSettings } from "@giggle-photos/core/config/user-config";
import { getLogger } from "@giggle-photos/core/logging/logger";
import { Utils } from "electrobun/main";

const log = getLogger("rpc:logs");

export async function getLogsPathHandler(): Promise<{ path: string }> {
  log.debug("getLogsPath called");
  try {
    const logsPath = getLogsPath();
    return { path: logsPath };
  } catch (error) {
    log.error("Failed to get logs path", error);
    throw error;
  }
}

export async function selectLogsFolder(): Promise<{
  success: boolean;
  path: string | null;
}> {
  log.debug("selectLogsFolder called");
  try {
    const currentLogsPath = getLogsPath();

    let startingFolder: string;
    if (existsSync(currentLogsPath)) {
      startingFolder = currentLogsPath;
    } else {
      const parentDir = dirname(currentLogsPath);
      if (existsSync(parentDir)) {
        startingFolder = parentDir;
      } else {
        startingFolder = homedir();
      }
    }

    const chosenPaths = await Utils.openFileDialog({
      startingFolder,
      allowedFileTypes: "*",
      canChooseFiles: false,
      canChooseDirectory: true,
      allowsMultipleSelection: false,
    });

    if (chosenPaths && chosenPaths.length > 0) {
      const path = chosenPaths[0] ?? null;
      if (path) updateAppSettings({ logPath: path });
      log.info("Logs folder selected and saved", { path });
      return { success: true, path };
    }

    return { success: true, path: null };
  } catch (error) {
    log.error("Failed to select logs folder", error);
    throw error;
  }
}
