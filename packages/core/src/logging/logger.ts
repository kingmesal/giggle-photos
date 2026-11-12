import { appendFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Logger } from "tslog";
import { getLogsPath } from "../config/app-paths";
import { env } from "../config/env";
import {
  getAllLoggerLevels,
  getAppSettings,
  getLoggerLevel,
  type LogLevel,
  removeLoggerLevel,
  setLoggerLevel as setLoggerLevelConfig,
} from "../config/user-config";

// Re-export config functions for convenience
export { getAllLoggerLevels, removeLoggerLevel, setLoggerLevelConfig };

// Map string log levels to tslog numeric levels
const logLevelMap: Record<string, number> = {
  off: 7, // Higher than any log level to disable all logging
  trace: 1,
  debug: 2,
  info: 3,
  warn: 4,
  error: 5,
};

/**
 * Get the configured log level.
 * Priority: LOG_LEVEL env var (if explicitly set) > user config > default ("info").
 * This lets LOG_LEVEL=off suppress all output in tests/CI without touching user config.
 */
function getConfiguredLogLevel(): number {
  // Env var wins when explicitly set (e.g., LOG_LEVEL=off in test scripts)
  const envLevel = process.env.LOG_LEVEL ? logLevelMap[process.env.LOG_LEVEL] : undefined;
  if (envLevel !== undefined) {
    return envLevel;
  }
  try {
    const settings = getAppSettings();
    const level = logLevelMap[settings.logLevel];
    if (level !== undefined) {
      return level;
    }
  } catch {
    // Config not available yet (e.g., during initial module load)
  }
  // Fall back to parsed env default
  return logLevelMap[env.LOG_LEVEL] ?? 3;
}

// Create logger instance (writes to console by default)
export const logger = new Logger({
  name: "app",
  minLevel: getConfiguredLogLevel(),
  stylePrettyLogs: true,
  prettyLogTemplate: "{{yyyy}}.{{mm}}.{{dd}} {{hh}}:{{MM}}:{{ss}}:{{ms}}\t{{logLevelName}}\t[{{name}}]\t",
});

// Cache for sub-loggers to avoid creating duplicates
const subLoggerCache = new Map<string, Logger<unknown>>();

// Pending loggers to be persisted (debounced)
const pendingLoggerPersist = new Set<string>();
let persistTimeout: ReturnType<typeof setTimeout> | null = null;
const PERSIST_DEBOUNCE_MS = 500;

/**
 * Flush pending logger names to config file.
 * Called after debounce timeout.
 */
function flushPendingLoggers(): void {
  if (pendingLoggerPersist.size === 0) return;

  try {
    const settings = getAppSettings();
    const currentLoggerLevels = { ...settings.loggerLevels };
    let hasChanges = false;

    for (const name of pendingLoggerPersist) {
      if (!(name in currentLoggerLevels)) {
        // Use logger-specific default if defined, otherwise global level
        const defaultNumeric = loggerDefaults[name];
        const defaultLevel =
          defaultNumeric !== undefined
            ? ((Object.entries(logLevelMap).find(([, v]) => v === defaultNumeric)?.[0] as LogLevel) ??
              settings.logLevel)
            : settings.logLevel;
        currentLoggerLevels[name] = defaultLevel;
        hasChanges = true;
      }
    }

    if (hasChanges) {
      // Import dynamically to avoid issues during module initialization
      const { updateAppSettings } = require("../config/user-config") as typeof import("../config/user-config");
      updateAppSettings({ loggerLevels: currentLoggerLevels });
    }
  } catch {
    // Ignore errors during config save
  }

  pendingLoggerPersist.clear();
  persistTimeout = null;
}

/**
 * Queue a logger name to be persisted to config (debounced).
 */
function queueLoggerPersist(name: string): void {
  pendingLoggerPersist.add(name);

  if (persistTimeout) {
    clearTimeout(persistTimeout);
  }
  persistTimeout = setTimeout(flushPendingLoggers, PERSIST_DEBOUNCE_MS);
}

/** Default log levels for specific loggers (used when no user config exists yet) */
const loggerDefaults: Record<string, number> = {
  performance: 5, // error level — silent by default; set to "info" to see [perf] lines
};

/**
 * Get the configured log level for a specific logger from user config.
 * If useGlobalLogLevel is true, uses the global level.
 * Falls back to per-logger defaults, then the global default log level.
 */
function getLoggerConfiguredLevel(name: string): number {
  try {
    const settings = getAppSettings();
    if (settings.useGlobalLogLevel) {
      return getConfiguredLogLevel();
    }
    const level = getLoggerLevel(name);
    return logLevelMap[level] ?? loggerDefaults[name] ?? getConfiguredLogLevel();
  } catch {
    // Config not available yet
    return loggerDefaults[name] ?? getConfiguredLogLevel();
  }
}

/**
 * Check if a logger is already configured in the settings.
 */
function isLoggerConfigured(name: string): boolean {
  try {
    const settings = getAppSettings();
    return name in settings.loggerLevels;
  } catch {
    return false;
  }
}

/**
 * Get a named sub-logger for a specific module/component.
 * Sub-loggers can have their own log level configured in user settings,
 * or they inherit the default log level.
 *
 * @example
 * // In packages/core/src/scan/file-scanner.ts
 * const log = getLogger("core:scan");
 * log.info("Scanning folder...");
 * // Output: 2024.01.15 10:30:45:123  INFO  [core:scan]  Scanning folder...
 *
 * @example
 * // In packages/ui/src/services/settings-service.ts
 * const log = getLogger("ui:settings");
 * log.debug("Settings loaded:", settings);
 */
export function getLogger(name: string): Logger<unknown> {
  const cached = subLoggerCache.get(name);
  if (cached) {
    return cached;
  }

  const subLogger = logger.getSubLogger({
    name,
    minLevel: getLoggerConfiguredLevel(name),
  });
  subLoggerCache.set(name, subLogger);

  // Queue new loggers to be persisted to config (debounced)
  if (!isLoggerConfigured(name)) {
    queueLoggerPersist(name);
  }

  return subLogger;
}

/**
 * Update the root logger's log level at runtime.
 * This affects all loggers that don't have a per-logger level configured.
 */
export function setLogLevel(level: LogLevel): void {
  const numericLevel = logLevelMap[level];
  if (numericLevel !== undefined) {
    logger.settings.minLevel = numericLevel;
  }
}

/**
 * Update a specific sub-logger's level at runtime.
 * This updates the in-memory logger if it exists in the cache.
 * To persist the change, use setLoggerLevel from user-config.
 */
export function setSubLoggerLevel(name: string, level: LogLevel): void {
  const numericLevel = logLevelMap[level];
  if (numericLevel === undefined) return;

  const cached = subLoggerCache.get(name);
  if (cached) {
    cached.settings.minLevel = numericLevel;
  }
}

/**
 * Refresh all cached sub-loggers with their configured levels from user config.
 * Call this after updating logger levels in the config file.
 * Respects the useGlobalLogLevel setting.
 */
export function refreshLoggerLevels(): void {
  const globalLevel = getConfiguredLogLevel();
  let useGlobal = true;
  try {
    const settings = getAppSettings();
    useGlobal = settings.useGlobalLogLevel;
  } catch {
    // Config not available, use global
  }

  for (const [name, subLogger] of subLoggerCache) {
    if (useGlobal) {
      subLogger.settings.minLevel = globalLevel;
    } else {
      subLogger.settings.minLevel = getLoggerConfiguredLevel(name);
    }
  }
}

/**
 * Set a logger's level, persisting to config and applying immediately.
 * Combines setLoggerLevelConfig (persistence) and setSubLoggerLevel (runtime update).
 */
export function setLoggerLevelPersisted(name: string, level: LogLevel): void {
  setLoggerLevelConfig(name, level);
  setSubLoggerLevel(name, level);
}

/**
 * Force flush any pending logger names to config file immediately.
 * Useful for graceful shutdown or testing.
 */
export function flushLoggerConfig(): void {
  if (persistTimeout) {
    clearTimeout(persistTimeout);
  }
  flushPendingLoggers();
}

// Attach file transport when logToFile is enabled
function attachFileTransport(): void {
  try {
    const settings = getAppSettings();
    if (!settings.logToFile) return;

    let logDir: string;
    try {
      logDir = getLogsPath();
    } catch {
      logDir = join(tmpdir(), "giggle-photos-logs");
    }
    mkdirSync(logDir, { recursive: true });
    const logFile = join(logDir, "app.log");

    logger.attachTransport((logObj: Record<string, unknown>) => {
      try {
        const meta = (logObj._meta ?? {}) as {
          date?: Date;
          logLevelName?: string;
          name?: string;
        };
        const date = meta.date instanceof Date ? meta.date : new Date();
        const level = meta.logLevelName ?? "INFO";
        const name = meta.name ?? "";
        const msg = logObj[0] != null ? String(logObj[0]) : JSON.stringify(logObj);
        const line = `[${date.toISOString()}] ${level} [${name}] ${msg}\n`;
        appendFileSync(logFile, line);
      } catch {
        // Ignore file write errors
      }
    });
  } catch {
    // Ignore if settings/paths unavailable (e.g. in tests)
  }
}

attachFileTransport();
