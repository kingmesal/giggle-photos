/**
 * The editable part of Settings: header with Save, and the sections that change settings.
 *
 * The draft starts from `initial`; SettingsScreen remounts this component (via `key`) when the loaded
 * settings arrive, so there is no state syncing.
 */
import { type ReactNode, useRef, useState } from "react";
import { useAction } from "../../external/use-action";
import { getLogger } from "../../services/logger-service";
import { type CompleteSettings, saveSettings, type TrashCheckResult } from "../../services/settings-service";
import { ClipSection } from "./ClipSection";
import { LoggingSection } from "./LoggingSection";
import { PreselectionSection } from "./PreselectionSection";
import { ProcessingSection } from "./ProcessingSection";
import { RemovalSection } from "./RemovalSection";
import { SaveButton, type SaveStatus } from "./SaveButton";
import { toSavePayload } from "./settings-draft";

const log = getLogger("ui:settings-view");

/** How long "Saved!" shows before the button returns to normal. */
const SAVED_FEEDBACK_MS = 2000;

export function SettingsForm({
  initial,
  loading,
  trash,
  logsPath,
  onLogsFolderChanged,
  children,
}: {
  initial: CompleteSettings;
  /** Settings are still loading: show them read-only-ish with the Save button in its loading state. */
  loading: boolean;
  trash: TrashCheckResult;
  logsPath: string;
  onLogsFolderChanged: () => void;
  /** Read-only sections rendered after the editable ones (database, about). */
  children?: ReactNode;
}): ReactNode {
  const [draft, setDraft] = useState<CompleteSettings>(initial);
  const [dirty, setDirty] = useState(false);
  const [outcome, setOutcome] = useState<"idle" | "saved" | "error">("idle");
  // Bumped on every edit: a save only clears "dirty" if nothing changed while it was in flight.
  const edits = useRef(0);
  // Bumped on every save: a stale "Saved!" timer cannot reset a newer status.
  const saves = useRef(0);

  const save = useAction(async (payload: Partial<CompleteSettings>) => {
    try {
      return await saveSettings(payload);
    } catch (error) {
      log.error("Failed to save settings", error);
      throw error;
    }
  });

  const update = (patch: Partial<CompleteSettings>) => {
    edits.current += 1;
    setDraft((d) => ({ ...d, ...patch }));
    setDirty(true);
    setOutcome("idle");
  };

  const onSave = async () => {
    const atEdit = edits.current;
    const round = ++saves.current;
    const result = await save.run(toSavePayload(draft));
    if (round !== saves.current) return;
    if (result === undefined) return setOutcome("error");
    if (edits.current !== atEdit) return setOutcome("idle");
    setDirty(false);
    setOutcome("saved");
    setTimeout(() => {
      if (round === saves.current) setOutcome((o) => (o === "saved" ? "idle" : o));
    }, SAVED_FEEDBACK_MS);
  };

  const status: SaveStatus = loading
    ? "loading"
    : save.pending
      ? "saving"
      : outcome === "saved"
        ? "saved"
        : outcome === "error"
          ? "error"
          : "idle";

  return (
    <>
      <header className="flex-shrink-0 bg-surface border-b border-edge px-6 py-4 z-10">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold text-fg">Settings</h2>
            <p className="text-sm text-fg-muted mt-0.5">Configure application behavior</p>
          </div>
          <SaveButton status={status} dirty={dirty} onSave={onSave} />
        </div>
      </header>
      <div className="flex-1 overflow-auto p-6">
        <LoggingSection draft={draft} update={update} logsPath={logsPath} onLogsFolderChanged={onLogsFolderChanged} />
        <ProcessingSection draft={draft} update={update} />
        <ClipSection draft={draft} update={update} />
        <PreselectionSection draft={draft} update={update} />
        <RemovalSection draft={draft} update={update} trash={trash} />
        {children}
      </div>
    </>
  );
}
