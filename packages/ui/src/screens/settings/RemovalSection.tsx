/**
 * Removal: quarantine (default, restorable), quarantine folder, and Move to Trash (used when quarantine
 * is off; disabled with a help link when no trash command exists).
 */
import { ShieldCheck } from "lucide-react";
import { type ReactNode, useState } from "react";
import type { TrashCheckResult } from "../../services/settings-service";
import { SettingsRow, SettingsSection, Toggle } from "./controls";
import { QuarantineRestore } from "./QuarantineRestore";
import type { SectionProps } from "./settings-draft";
import { TrashHelpDialog } from "./TrashHelpDialog";

function TrashDescription({ trash, onHelp }: { trash: TrashCheckResult; onHelp: () => void }): ReactNode {
  if (trash.available) {
    const using = trash.command ? ` (using ${trash.command})` : "";
    return `Move files to system trash instead of permanently deleting${using}`;
  }
  return (
    <span>
      No trash command found. Files will be permanently deleted.{" "}
      <button type="button" className="text-accent-blue hover:underline cursor-pointer font-medium" onClick={onHelp}>
        How to enable trash
      </button>
    </span>
  );
}

export function RemovalSection({ draft, update, trash }: SectionProps & { trash: TrashCheckResult }): ReactNode {
  const [showTrashHelp, setShowTrashHelp] = useState(false);
  const quarantine = draft.quarantineEnabled;
  return (
    <SettingsSection
      icon={<ShieldCheck size={16} />}
      iconColor="bg-amber-500/20 text-amber-400"
      title="Removal"
      description="What happens to files you remove"
    >
      <SettingsRow
        label="Quarantine Removed Files"
        description="Removed files move to a quarantine folder and can be restored. Takes precedence over Move to Trash"
        control={
          <Toggle
            label="Quarantine Removed Files"
            value={quarantine}
            onChange={(quarantineEnabled) => update({ quarantineEnabled })}
          />
        }
      />
      <div className={quarantine ? "" : "opacity-60"}>
        <label className="block">
          <span className="block text-sm text-fg-2">Quarantine Folder</span>
          <span className="block text-xs text-fg-faint mb-2">
            Leave empty to use the default folder under the app data directory
          </span>
          <input
            type="text"
            value={draft.quarantinePath}
            placeholder="Default (app data/quarantine)"
            spellCheck={false}
            className="w-full px-3 py-2 rounded-lg bg-surface-inset border border-zinc-300 dark:border-zinc-600 text-sm text-fg-2 font-mono focus:outline-none focus:border-blue-500"
            onChange={(e) => update({ quarantinePath: e.target.value })}
          />
        </label>
      </div>
      <QuarantineRestore />
      <SettingsRow
        label="Move Deleted Files to Trash"
        description={
          <>
            <TrashDescription trash={trash} onHelp={() => setShowTrashHelp(true)} />
            {quarantine && " Used only when quarantine is off."}
          </>
        }
        control={
          <Toggle
            label="Move Deleted Files to Trash"
            value={trash.available ? draft.moveToTrash : false}
            disabled={!trash.available}
            onChange={(moveToTrash) => {
              if (trash.available) update({ moveToTrash });
            }}
          />
        }
      />
      {showTrashHelp && <TrashHelpDialog installHint={trash.installHint} onClose={() => setShowTrashHelp(false)} />}
    </SettingsSection>
  );
}
