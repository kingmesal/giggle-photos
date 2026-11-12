import { exec } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { getAppDataPath, getLogsPath } from "@giggle-photos/core/config/app-paths";
import { DatabaseProvider } from "@giggle-photos/core/db/database-provider";
import { getLogger } from "@giggle-photos/core/logging/logger";

const log = getLogger("rpc:database");

export async function getDatabaseInfo(): Promise<{
  path: string;
  size: number;
  sizeFormatted: string;
}> {
  log.debug("getDatabaseInfo called");
  try {
    const settings = (await DatabaseProvider.getInstance()).getSettingsProvider();
    return await settings.getDatabaseInfo();
  } catch (error) {
    log.error("Failed to get database info", error);
    throw error;
  }
}

export async function openDatabaseFolder(): Promise<{ success: boolean }> {
  log.debug("openDatabaseFolder called");
  try {
    const settings = (await DatabaseProvider.getInstance()).getSettingsProvider();
    const info = await settings.getDatabaseInfo();
    const folderPath = dirname(info.path);
    const platform = process.platform;

    if (platform === "win32") {
      exec(`explorer "${folderPath}"`);
    } else if (platform === "darwin") {
      exec(`open "${folderPath}"`);
    } else {
      exec(`xdg-open "${folderPath}"`);
    }

    log.info("Database folder opened", { path: folderPath });
    return { success: true };
  } catch (error) {
    log.error("Failed to open database folder", error);
    throw error;
  }
}

export async function resetApplication(): Promise<{ success: boolean }> {
  log.debug("resetApplication called");
  try {
    // 1. Clear the database
    const settings = (await DatabaseProvider.getInstance()).getSettingsProvider();
    await settings.clearDatabase();
    log.info("Database cleared");

    // 2. Delete thumbnails directory
    const thumbnailsPath = `${getAppDataPath()}/thumbnails`;
    if (existsSync(thumbnailsPath)) {
      rmSync(thumbnailsPath, { recursive: true, force: true });
      log.info("Thumbnails directory deleted", { path: thumbnailsPath });
    }

    // 3. Delete logs directory
    const logsPath = getLogsPath();
    if (existsSync(logsPath)) {
      rmSync(logsPath, { recursive: true, force: true });
      log.info("Logs directory deleted", { path: logsPath });
    }

    log.info("Application reset successfully");
    return { success: true };
  } catch (error) {
    log.error("Failed to reset application", error);
    throw error;
  }
}
