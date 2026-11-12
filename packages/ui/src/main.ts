import { logger } from "@giggle-photos/core/logging/logger";

/**
 * Initialize the UI application
 */
export function initUI(): void {
  logger.info("UI initialized");
}

/**
 * Shutdown the UI application
 */
export function shutdownUI(): Promise<void> {
  logger.info("UI shutting down");
  return Promise.resolve();
}
