/**
 * Settings screen.
 *
 * Reads settings (with trash availability), app info, database info and the log folder. The edit form
 * remounts with `key` once settings arrive, so its draft starts from the loaded values.
 */
import type { ReactNode } from "react";
import { useRead } from "../../external/use-read";
import { getAppInfo } from "../../services/app-info-service";
import { getDatabaseInfo } from "../../services/database-service";
import { getLogger } from "../../services/logger-service";
import { getLogsPath } from "../../services/logs-service";
import {
  checkTrashAvailable,
  getDefaultSettings,
  loadSettings,
  type TrashCheckResult,
} from "../../services/settings-service";
import { AboutSection } from "./AboutSection";
import { DatabaseSection } from "./DatabaseSection";
import { SettingsForm } from "./SettingsForm";

const log = getLogger("ui:settings-view");

/** Shown until the real check answers (as the old view did): no help link flashing during load. */
const TRASH_UNKNOWN: TrashCheckResult = { available: true, command: null, installHint: "" };

/** Log the failure and rethrow, so useRead still reports it. */
function logged<T>(what: string, read: () => Promise<T>): () => Promise<T> {
  return () =>
    read().catch((error: unknown) => {
      log.error(`Failed to load ${what}`, error);
      throw error;
    });
}

const readSettings = logged("settings", async () => {
  const [settings, trash] = await Promise.all([loadSettings(), checkTrashAvailable()]);
  return { settings, trash };
});
const readAppInfo = logged("app info", getAppInfo);
const readDatabaseInfo = logged("database info", getDatabaseInfo);
const readLogsPath = logged("logs path", getLogsPath);

export function SettingsScreen(): ReactNode {
  const settings = useRead("settings", readSettings);
  const appInfo = useRead("app-info", readAppInfo);
  const database = useRead("database-info", readDatabaseInfo);
  const logsPath = useRead("logs-path", readLogsPath);

  const loaded = settings.value;
  const formKey = loaded ? "loaded" : settings.failure ? "failed" : "loading";
  const logsPathText = logsPath.failure ? "Error loading path" : (logsPath.value ?? "Loading...");

  return (
    <div className="h-full flex flex-col relative">
      <SettingsForm
        key={formKey}
        initial={loaded?.settings ?? getDefaultSettings()}
        loading={formKey === "loading"}
        trash={loaded?.trash ?? TRASH_UNKNOWN}
        logsPath={logsPathText}
        onLogsFolderChanged={logsPath.refresh}
      >
        <DatabaseSection info={database.value} loading={database.loading} refresh={database.refresh} />
        <AboutSection info={appInfo.value} />
      </SettingsForm>
    </div>
  );
}
