import { getLogger, logger } from "@giggle-photos/core/logging/logger";

export async function log(params: {
  level: "trace" | "debug" | "info" | "warn" | "error";
  message: string;
  data?: unknown;
  name?: string;
}): Promise<{ success: boolean }> {
  const { level, message, data, name } = params;
  const log = name ? getLogger(name) : logger;

  const args = data !== undefined ? [message, data] : [message];

  switch (level) {
    case "trace":
      log.trace(...args);
      break;
    case "debug":
      log.debug(...args);
      break;
    case "info":
      log.info(...args);
      break;
    case "warn":
      log.warn(...args);
      break;
    case "error":
      log.error(...args);
      break;
  }
  return { success: true };
}
