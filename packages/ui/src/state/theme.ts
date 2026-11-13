/**
 * Theme state: light/dark mode, applied to the document root and persisted to settings.
 */
import { createStore, useStore } from "../external/store";
import { getLogger } from "../services/logger-service";
import { saveSettings } from "../services/settings-service";

const log = getLogger("ui:theme");

export type ThemeMode = "light" | "dark";

const theme = createStore<ThemeMode>("dark");

function applyTheme(mode: ThemeMode): void {
  document.documentElement.classList.toggle("dark", mode === "dark");
}

/** Initialize theme from loaded settings (call on startup) */
export function initTheme(mode: string): void {
  const validMode: ThemeMode = mode === "light" ? "light" : "dark";
  theme.set(validMode);
  applyTheme(validMode);
  log.debug("Theme initialized", { mode: validMode });
}

/** Toggle between light and dark mode, persist to settings */
export function toggleTheme(): void {
  const next: ThemeMode = theme.get() === "dark" ? "light" : "dark";
  theme.set(next);
  applyTheme(next);
  saveSettings({ themeMode: next }).catch((e) => log.warn("Failed to save theme", e));
}

export function getThemeMode(): ThemeMode {
  return theme.get();
}

export function useThemeMode(): ThemeMode {
  return useStore(theme);
}
