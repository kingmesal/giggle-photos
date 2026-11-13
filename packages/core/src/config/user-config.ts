import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { getAppDataPath } from "./app-paths";

// Lazy logger to avoid circular dependency with logger.ts
let _log: ReturnType<typeof import("../logging/logger").getLogger> | null = null;
function getLog() {
  if (!_log) {
    // Dynamic import to break circular dependency
    const { getLogger } = require("../logging/logger") as typeof import("../logging/logger");
    _log = getLogger("core:config");
  }
  return _log;
}

/**
 * Log level enum
 */
export const LogLevel = z.enum(["off", "error", "warn", "info", "debug", "trace"]);
export type LogLevel = z.infer<typeof LogLevel>;

/**
 * Application settings schema (user-configurable preferences)
 */
export const AppSettings = z.object({
  // Logging settings
  logLevel: LogLevel.default("info"), // Default level for new loggers
  useGlobalLogLevel: z.boolean().default(true), // When true, all loggers use logLevel; when false, per-logger levels apply
  loggerLevels: z.record(z.string(), LogLevel).default({}), // Per-logger level overrides
  logToFile: z.boolean().default(true),
  logPath: z.string().optional(), // Custom log directory path (defaults to app data/logs if not set)

  // Processing settings
  // Similarity threshold: Perceptual hashing hamming distance (0-10)
  // 0 = identical, 1-3 = very similar, 4-6 = similar (recommended: 5), 7-10 = less similar
  similarityThreshold: z.number().min(0).max(10).default(5),
  parallelWorkers: z.number().int().min(1).max(16).default(4),
  moveToTrash: z.boolean().default(true),
  // Quarantine instead of deleting (RFD-003 §F): removed files move here, mirroring their path,
  // and can be restored. Empty path = <app data>/quarantine. Takes precedence over moveToTrash.
  quarantineEnabled: z.boolean().default(true),
  quarantinePath: z.string().default(""),

  // CLIP visual similarity (RFD-002). Distances are cosine distances (0 = identical). Defaults
  // come from 5 stock photos: starting values, to be calibrated on the real library.
  clipEnabled: z.boolean().default(true),
  clipExecutionProvider: z.enum(["cpu", "coreml", "dml", "cuda"]).default("cpu"),
  // ONNX intra-op threads shared by concurrent embeddings. Not "all cores": ONNX Runtime's threads
  // spin while waiting, and oversubscription cost ~10× the CPU per image (measured; RFD-002).
  clipThreads: z.number().int().min(1).max(64).default(4),
  clipStrongMaxDistance: z.number().min(0).max(1).default(0.02), // "same photo": crop/mirror/brightness
  clipReviewMaxDistance: z.number().min(0).max(1).default(0.06), // review cutoff (heavier edits, bursts)
  clipSimilarShotsEnabled: z.boolean().default(false), // opt-in: review up to clipStoreMaxDistance
  clipStoreMaxDistance: z.number().min(0).max(1).default(0.12), // pairs stored; slider never recomputes below this
  clipTopK: z.number().int().min(1).max(1024).default(64), // neighbours considered per image
  // RFD-005: order of the narrowing preselection rules; the first that splits a group decides.
  preselectRuleOrder: z
    .array(z.enum(["album", "owner_device"]))
    .refine((order) => new Set(order).size === order.length, "Each rule at most once")
    .default(["album", "owner_device"]),

  // UI preferences (persisted across sessions)
  reviewGridSize: z.enum(["sm", "md", "lg", "xl"]).default("md"),
  compareViewMode: z.enum(["large", "balanced", "compact"]).default("balanced"),
  themeMode: z.enum(["light", "dark"]).default("dark"),
  allowDeleteAll: z.boolean().default(false),
});

export type AppSettings = z.infer<typeof AppSettings>;

/**
 * Get default application settings
 */
export function getDefaultAppSettings(): AppSettings {
  return AppSettings.parse({});
}

/**
 * User configuration schema
 * Schema and type share the same name per Zod schema standards
 */
export const UserConfig = z.object({
  window: z.object({
    width: z.number().int().positive().default(1200),
    height: z.number().int().positive().default(800),
    x: z.number().int().default(100),
    y: z.number().int().default(100),
  }),
  settings: AppSettings.optional(),
});

export type UserConfig = z.infer<typeof UserConfig>;

/**
 * Get default user configuration using Zod defaults
 */
function getDefaultConfig(): UserConfig {
  return UserConfig.parse({ window: {}, settings: getDefaultAppSettings() });
}

/**
 * Get the path to the user config file
 */
export function getUserConfigPath(): string {
  return join(getAppDataPath(), "config.json");
}

/**
 * Ensure the app data directory exists
 */
export function ensureAppDataDir(): void {
  const appDataPath = getAppDataPath();
  if (!existsSync(appDataPath)) {
    mkdirSync(appDataPath, { recursive: true });
  }
}

/**
 * Load user configuration from file
 * Returns default config if file doesn't exist or is invalid
 */
export function loadUserConfig(): UserConfig {
  ensureAppDataDir();

  const configPath = getUserConfigPath();

  if (!existsSync(configPath)) {
    // Create default config file
    const defaultConfig = getDefaultConfig();
    saveUserConfig(defaultConfig);
    return defaultConfig;
  }

  try {
    const fileContent = readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(fileContent);
    const validated = UserConfig.parse(parsed);
    return validated;
  } catch (error) {
    // If config is invalid, create default
    getLog().warn("Failed to load user config, using defaults", error);
    const defaultConfig = getDefaultConfig();
    saveUserConfig(defaultConfig);
    return defaultConfig;
  }
}

/**
 * Save user configuration to file
 */
export function saveUserConfig(config: UserConfig): void {
  ensureAppDataDir();

  const configPath = getUserConfigPath();
  const validated = UserConfig.parse(config);
  const jsonContent = JSON.stringify(validated, null, 2);

  writeFileSync(configPath, jsonContent, "utf-8");
}

/**
 * Update window size in user config
 */
export function updateWindowSize(width: number, height: number, x?: number, y?: number): void {
  const config = loadUserConfig();
  config.window.width = width;
  config.window.height = height;
  if (x !== undefined) config.window.x = x;
  if (y !== undefined) config.window.y = y;
  saveUserConfig(config);
}

/**
 * Get application settings from user config
 */
export function getAppSettings(): AppSettings {
  const config = loadUserConfig();
  return config.settings ?? getDefaultAppSettings();
}

/**
 * Update application settings in user config
 */
export function updateAppSettings(settings: Partial<AppSettings>): AppSettings {
  const config = loadUserConfig();
  const currentSettings = config.settings ?? getDefaultAppSettings();
  const newSettings = AppSettings.parse({
    ...currentSettings,
    ...settings,
  });
  config.settings = newSettings;
  saveUserConfig(config);
  return newSettings;
}

/**
 * Get the log level for a specific logger name.
 * If useGlobalLogLevel is true, returns the global logLevel.
 * Otherwise, returns the per-logger level if configured, or the global level as fallback.
 */
export function getLoggerLevel(name: string): LogLevel {
  const settings = getAppSettings();
  if (settings.useGlobalLogLevel) {
    return settings.logLevel;
  }
  return settings.loggerLevels[name] ?? settings.logLevel;
}

/**
 * Set the log level for a specific logger name.
 * This persists the level to the config file.
 */
export function setLoggerLevel(name: string, level: LogLevel): void {
  const config = loadUserConfig();
  const currentSettings = config.settings ?? getDefaultAppSettings();
  const newLoggerLevels = { ...currentSettings.loggerLevels, [name]: level };
  config.settings = { ...currentSettings, loggerLevels: newLoggerLevels };
  saveUserConfig(config);
}

/**
 * Remove a per-logger level override, reverting to the default level.
 */
export function removeLoggerLevel(name: string): void {
  const config = loadUserConfig();
  const currentSettings = config.settings ?? getDefaultAppSettings();
  const { [name]: _, ...newLoggerLevels } = currentSettings.loggerLevels;
  config.settings = { ...currentSettings, loggerLevels: newLoggerLevels };
  saveUserConfig(config);
}

/**
 * Get all configured per-logger levels.
 */
export function getAllLoggerLevels(): Record<string, LogLevel> {
  const settings = getAppSettings();
  return { ...settings.loggerLevels };
}

/**
 * Result of checking for trash CLI availability.
 */
export interface TrashAvailability {
  available: boolean;
  /** The command that will be used (e.g., "gio trash", "trash") */
  command: string | null;
  /** Platform-specific install instructions */
  installHint: string;
}

/**
 * Check which trash CLI command is available on the system.
 *
 * Linux:  prefers `gio trash` (GNOME/freedesktop, ships with glib), falls back to `trash-cli`
 * macOS:  prefers `trash` (Homebrew: brew install trash), falls back to `gio trash`
 * Windows: uses PowerShell with Microsoft.VisualBasic.FileIO (built-in, no install needed)
 */
export function getTrashAvailability(): TrashAvailability {
  const platform = process.platform;

  // Windows: PowerShell is always available, use the VisualBasic Recycle Bin API
  if (platform === "win32") {
    try {
      const result = spawnSync("powershell", ["-Command", "echo ok"], { stdio: "ignore" });
      if (result.status === 0) {
        return { available: true, command: "powershell", installHint: "" };
      }
    } catch {
      // PowerShell not found (extremely unlikely)
    }
    return {
      available: false,
      command: null,
      installHint: "PowerShell is required for Recycle Bin support but was not found on this system.",
    };
  }

  const candidates: string[] = platform === "darwin" ? ["trash", "gio"] : platform === "linux" ? ["gio", "trash"] : [];

  for (const bin of candidates) {
    try {
      const result = spawnSync("which", [bin], { stdio: "ignore" });
      if (result.status === 0) {
        const command = bin === "gio" ? "gio trash" : "trash";
        return { available: true, command, installHint: "" };
      }
    } catch {
      // continue to next candidate
    }
  }

  const installHint =
    platform === "linux"
      ? "Install gio (usually included with GNOME/GTK desktops) or trash-cli:\n\n" +
        "  Ubuntu/Debian:  sudo apt install gvfs-bin\n" +
        "  Fedora:         sudo dnf install gvfs\n" +
        "  Arch:           sudo pacman -S gvfs\n" +
        "  trash-cli:      sudo apt install trash-cli  (or pip install trash-cli)"
      : platform === "darwin"
        ? "Install trash via Homebrew:\n\n  brew install trash"
        : "Trash support is not available on this platform. Files will be permanently deleted.";

  return { available: false, command: null, installHint };
}

/** Simple boolean check for backward compatibility */
export function isTrashCliAvailable(): boolean {
  return getTrashAvailability().available;
}
