/**
 * Logging: default level, global vs per-logger levels, log to file, log folder.
 */
import { Folder, Info, List, Terminal } from "lucide-react";
import type { ReactNode } from "react";
import { useAction } from "../../external/use-action";
import { getLogger } from "../../services/logger-service";
import { selectLogsFolder } from "../../services/logs-service";
import { SECONDARY_BUTTON, SettingsRow, SettingsSection, Toggle } from "./controls";
import { SelectDropdown } from "./SelectDropdown";
import { LOG_LEVEL_OPTIONS, type SectionProps } from "./settings-draft";

const log = getLogger("ui:settings-view");

function PerLoggerControls({ draft, update }: SectionProps): ReactNode {
  const names = Object.keys(draft.loggerLevels ?? {}).sort();
  if (names.length === 0) {
    return (
      <div className="mt-4 p-4 bg-zinc-200/30 dark:bg-zinc-700/30 rounded-lg border border-zinc-300/50 dark:border-zinc-600/50">
        <div className="flex items-center gap-2 text-fg-muted text-sm">
          <Info size={14} />
          <span>No loggers registered yet. Loggers appear as they are used.</span>
        </div>
      </div>
    );
  }
  return (
    <div className="mt-4">
      <div className="flex items-center gap-2 mb-3">
        <List size={14} className="text-fg-muted" />
        <span className="text-sm font-medium text-fg-3">Per-Logger Levels</span>
      </div>
      <div className="bg-zinc-200/30 dark:bg-zinc-700/30 rounded-lg border border-zinc-300/50 dark:border-zinc-600/50 p-4 max-h-64 overflow-y-auto">
        <div className="space-y-1 divide-y divide-zinc-300/30 dark:divide-zinc-600/30">
          {names.map((name) => (
            <div key={name} className="flex items-center justify-between gap-4 py-2">
              <span className="text-sm text-fg-3 font-mono truncate flex-1">{name}</span>
              <SelectDropdown
                label={`Log level for ${name}`}
                value={draft.loggerLevels[name] ?? "info"}
                onChange={(level) => update({ loggerLevels: { ...draft.loggerLevels, [name]: level } })}
                options={LOG_LEVEL_OPTIONS}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function LoggingSection({
  draft,
  update,
  logsPath,
  onLogsFolderChanged,
}: SectionProps & { logsPath: string; onLogsFolderChanged: () => void }): ReactNode {
  // selectLogsFolder saves the new folder itself; we only re-read the path to show it.
  const select = useAction(async () => {
    try {
      const path = await selectLogsFolder();
      if (path) onLogsFolderChanged();
    } catch (error) {
      log.error("Failed to select logs folder", error);
      alert(`Failed to select logs folder: ${error instanceof Error ? error.message : String(error)}`);
    }
  });

  return (
    <SettingsSection
      icon={<Terminal size={16} />}
      iconColor="bg-cyan-500/20 text-cyan-400"
      title="Logging"
      description="Configure application logging behavior"
    >
      <SettingsRow
        label="Default Log Level"
        description="Base level for all loggers"
        control={
          <SelectDropdown
            label="Default Log Level"
            value={draft.logLevel}
            onChange={(logLevel) => update({ logLevel })}
            options={LOG_LEVEL_OPTIONS}
          />
        }
      />
      <SettingsRow
        label="Use Global Level for All"
        description="When enabled, all loggers use the default level above"
        control={
          <Toggle
            label="Use Global Level for All"
            value={draft.useGlobalLogLevel}
            onChange={(useGlobalLogLevel) => update({ useGlobalLogLevel })}
          />
        }
      />
      {!draft.useGlobalLogLevel && <PerLoggerControls draft={draft} update={update} />}
      <SettingsRow
        label="Log to File"
        description="Save logs to disk for troubleshooting"
        control={<Toggle label="Log to File" value={draft.logToFile} onChange={(logToFile) => update({ logToFile })} />}
      />
      <SettingsRow
        label="Log File Location"
        description={logsPath}
        control={
          <button type="button" className={SECONDARY_BUTTON} disabled={select.pending} onClick={() => select.run()}>
            <Folder size={14} />
            Select
          </button>
        }
      />
    </SettingsSection>
  );
}
