import { getLogger } from "@giggle-photos/core/logging/logger";
import { Updater } from "electrobun/main";

const log = getLogger("desktop:updater");

export async function checkAndApplyUpdates(): Promise<void> {
  try {
    const info = await Updater.checkForUpdate();

    if (!info.updateAvailable) {
      log.info("App is up to date", { hash: info.hash });
      return;
    }

    log.info("Update available", { hash: info.hash });

    Updater.onStatusChange((entry) => {
      log.debug("Update status", { status: entry.status, message: entry.message });
    });

    await Updater.downloadUpdate();

    if (!Updater.updateInfo()?.updateReady) {
      log.warn("Update downloaded but not ready to apply");
      return;
    }

    log.info("Update downloaded, applying...");
    await Updater.applyUpdate();
  } catch (error) {
    // Auto-update failures are non-fatal — the app continues running normally
    log.warn("Auto-update check failed", { error });
  }
}
