/**
 * Development entry point that runs without Electrobun build system
 * This is a fallback for quick testing without full Electrobun setup
 * For production use, use: bunx electrobun dev
 */

import { config } from "@dotenvx/dotenvx";
import { logger } from "@giggle-photos/core/logging/logger";
import { initUI, shutdownUI } from "@giggle-photos/ui";

// Load environment variables
config();

let isShuttingDown = false;
let shutdownResolve: (() => void) | null = null;

/**
 * Main application entry point (dev mode without Electrobun window)
 */
async function main(): Promise<void> {
  try {
    logger.info("Starting Giggle Photos App (Dev Mode - No Window)...");
    logger.info('Running in dev mode without Electrobun window. Use "bun run start" for full desktop app.');

    // Initialize UI components
    initUI();

    logger.info("Application started successfully (dev mode)");

    // Handle graceful shutdown
    process.on("SIGINT", handleShutdown);
    process.on("SIGTERM", handleShutdown);
    process.on("SIGHUP", handleShutdown);

    // Keep process alive until shutdown signal
    await new Promise<void>((resolve) => {
      shutdownResolve = resolve;
      // Process will stay alive until shutdown signal is received
    });
  } catch (error) {
    logger.error("Failed to start application", error);
    process.exit(1);
  }
}

/**
 * Handle graceful shutdown
 */
async function handleShutdown(): Promise<void> {
  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;

  logger.info("Shutting down application...");

  try {
    await shutdownUI();
    logger.info("Application shut down successfully");

    // Resolve the main promise to allow clean exit
    if (shutdownResolve) {
      shutdownResolve();
    }

    process.exit(0);
  } catch (error) {
    logger.error("Error during shutdown", error);
    process.exit(1);
  }
}

// Start the application
main().catch((error) => {
  logger.error("Unhandled error in main", error);
  process.exit(1);
});
