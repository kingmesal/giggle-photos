import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AppLayout } from "../layout/AppLayout";
import { getLogger } from "../services/logger-service";
import { loadSettings } from "../services/settings-service";
import { initTheme } from "../state/theme";
import { VIEWS } from "./views";

const log = getLogger("ui:mount");

/** Render the app into `container` (call once services are initialised). Applies the saved theme. */
export function mountApp(container: HTMLElement): void {
  loadSettings()
    .then((settings) => initTheme(settings.themeMode ?? "dark"))
    .catch((error) => log.warn("Could not load theme preference", error));
  createRoot(container).render(
    <StrictMode>
      <AppLayout views={VIEWS} />
    </StrictMode>,
  );
}
