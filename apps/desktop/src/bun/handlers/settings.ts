import type { AppSettings, LogLevel } from "@giggle-photos/core/config/user-config";
import {
  getAppSettings,
  getTrashAvailability,
  updateAppSettings,
  updateWindowSize,
} from "@giggle-photos/core/config/user-config";
import { getLogger, refreshLoggerLevels, setLogLevel } from "@giggle-photos/core/logging/logger";

const log = getLogger("rpc:settings");

export async function getSettings(): Promise<AppSettings> {
  log.debug("getSettings called");
  return getAppSettings();
}

export async function saveSettings(params: Partial<AppSettings>): Promise<{
  success: boolean;
  settings: AppSettings;
}> {
  log.debug("saveSettings called", params);
  try {
    const settings = updateAppSettings(params);

    // Update logger's log level at runtime if it changed
    if (params.logLevel) {
      setLogLevel(params.logLevel as LogLevel);
      log.info("Log level updated to:", params.logLevel);
    }

    // Refresh all sub-logger levels if useGlobalLogLevel or loggerLevels changed
    if (params.useGlobalLogLevel !== undefined || params.loggerLevels !== undefined) {
      refreshLoggerLevels();
      log.debug("Refreshed all logger levels");
    }

    log.info("Settings saved successfully");
    return { success: true, settings };
  } catch (error) {
    log.error("Failed to save settings", error);
    throw error;
  }
}

export async function checkTrashAvailable(): Promise<{
  available: boolean;
  command: string | null;
  installHint: string;
}> {
  log.debug("checkTrashAvailable called");
  return getTrashAvailability();
}

export async function saveWindowBounds(params: {
  width: number;
  height: number;
  x: number;
  y: number;
}): Promise<{ success: boolean }> {
  log.debug("saveWindowBounds called", params);
  try {
    updateWindowSize(params.width, params.height, params.x, params.y);
    return { success: true };
  } catch (error) {
    log.error("Failed to save window bounds", error);
    return { success: false };
  }
}
