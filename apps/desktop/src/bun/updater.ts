/**
 * Background updates (Electrobun Updater). The app opens first; then it checks the latest published
 * release, downloads a newer build in the background, and waits for the person to restart. The
 * window polls `getUpdateState` to show the progress, then "Restart to update".
 *
 * The dev channel never updates (Electrobun reports "no update"). Failures never affect the app.
 */
import { getLogger } from "@giggle-photos/core/logging/logger";
import { Updater } from "electrobun/main";

const log = getLogger("desktop:updater");

export interface UpdateState {
  phase: "idle" | "checking" | "up-to-date" | "downloading" | "ready" | "applying" | "error";
  /** Version being downloaded or ready. */
  version?: string;
  /**
   * 0–100 while downloading, only if Electrobun reports it. Electrobun 2.0.6 downloads full updates
   * in a native helper that reports nothing until it is done, so this is usually absent.
   */
  progress?: number;
  /** Size of the update download in bytes, when the server says (best effort). */
  sizeBytes?: number;
  /** When the download started (ms since epoch), for "elapsed". */
  startedAt?: number;
  bytesDownloaded?: number;
  totalBytes?: number;
  message?: string;
}

let state: UpdateState = { phase: "idle" };
let running: Promise<void> | null = null;
let listening = false;

function listen(): void {
  if (listening) return;
  listening = true;
  Updater.onStatusChange((entry) => {
    log.debug("Update status", { status: entry.status, message: entry.message });
    if (state.phase !== "downloading") return;
    const d = entry.details;
    if (d?.progress !== undefined || d?.bytesDownloaded !== undefined) {
      state = {
        ...state,
        progress: d.progress ?? state.progress,
        bytesDownloaded: d.bytesDownloaded ?? state.bytesDownloaded,
        totalBytes: d.totalBytes ?? state.totalBytes,
      };
    }
  });
}

/** Check and, when there is a newer build, download it in the background. Safe to call again. */
export function startBackgroundUpdate(): Promise<void> {
  if (running) return running;
  running = (async () => {
    try {
      listen();
      state = { phase: "checking" };
      const info = await Updater.checkForUpdate();
      if (info.error) throw new Error(info.error);
      if (!info.updateAvailable) {
        state = { phase: "up-to-date" };
        log.info("App is up to date", { hash: info.hash });
        return;
      }
      log.info("Update available; downloading in the background", { version: info.version });
      state = { phase: "downloading", version: info.version, startedAt: Date.now() };
      void downloadSize().then((sizeBytes) => {
        if (sizeBytes && state.phase === "downloading") state = { ...state, sizeBytes };
      });
      await Updater.downloadUpdate();
      if (!Updater.updateInfo()?.updateReady) throw new Error("The update downloaded but is not ready to install");
      state = { phase: "ready", version: info.version };
      log.info("Update ready; waiting for restart", { version: info.version });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      state = { phase: "error", message };
      log.warn("Background update failed", { error: message });
    } finally {
      running = null;
    }
  })();
  return running;
}

const OS_NAME: Record<string, string> = { darwin: "macos", win32: "win", linux: "linux" };

/**
 * The update download's size: read this platform's manifest for the archive name, then ask the
 * server for its length (HEAD). Best effort; null on any failure.
 */
async function downloadSize(): Promise<number | null> {
  try {
    const info = await Updater.getLocalInfo();
    const base = info.baseUrl.replace(/\/+$/, "");
    const prefix = `${info.channel}-${OS_NAME[process.platform] ?? process.platform}-${process.arch}`;
    const manifest = (await (
      await fetch(`${base}/${prefix}-update-v2.json`, { signal: AbortSignal.timeout(10_000) })
    ).json()) as { artifact?: { file?: string } };
    if (!manifest.artifact?.file) return null;
    const head = await fetch(`${base}/${encodeURIComponent(manifest.artifact.file)}`, {
      method: "HEAD",
      signal: AbortSignal.timeout(10_000),
    });
    const length = Number(head.headers.get("content-length"));
    return length > 0 ? length : null;
  } catch {
    return null;
  }
}

export function getUpdateState(): UpdateState {
  return state;
}

/** Install the downloaded update and restart into it. */
export async function restartToUpdate(): Promise<UpdateState> {
  if (state.phase !== "ready") return state;
  state = { ...state, phase: "applying" };
  log.info("Restarting to install the update", { version: state.version });
  try {
    await Updater.applyUpdate(); // the app exits and relaunches on success
  } catch (error) {
    state = { phase: "error", message: error instanceof Error ? error.message : String(error) };
  }
  return state;
}
