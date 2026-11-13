/**
 * Wiring for the duplicate review screen: RPC initialisation, saved review preferences, and the local
 * file server port used for thumbnail URLs.
 */
import { createStore, useStore } from "../external/store";
import { applyLoadedPrefs } from "../screens/results/prefs";
import { getLogger } from "./logger-service";
import { initReviewService, type ReviewRPC } from "./processing";
import { loadSettings } from "./settings-service";

export { formatGpsCoords } from "../screens/results/lib";

const log = getLogger("ui:review-service");

/** Initialise the review RPC and load the persisted review preferences (grid size, compare mode, delete-all). */
export function initResultsService(rpc: ReviewRPC): void {
  initReviewService(rpc);
  loadSettings()
    .then(applyLoadedPrefs)
    .catch((e) => log.warn("Failed to load UI preferences", e));
}

/** File server port for loading local images (0 = not available, use the file:// fallback). */
const fileServerPort = createStore(0);

export function setFileServerPort(port: number): void {
  fileServerPort.set(port);
}

export function getFileServerPort(): number {
  return fileServerPort.get();
}

/** The file server port, re-rendering when it is set. */
export function useFileServerPort(): number {
  return useStore(fileServerPort);
}
