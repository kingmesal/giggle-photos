import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "@dotenvx/dotenvx";
import { loadUserConfig } from "@giggle-photos/core/config/user-config";
import { DatabaseProvider } from "@giggle-photos/core/db/database-provider";
import { logger } from "@giggle-photos/core/logging/logger";
import { initUI } from "@giggle-photos/ui";
import { BrowserWindow } from "electrobun/main";
import { setupWindowLifecycle } from "./bun/window";

// Get __dirname equivalent for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
config();

/**
 * Get the renderer to use based on electrobun.config.ts bundleCEF setting
 * Reads config file directly to avoid import issues in bundled apps
 */
function getRenderer(): "cef" | "native" {
  const platform = process.platform;

  try {
    // Try to read config file - works in both dev and bundled contexts
    // In dev: relative to src/main.ts -> ../electrobun.config.ts
    // In bundled: Resources/main.js -> need to find config
    const possibleConfigPaths = [
      join(__dirname, "../electrobun.config.ts"),
      join(process.cwd(), "apps/desktop/electrobun.config.ts"),
      join(process.cwd(), "electrobun.config.ts"),
    ];

    let configContent: string | null = null;
    for (const configPath of possibleConfigPaths) {
      try {
        configContent = readFileSync(configPath, "utf-8");
        logger.debug("Found config", { configPath });
        break;
      } catch {
        // Try next path
      }
    }

    if (!configContent) {
      logger.debug("Could not find config file, defaulting to native renderer");
      return "native";
    }

    // Parse platform-specific bundleCEF setting
    if (platform === "linux") {
      const linuxMatch = configContent.match(/linux:\s*\{[^}]*bundleCEF:\s*true[^}]*\}/s);
      if (linuxMatch) {
        logger.debug("Config indicates CEF for Linux");
        return "cef";
      }
    } else if (platform === "darwin") {
      const macMatch = configContent.match(/mac:\s*\{[^}]*bundleCEF:\s*true[^}]*\}/s);
      if (macMatch) {
        logger.debug("Config indicates CEF for macOS");
        return "cef";
      }
    } else if (platform === "win32") {
      const winMatch = configContent.match(/win:\s*\{[^}]*bundleCEF:\s*true[^}]*\}/s);
      if (winMatch) {
        logger.debug("Config indicates CEF for Windows");
        return "cef";
      }
    }

    logger.debug("Config does not specify bundleCEF, using native renderer", {
      platform,
    });
    return "native";
  } catch (error) {
    logger.debug("Error reading config, defaulting to native renderer", {
      error,
    });
    return "native";
  }
}

let mainWindow: BrowserWindow | null = null;

/**
 * Main application entry point
 */
async function main(): Promise<void> {
  try {
    logger.info("Starting Giggle Photos App...");

    // Wait a moment for GTK/Electrobun to fully initialize before creating window
    // This helps avoid GLXBadWindow errors on Linux
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Open database and run migrations before any UI or RPC use
    await DatabaseProvider.getInstance();

    // Create the main application window
    // The views:// protocol is used for bundled views in both dev and production
    const url = "views://mainview/index.html";

    try {
      // Determine renderer based on electrobun.config.ts bundleCEF setting
      // See: https://docs.electrobun.dev/electrobun/guides/cross-platform-development/
      const renderer = getRenderer();

      // Load user config for window position/size
      const userConfig = loadUserConfig();
      logger.debug("Creating BrowserWindow", {
        url,
        renderer,
        width: userConfig.window.width,
        height: userConfig.window.height,
        x: userConfig.window.x,
        y: userConfig.window.y,
      });

      mainWindow = new BrowserWindow({
        title: "Giggle Photos",
        frame: {
          width: userConfig.window.width,
          height: userConfig.window.height,
          x: userConfig.window.x,
          y: userConfig.window.y,
        },
        url,
        renderer,
      });

      logger.info("BrowserWindow created", { id: mainWindow.id });

      // Set up window lifecycle handlers (resize/move persistence, shutdown)
      setupWindowLifecycle(mainWindow);

      // Explicitly show the window - CEF windows may need this
      if (mainWindow.show) {
        mainWindow.show();
      } else {
        logger.warn("mainWindow.show() not available");
      }
    } catch (error) {
      logger.error("Error creating BrowserWindow", error);
      throw error;
    }

    // Initialize UI components
    initUI();
    logger.info("Application started successfully");

    // Note: Signal handlers (SIGINT, SIGTERM, SIGHUP) and window close are handled
    // by setupWindowLifecycle which calls Utils.quit() for clean shutdown
  } catch (error) {
    logger.error("Failed to start application", error);
    process.exit(1);
  }
}

main().catch((error) => {
  logger.error("Unhandled error in main", error);
  process.exit(1);
});
