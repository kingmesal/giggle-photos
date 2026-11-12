import { ensureAppDataDir, loadUserConfig } from "@giggle-photos/core/config/user-config";
import { DatabaseProvider } from "@giggle-photos/core/db/database-provider";
import { logger } from "@giggle-photos/core/logging/logger";
import { initUI } from "@giggle-photos/ui";
import { loadVersionsFromPackageJson } from "./app-info";
import { startFileServer } from "./file-server";
import { appRPC } from "./rpc";
import { checkAndApplyUpdates } from "./updater";
import { createMainWindow, setupWindowLifecycle } from "./window";

loadVersionsFromPackageJson();
ensureAppDataDir();

// Check for updates before launching the app. If an update is found, the app
// restarts with the new version and this process exits (code below won't run).
await checkAndApplyUpdates();

await DatabaseProvider.getInstance();

// Start local file server before window creation so the port is available via RPC
await startFileServer();

const userConfig = loadUserConfig();

// On Linux with system GTK, a short delay can avoid GLXBadWindow / init races when creating the window.
if (process.platform === "linux") {
  await new Promise((resolve) => setTimeout(resolve, 300));
}

logger.info("Creating main window...");
const mainWindow = createMainWindow(userConfig, appRPC);
logger.info("Main window created, setting up lifecycle...");

setupWindowLifecycle(mainWindow);

logger.info("Giggle Photos app started!");
initUI();
