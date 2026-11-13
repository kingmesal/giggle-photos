/**
 * Settings service for loading and saving application settings
 * Works both in dev preview (localStorage fallback) and Electrobun (RPC)
 */

import { getLogger } from "./logger-service";

const log = getLogger("ui:settings");

/** ONNX execution provider for CLIP; anything but CPU falls back to CPU when unavailable. */
export type ClipExecutionProvider = "cpu" | "coreml" | "dml" | "cuda";

/** Removal settings (RFD-003): quarantine before trash/delete. */
export interface RemovalSettings {
  /** Removed files move to a quarantine folder (restorable). Takes precedence over moveToTrash. */
  quarantineEnabled: boolean;
  /** Quarantine folder; empty = default under app data. */
  quarantinePath: string;
}

/** CLIP visual similarity settings (RFD-002). Distances are cosine distances (0 = identical). */
export interface ClipSettings {
  clipEnabled: boolean;
  clipExecutionProvider: ClipExecutionProvider;
  clipThreads: number;
  clipStrongMaxDistance: number;
  clipReviewMaxDistance: number;
  clipSimilarShotsEnabled: boolean;
  clipStoreMaxDistance: number;
  clipTopK: number;
}

/** Narrowing preselection rules whose order the person sets (RFD-005). */
export type PreselectRule = "album" | "owner_device";

export interface PreselectionSettings {
  /** First rule that splits a duplicate group decides which copies are preselected to keep. */
  preselectRuleOrder: PreselectRule[];
}

/**
 * Settings shape - matches AppSettings from core. The removal and CLIP fields are optional here only so
 * RPC wiring that predates them still type-checks; loadSettings fills them from defaults.
 */
export interface Settings extends Partial<RemovalSettings>, Partial<ClipSettings>, Partial<PreselectionSettings> {
  logLevel: string;
  useGlobalLogLevel: boolean;
  loggerLevels: Record<string, string>;
  logToFile: boolean;
  logPath?: string;
  similarityThreshold: number;
  parallelWorkers: number;
  moveToTrash: boolean;
  reviewGridSize: string;
  compareViewMode: string;
  themeMode: string;
  allowDeleteAll: boolean;
}

/** Settings with every field present (what loadSettings and getDefaultSettings return). */
export type CompleteSettings = Settings & RemovalSettings & ClipSettings & PreselectionSettings;

/** Default settings values */
const defaultSettings: CompleteSettings = {
  logLevel: "info",
  useGlobalLogLevel: true,
  loggerLevels: {},
  logToFile: true,
  similarityThreshold: 5,
  parallelWorkers: 4,
  moveToTrash: true,
  quarantineEnabled: true,
  quarantinePath: "",
  clipEnabled: true,
  clipExecutionProvider: "cpu",
  clipThreads: 4,
  clipStrongMaxDistance: 0.02,
  clipReviewMaxDistance: 0.06,
  clipSimilarShotsEnabled: false,
  clipStoreMaxDistance: 0.12,
  clipTopK: 64,
  preselectRuleOrder: ["album", "owner_device"],
  reviewGridSize: "md",
  compareViewMode: "balanced",
  themeMode: "dark",
  allowDeleteAll: false,
};

/** RPC client interface for settings operations */
export interface SettingsRPC {
  getSettings: () => Promise<Settings>;
  saveSettings: (settings: Partial<Settings>) => Promise<{ success: boolean; settings: Settings }>;
  checkTrashAvailable: () => Promise<{ available: boolean; command: string | null; installHint: string }>;
}

// Module-level RPC client reference
let rpcClient: SettingsRPC | null = null;

/**
 * Initialize the settings service with an RPC client
 * Call this from mainview.ts when RPC is available
 */
export function initSettingsService(rpc: SettingsRPC): void {
  rpcClient = rpc;
  log.debug("Settings service initialized with RPC");
}

/**
 * Check if RPC is available
 */
export function hasRPC(): boolean {
  return rpcClient !== null;
}

/**
 * Load settings from storage
 * Uses RPC if available, otherwise falls back to localStorage
 */
export async function loadSettings(): Promise<CompleteSettings> {
  if (rpcClient) {
    try {
      const settings = await rpcClient.getSettings();
      log.debug("Settings loaded via RPC", settings);
      // Defaults fill any field an older backend does not send.
      return { ...defaultSettings, ...settings };
    } catch (error) {
      log.error("Failed to load settings via RPC", error);
      return { ...defaultSettings };
    }
  }

  // Fallback to localStorage for dev preview
  try {
    const stored = localStorage.getItem("giggle-photos-settings");
    if (stored) {
      const parsed = JSON.parse(stored);
      log.debug("Settings loaded from localStorage", parsed);
      return { ...defaultSettings, ...parsed };
    }
  } catch (error) {
    log.error("Failed to load settings from localStorage", error);
  }

  log.debug("Using default settings");
  return { ...defaultSettings };
}

/**
 * Save settings to storage
 * Uses RPC if available, otherwise falls back to localStorage
 */
export async function saveSettings(settings: Partial<Settings>): Promise<Settings> {
  if (rpcClient) {
    try {
      const result = await rpcClient.saveSettings(settings);
      log.debug("Settings saved via RPC", result.settings);
      return result.settings;
    } catch (error) {
      log.error("Failed to save settings via RPC", error);
      throw error;
    }
  }

  // Fallback to localStorage for dev preview
  try {
    const current = await loadSettings();
    const merged = { ...current, ...settings };
    localStorage.setItem("giggle-photos-settings", JSON.stringify(merged));
    log.debug("Settings saved to localStorage", merged);
    return merged;
  } catch (error) {
    log.error("Failed to save settings to localStorage", error);
    throw error;
  }
}

/** Result of checking trash availability */
export interface TrashCheckResult {
  available: boolean;
  command: string | null;
  installHint: string;
}

/**
 * Check if trash CLI is available on the system
 */
export async function checkTrashAvailable(): Promise<TrashCheckResult> {
  if (rpcClient) {
    try {
      return await rpcClient.checkTrashAvailable();
    } catch (error) {
      log.error("Failed to check trash availability via RPC", error);
    }
  }
  return { available: false, command: null, installHint: "" };
}

/**
 * Get default settings
 */
export function getDefaultSettings(): CompleteSettings {
  return { ...defaultSettings };
}
