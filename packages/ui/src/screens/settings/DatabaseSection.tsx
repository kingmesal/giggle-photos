/**
 * Database: location (with Open folder), size, and Reset Application.
 */
import { Database, FolderOpen } from "lucide-react";
import type { ReactNode } from "react";
import { useAction } from "../../external/use-action";
import { type DatabaseInfo, openDatabaseFolder, resetApplication } from "../../services/database-service";
import { getLogger } from "../../services/logger-service";
import { SECONDARY_BUTTON, SettingsRow, SettingsSection } from "./controls";
import { ResetApplication } from "./DangerZone";

const log = getLogger("ui:settings-view");

export function DatabaseSection({
  info,
  loading,
  refresh,
}: {
  info: DatabaseInfo | undefined;
  loading: boolean;
  /** Re-read the database info (after opening the folder or a reset). */
  refresh: () => void;
}): ReactNode {
  const open = useAction(async () => {
    try {
      // Re-read afterwards: the person may delete or rename the file from the file manager.
      if (await openDatabaseFolder()) refresh();
    } catch (error) {
      log.error("Failed to open database folder", error);
      alert("Failed to open database folder. Please check the console for details.");
    }
  });

  return (
    <SettingsSection
      icon={<Database size={16} />}
      iconColor="bg-emerald-500/20 text-accent-green"
      title="Database"
      description="Manage application data storage"
    >
      <SettingsRow
        label="Database Location"
        description={info ? info.path : "Loading..."}
        control={
          <button type="button" className={SECONDARY_BUTTON} disabled={open.pending} onClick={() => open.run()}>
            <FolderOpen size={14} />
            Open
          </button>
        }
      />
      <SettingsRow
        label="Database Size"
        description="Current size of the database file"
        control={
          <span className="text-sm text-fg-3">{loading ? "Loading..." : info ? info.sizeFormatted : "0 B"}</span>
        }
      />
      <ResetApplication reset={resetApplication} onReset={refresh} />
    </SettingsSection>
  );
}
