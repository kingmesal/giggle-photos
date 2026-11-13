import { startClipModelSetup } from "@giggle-photos/core/clip/model-service";
import { ensureAppDataDir, getAppSettings, loadUserConfig } from "@giggle-photos/core/config/user-config";
import { DatabaseProvider } from "@giggle-photos/core/db/database-provider";
import { logger } from "@giggle-photos/core/logging/logger";
import { initUI } from "@giggle-photos/ui";
import { loadVersionsFromPackageJson } from "./app-info";
import { startFileServer } from "./file-server";
import { appRPC } from "./rpc";
import { startBackgroundUpdate } from "./updater";
import { createMainWindow, setupWindowLifecycle } from "./window";

loadVersionsFromPackageJson();
ensureAppDataDir();

await DatabaseProvider.getInstance();

// First-run setup (RFD-002): verify or download the CLIP model in the background. Never blocks
// startup; CLIP work runs once it is ready.
if (getAppSettings().clipEnabled) void startClipModelSetup();

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

// Updates download in the background once the window is up; the window shows the progress and
// offers "Restart to update" when it is ready.
void startBackgroundUpdate();
