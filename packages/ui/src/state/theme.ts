/**
 * Theme state — manages light/dark mode toggle with persistence.
 */

import { signal } from "sigment";
import { getLogger } from "../services/logger-service";
import { saveSettings } from "../services/settings-service";

const log = getLogger("ui:theme");

export type ThemeMode = "light" | "dark";

const [getThemeMode, _setThemeMode] = signal<ThemeMode>("dark");

/** Apply theme class to document root */
function applyTheme(mode: ThemeMode): void {
  if (mode === "dark") {
    document.documentElement.classList.add("dark");
  } else {
    document.documentElement.classList.remove("dark");
  }
}

/** Initialize theme from loaded settings (call on startup) */
export function initTheme(mode: string): void {
  const validMode: ThemeMode = mode === "light" ? "light" : "dark";
  _setThemeMode(validMode);
  applyTheme(validMode);
  log.debug("Theme initialized", { mode: validMode });
}

/** Toggle between light and dark mode, persist to settings */
export function toggleTheme(): void {
  const current = getThemeMode();
  const next: ThemeMode = current === "dark" ? "light" : "dark";
  _setThemeMode(next);
  applyTheme(next);
  saveSettings({ themeMode: next }).catch((e) => log.warn("Failed to save theme", e));
}

export { getThemeMode };
