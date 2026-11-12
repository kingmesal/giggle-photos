/**
 * Logger service for the UI package.
 * Uses RPC to send logs to the backend when available,
 * falls back to console when running in dev preview.
 */

type LogLevel = "trace" | "debug" | "info" | "warn" | "error";

/** RPC client interface for logging */
export interface LoggerRPC {
  log: (params: { level: LogLevel; message: string; data?: unknown; name?: string }) => Promise<{ success: boolean }>;
}

/** Logger interface matching tslog's API */
export interface Logger {
  trace: (message: string, ...args: unknown[]) => void;
  debug: (message: string, ...args: unknown[]) => void;
  info: (message: string, ...args: unknown[]) => void;
  warn: (message: string, ...args: unknown[]) => void;
  error: (message: string, ...args: unknown[]) => void;
}

// Module-level RPC client reference
let rpcClient: LoggerRPC | null = null;

// Cache for named loggers
const loggerCache = new Map<string, Logger>();

/**
 * Initialize the logger service with an RPC client.
 * Call this from mainview.ts when RPC is available.
 */
export function initLoggerService(rpc: LoggerRPC): void {
  rpcClient = rpc;
}

/**
 * Check if RPC is available
 */
export function hasLoggerRPC(): boolean {
  return rpcClient !== null;
}

/**
 * Create a log function for a specific level
 */
function createLogFn(level: LogLevel, name: string): (message: string, ...args: unknown[]) => void {
  return (message: string, ...args: unknown[]) => {
    // Format data for logging
    const data = args.length > 0 ? (args.length === 1 ? args[0] : args) : undefined;

    if (rpcClient) {
      // Fire and forget - don't await to avoid blocking
      rpcClient.log({ level, message, data, name }).catch(() => {
        // Fallback to console if RPC fails
        const consoleFn = level === "trace" ? console.debug : console[level];
        consoleFn(`[${name}]`, message, ...(args.length > 0 ? args : []));
      });
    } else {
      // Dev preview - use console
      const consoleFn = level === "trace" ? console.debug : console[level];
      consoleFn(`[${name}]`, message, ...(args.length > 0 ? args : []));
    }
  };
}

/**
 * Get a named logger for a specific module/component.
 *
 * @example
 * const log = getLogger("ui:settings");
 * log.info("Settings loaded", { value: 42 });
 * // In desktop app: logs via RPC to backend
 * // In dev preview: logs to console with [ui:settings] prefix
 */
export function getLogger(name: string): Logger {
  const cached = loggerCache.get(name);
  if (cached) {
    return cached;
  }

  const logger: Logger = {
    trace: createLogFn("trace", name),
    debug: createLogFn("debug", name),
    info: createLogFn("info", name),
    warn: createLogFn("warn", name),
    error: createLogFn("error", name),
  };

  loggerCache.set(name, logger);
  return logger;
}
