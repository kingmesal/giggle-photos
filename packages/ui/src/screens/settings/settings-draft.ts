/**
 * The edit draft: what the form holds, how sections change it, and what Save sends.
 */
import type { CompleteSettings } from "../../services/settings-service";

/** Merge a change into the draft (marks the form dirty). */
export type UpdateSettings = (patch: Partial<CompleteSettings>) => void;

/** Props every editable section receives. */
export interface SectionProps {
  draft: CompleteSettings;
  update: UpdateSettings;
}

/**
 * The save payload. Two fields are left out because something else owns them while this screen is open:
 * `themeMode` (the sidebar toggle saves it) and `logPath` (choosing a log folder saves it immediately).
 * Sending the values loaded with the form would overwrite those newer saves. Review preferences
 * (grid size, compare mode, allow delete all) go back exactly as loaded.
 */
export function toSavePayload(draft: CompleteSettings): Partial<CompleteSettings> {
  const { themeMode: _theme, logPath: _logPath, ...payload } = draft;
  return { ...payload, quarantinePath: payload.quarantinePath.trim() };
}

export const LOG_LEVEL_OPTIONS = [
  { value: "off", label: "Off" },
  { value: "error", label: "Error" },
  { value: "warn", label: "Warn" },
  { value: "info", label: "Info" },
  { value: "debug", label: "Debug" },
  { value: "trace", label: "Trace" },
];
