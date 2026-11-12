import { homedir } from "node:os";
import { join } from "node:path";
import { getAppSettings } from "./user-config";

/**
 * Application name - used for folder naming in app data directories
 */
export const APP_NAME = "giggle-photos";

/**
 * Get the OS-specific application data directory
 * - Windows: %LOCALAPPDATA% or %APPDATA%
 * - macOS: ~/Library/Application Support
 * - Linux: $XDG_DATA_HOME or ~/.local/share
 */
export function getAppDataDir(): string {
  const platform = process.platform;

  if (platform === "win32") {
    // Windows: Use LOCALAPPDATA (preferred) or APPDATA
    return process.env.LOCALAPPDATA || process.env.APPDATA || join(homedir(), "AppData", "Local");
  }

  if (platform === "darwin") {
    // macOS: ~/Library/Application Support
    return join(homedir(), "Library", "Application Support");
  }

  // Linux and other Unix-like: Use XDG_DATA_HOME or default to ~/.local/share
  return process.env.XDG_DATA_HOME || join(homedir(), ".local", "share");
}

/**
 * Get the full path to the application's data directory.
 * If APP_DATA_PATH is set, uses that instead (useful for dev mode).
 * Expected to be an absolute path (e.g., via ${PROJECT_ROOT} expansion in .env).
 */
export function getAppDataPath(): string {
  if (process.env.APP_DATA_PATH) {
    return process.env.APP_DATA_PATH;
  }
  return join(getAppDataDir(), APP_NAME);
}

/**
 * Get the default database path in the app data directory
 */
export function getDefaultDatabasePath(): string {
  return join(getAppDataPath(), "app.db");
}

/**
 * Get the logs directory path
 * Uses configured logPath from settings if available, otherwise defaults to app data/logs
 */
export function getLogsPath(): string {
  const settings = getAppSettings();
  if (settings.logPath) {
    return settings.logPath;
  }
  return join(getAppDataPath(), "logs");
}
