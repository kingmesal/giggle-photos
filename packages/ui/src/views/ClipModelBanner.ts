/**
 * First-run CLIP model setup banner (RFD-002): download progress, or the error with Retry and
 * "Import model file…". Interim Sigment UI; RFD-004 replaces it with a setup screen.
 */
import {
  getClipImportError,
  getClipModelStatus,
  importClipModelFile,
  retryClipModelSetup,
} from "../services/clip-service";

const mb = (bytes: number) => `${Math.round(bytes / 1048576)} MB`;

export function ClipModelBanner() {
  return () => {
    const status = getClipModelStatus();
    const importError = getClipImportError();
    if (!status) return null;
    if (status.state === "ready") {
      return div({ class: "mb-3 text-xs text-fg-faint" }, "Visual similarity (CLIP) model ready.");
    }
    const box = "mb-4 p-3 rounded-lg border text-sm";
    if (status.state === "downloading") {
      const pct = status.totalBytes > 0 ? Math.round((status.receivedBytes / status.totalBytes) * 100) : 0;
      return div(
        { class: `${box} border-blue-500/30 bg-blue-500/10` },
        div(
          {},
          `Downloading the visual similarity model: ${mb(status.receivedBytes)} of ${mb(status.totalBytes)} (${pct}%)`,
        ),
        div(
          { class: "mt-2 h-1.5 rounded bg-zinc-300 dark:bg-zinc-700" },
          (() => {
            const bar = div({ class: "h-1.5 rounded bg-blue-500" });
            bar.style.width = `${pct}%`; // Sigment props take no style string (same as ProcessingView)
            return bar;
          })(),
        ),
        div(
          { class: "mt-1 text-xs text-fg-muted" },
          "You can start processing meanwhile; visual matching runs once the model is ready.",
        ),
      );
    }
    if (status.state === "verifying" || status.state === "missing") {
      return div({ class: `${box} border-blue-500/30 bg-blue-500/10` }, "Checking the visual similarity model…");
    }
    return div(
      { class: `${box} border-amber-500/40 bg-amber-500/10` },
      div({}, "The visual similarity (CLIP) model could not be downloaded. Everything else still works."),
      div({ class: "mt-1 text-xs font-mono text-fg-muted" }, status.message),
      importError ? div({ class: "mt-1 text-xs text-accent-amber" }, importError) : null,
      div(
        { class: "mt-2 flex gap-3" },
        button(
          { class: "text-xs underline text-accent-blue", onclick: () => void retryClipModelSetup() },
          "Retry download",
        ),
        button(
          { class: "text-xs underline text-accent-blue", onclick: () => void importClipModelFile() },
          "Import model file…",
        ),
      ),
    );
  };
}
