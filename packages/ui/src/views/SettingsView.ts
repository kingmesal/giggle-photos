/**
 * Settings view component
 * Note: HTML element functions are globals provided by Sigment
 */
import { createSignal, signal } from "sigment";
import { type AppInfo, getAppInfo } from "../services/app-info-service";
import { type DatabaseInfo, getDatabaseInfo, openDatabaseFolder, resetApplication } from "../services/database-service";
import { getLogger } from "../services/logger-service";
import { getLogsPath, selectLogsFolder } from "../services/logs-service";
import {
  checkTrashAvailable,
  getDefaultSettings,
  loadSettings,
  type Settings,
  saveSettings,
  type TrashCheckResult,
} from "../services/settings-service";
import { getThemeMode } from "../state/theme";
import { getAllowDeleteAll, getCompareViewMode, getGridSize } from "./ReviewSignals";

const log = getLogger("ui:settings-view");

// Get default values for initial state
const defaults = getDefaultSettings();

// Settings state - each signal returns [getter, setter]
const [getLogLevel, setLogLevel] = signal<string>(defaults.logLevel);
const [getUseGlobalLogLevel, setUseGlobalLogLevel] = signal<boolean>(defaults.useGlobalLogLevel);
const [getLoggerLevels, setLoggerLevels] = createSignal<Record<string, string>>(defaults.loggerLevels);
// Separate signal for logger names so PerLoggerControls only re-renders when loggers are added/removed
const [getLoggerNames, setLoggerNames] = createSignal<string[]>(Object.keys(defaults.loggerLevels).sort());
const [getLogToFile, setLogToFile] = signal<boolean>(defaults.logToFile);
const [getSimilarityThreshold, setSimilarityThreshold] = signal<number>(defaults.similarityThreshold);
const [getParallelWorkers, setParallelWorkers] = signal<number>(defaults.parallelWorkers);
const [getMoveToTrash, setMoveToTrash] = signal<boolean>(defaults.moveToTrash);
const [getTrashInfo, setTrashInfo] = signal<TrashCheckResult>({ available: true, command: null, installHint: "" });
const [getShowTrashHelp, setShowTrashHelp] = signal<boolean>(false);

// Track if settings have been modified (dirty state)
const [getIsDirty, setIsDirty] = signal<boolean>(false);
const [getSaveStatus, setSaveStatus] = signal<"idle" | "saving" | "saved" | "error" | "loading">("loading");
const [getIsLoaded, setIsLoaded] = signal<boolean>(false);

// App info state
const [getAppInfoData, setAppInfoData] = signal<AppInfo | null>(null);

// Database info state
const [getDatabaseInfoData, setDatabaseInfoData] = signal<DatabaseInfo | null>(null);
const [getIsDatabaseLoading, setIsDatabaseLoading] = signal<boolean>(false);

// Logs path state
const [getLogsPathData, setLogsPathData] = signal<string>("Loading...");

// Confirmation dialog state
const [getShowResetDialog, setShowResetDialog] = signal<boolean>(false);
const [getResetStatus, setResetStatus] = signal<"idle" | "clearing" | "success" | "error">("idle");

// Mark settings as dirty when any value changes
function markDirty() {
  setIsDirty(true);
  setSaveStatus("idle");
}

// Wrapped setters that mark dirty
function updateLogLevel(value: string) {
  setLogLevel(value);
  markDirty();
}

function updateLogToFile(value: boolean) {
  setLogToFile(value);
  markDirty();
}

function updateUseGlobalLogLevel(value: boolean) {
  setUseGlobalLogLevel(value);
  markDirty();
}

function updateLoggerLevel(name: string, level: string) {
  const current = getLoggerLevels();
  const hadKey = name in current;
  setLoggerLevels({ ...current, [name]: level });
  if (!hadKey) {
    setLoggerNames(Object.keys({ ...current, [name]: level }).sort());
  }
  markDirty();
}

function updateSimilarityThreshold(value: number) {
  setSimilarityThreshold(value);
  markDirty();
}

function updateParallelWorkers(value: number) {
  setParallelWorkers(value);
  markDirty();
}

function updateMoveToTrash(value: boolean) {
  setMoveToTrash(value);
  markDirty();
}

/** Get all current settings as an object */
export function getSettings(): Settings {
  return {
    logLevel: getLogLevel(),
    useGlobalLogLevel: getUseGlobalLogLevel(),
    loggerLevels: getLoggerLevels(),
    logToFile: getLogToFile(),
    similarityThreshold: getSimilarityThreshold(),
    parallelWorkers: getParallelWorkers(),
    moveToTrash: getMoveToTrash(),
    reviewGridSize: getGridSize(),
    compareViewMode: getCompareViewMode(),
    themeMode: getThemeMode(),
    allowDeleteAll: getAllowDeleteAll(),
  };
}

/** Apply loaded settings to signals */
function applySettings(settings: Settings) {
  setLogLevel(settings.logLevel);
  setUseGlobalLogLevel(settings.useGlobalLogLevel);
  setLoggerLevels(settings.loggerLevels || {});
  setLoggerNames(Object.keys(settings.loggerLevels || {}).sort());
  setLogToFile(settings.logToFile);
  setSimilarityThreshold(settings.similarityThreshold);
  setParallelWorkers(settings.parallelWorkers);
  setMoveToTrash(settings.moveToTrash);
  setIsDirty(false);
}

/** Load logs path */
async function handleLoadLogsPath() {
  try {
    const path = await getLogsPath();
    setLogsPathData(path);
  } catch (error) {
    log.error("Failed to load logs path", error);
    setLogsPathData("Error loading path");
  }
}

/** Load settings from storage */
async function handleLoadSettings() {
  setSaveStatus("loading");
  try {
    // Load settings, app info, database info, trash availability, and logs path in parallel
    const [settings, appInfo, dbInfo, trashResult] = await Promise.all([
      loadSettings(),
      getAppInfo(),
      getDatabaseInfo(),
      checkTrashAvailable(),
    ]);
    applySettings(settings);
    setAppInfoData(appInfo);
    setDatabaseInfoData(dbInfo);
    setTrashInfo(trashResult);
    await handleLoadLogsPath();
    setIsLoaded(true);
    setSaveStatus("idle");
  } catch (error) {
    log.error("Failed to load settings", error);
    setSaveStatus("error");
  }
}

/** Load database info */
async function handleLoadDatabaseInfo() {
  setIsDatabaseLoading(true);
  try {
    const dbInfo = await getDatabaseInfo();
    setDatabaseInfoData(dbInfo);
  } catch (error) {
    log.error("Failed to load database info", error);
  } finally {
    setIsDatabaseLoading(false);
  }
}

/** Handle open database folder */
async function handleOpenDatabaseFolder() {
  try {
    const success = await openDatabaseFolder();
    if (success) {
      // Reload database info after opening folder (in case user deletes/renames file)
      await handleLoadDatabaseInfo();
    }
  } catch (error) {
    log.error("Failed to open database folder", error);
    alert("Failed to open database folder. Please check the console for details.");
  }
}

/** Handle select logs folder */
async function handleSelectLogsFolder() {
  try {
    const result = await selectLogsFolder();
    if (result) {
      // Folder was selected and saved, reload the path to show the new location
      await handleLoadLogsPath();
    }
    // If result is null, user cancelled - no action needed
  } catch (error) {
    log.error("Failed to select logs folder", error);
    alert(`Failed to select logs folder: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Show reset application confirmation dialog */
function showResetAppDialog() {
  setShowResetDialog(true);
  setResetStatus("idle");
}

/** Handle reset application confirmation */
async function handleResetAppConfirm() {
  setResetStatus("clearing");

  try {
    const success = await resetApplication();
    if (success) {
      // Reload database info after reset
      await handleLoadDatabaseInfo();
      setResetStatus("success");
      // Close dialog after 1.5 seconds
      setTimeout(() => {
        setShowResetDialog(false);
        setResetStatus("idle");
      }, 1500);
    } else {
      setResetStatus("error");
    }
  } catch (error) {
    log.error("Failed to reset application", error);
    setResetStatus("error");
  }
}

/** Cancel reset application dialog */
function cancelResetApp() {
  setShowResetDialog(false);
  setResetStatus("idle");
}

/** Save settings handler */
async function handleSaveSettings() {
  setSaveStatus("saving");

  try {
    const settings = getSettings();
    await saveSettings(settings);

    setIsDirty(false);
    setSaveStatus("saved");

    // Reset status after 2 seconds
    setTimeout(() => {
      if (getSaveStatus() === "saved") {
        setSaveStatus("idle");
      }
    }, 2000);
  } catch (error) {
    log.error("Failed to save settings", error);
    setSaveStatus("error");
  }
}

/** Toggle switch component */
function Toggle({ value, onChange }: { value: () => boolean; onChange: (v: boolean) => void }) {
  return () => {
    const isOn = value();
    return button(
      {
        class: `relative w-12 h-6 rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-zinc-50 dark:focus:ring-offset-zinc-800 focus:ring-blue-500/50 ${isOn ? "bg-blue-500/40" : "bg-zinc-300/40 dark:bg-zinc-600/40"}`,
        onclick: () => onChange(!isOn),
        role: "switch",
        "aria-checked": String(isOn),
      },
      span({
        class: `absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200 ${isOn ? "translate-x-6" : "translate-x-0"}`,
      }),
    );
  };
}

// Module-level: track the currently active dropdown so we can close it
let closeActiveDropdown: (() => void) | null = null;

/** Custom dropdown component (replaces native <select> to avoid webview issues) */
function SelectDropdown({
  value,
  onChange,
  options,
}: {
  value: () => string | number;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  let menuEl: HTMLDivElement | null = null;

  function cleanup() {
    document.removeEventListener("mousedown", onOutsideClick);
    window.removeEventListener("scroll", close, true);
    window.removeEventListener("resize", close);
    document.removeEventListener("keydown", onKeyDown);
  }

  function close() {
    if (menuEl) {
      menuEl.remove();
      menuEl = null;
    }
    cleanup();
    if (closeActiveDropdown === close) {
      closeActiveDropdown = null;
    }
  }

  function onOutsideClick(e: MouseEvent) {
    if (menuEl?.contains(e.target as Node)) return;
    close();
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      close();
    }
  }

  function open(triggerRect: DOMRect) {
    // Close any other open dropdown first
    if (closeActiveDropdown) closeActiveDropdown();

    const currentValue = String(value());

    menuEl = document.createElement("div");
    menuEl.className =
      "fixed z-[9999] bg-surface-card border border-edge rounded-lg shadow-xl py-1 max-h-48 overflow-y-auto";
    menuEl.style.top = `${triggerRect.bottom + 2}px`;
    menuEl.style.left = `${triggerRect.left}px`;
    menuEl.style.minWidth = `${triggerRect.width}px`;

    for (const opt of options) {
      const item = document.createElement("div");
      item.className =
        opt.value === currentValue
          ? "px-3 py-1.5 text-sm cursor-pointer text-accent-blue bg-blue-500/10 font-medium"
          : "px-3 py-1.5 text-sm cursor-pointer text-fg-2 hover:bg-surface-active";
      item.textContent = opt.label;
      item.addEventListener("mousedown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        close();
        onChange(opt.value);
      });
      menuEl.appendChild(item);
    }

    document.body.appendChild(menuEl);
    closeActiveDropdown = close;

    // Defer listeners so the opening click doesn't immediately close
    requestAnimationFrame(() => {
      document.addEventListener("mousedown", onOutsideClick);
      window.addEventListener("scroll", close, true);
      window.addEventListener("resize", close);
      document.addEventListener("keydown", onKeyDown);
    });
  }

  // Return reactive closure (same interface as before)
  return () => {
    const currentValue = String(value());
    const currentLabel = options.find((o) => o.value === currentValue)?.label || currentValue;

    return button(
      {
        class:
          "px-3 py-2 rounded-lg bg-surface-inset border border-zinc-300 dark:border-zinc-600 text-sm text-fg-2 focus:outline-none focus:border-blue-500 min-w-[160px] text-left flex items-center justify-between gap-2",
        onmousedown: (e: MouseEvent) => {
          e.preventDefault();
          e.stopPropagation();
          if (menuEl) {
            close();
          } else {
            open((e.currentTarget as HTMLElement).getBoundingClientRect());
          }
        },
      },
      span({ class: "truncate" }, currentLabel),
      i({ class: "fadr fa-chevron-down text-xs text-fg-muted" }),
    );
  };
}

/** Settings section wrapper */
function SettingsSection({
  icon,
  iconColor,
  title,
  description,
  children,
}: {
  icon: string;
  iconColor: string;
  title: string;
  description: string;
  children: (HTMLElement | (() => HTMLElement))[];
}) {
  return section(
    { class: "bg-surface-card rounded-xl border border-edge overflow-hidden mb-6" },
    // Header
    div(
      { class: "px-5 py-4 border-b border-edge" },
      div(
        { class: "flex items-center gap-3" },
        div(
          { class: `w-8 h-8 rounded-lg ${iconColor} flex items-center justify-center` },
          i({ class: `fadr ${icon}` }),
        ),
        div({}, h3({ class: "font-medium text-fg" }, title), p({ class: "text-xs text-fg-muted" }, description)),
      ),
    ),
    // Content
    div({ class: "p-5 space-y-5" }, ...children),
  );
}

/** Settings row with label and control */
function SettingsRow({
  label,
  description,
  control,
}: {
  label: string;
  description: string | (() => string | HTMLElement);
  control: HTMLElement | (() => HTMLElement);
}) {
  return div(
    { class: "flex items-center justify-between gap-4" },
    div(
      { class: "flex-1" },
      p({ class: "text-sm text-fg-2" }, label),
      typeof description === "function"
        ? () => {
            const desc = description();
            if (typeof desc === "string") return p({ class: "text-xs text-fg-faint" }, desc);
            return p({ class: "text-xs text-fg-faint" }, desc);
          }
        : p({ class: "text-xs text-fg-faint" }, description),
    ),
    control,
  );
}

/** Log level options for dropdowns */
const logLevelOptions = [
  { value: "off", label: "Off" },
  { value: "error", label: "Error" },
  { value: "warn", label: "Warn" },
  { value: "info", label: "Info" },
  { value: "debug", label: "Debug" },
  { value: "trace", label: "Trace" },
];

/** Individual logger row component */
function LoggerRow({ name }: { name: string }) {
  return div(
    { class: "flex items-center justify-between gap-4 py-2" },
    span({ class: "text-sm text-fg-3 font-mono truncate flex-1" }, name),
    SelectDropdown({
      value: () => getLoggerLevels()[name] ?? "info",
      onChange: (v) => updateLoggerLevel(name, v),
      options: logLevelOptions,
    }),
  );
}

/** Per-logger controls component */
function PerLoggerControls() {
  return () => {
    const useGlobal = getUseGlobalLogLevel();
    const loggerNames = getLoggerNames();

    if (useGlobal) {
      return div({ class: "hidden" });
    }

    if (loggerNames.length === 0) {
      return div(
        {
          class:
            "mt-4 p-4 bg-zinc-200/30 dark:bg-zinc-700/30 rounded-lg border border-zinc-300/50 dark:border-zinc-600/50",
        },
        div(
          { class: "flex items-center gap-2 text-fg-muted text-sm" },
          i({ class: "fadr fa-info-circle" }),
          span({}, "No loggers registered yet. Loggers appear as they are used."),
        ),
      );
    }

    return div(
      { class: "mt-4" },
      div(
        { class: "flex items-center gap-2 mb-3" },
        i({ class: "fadr fa-list text-fg-muted" }),
        span({ class: "text-sm font-medium text-fg-3" }, "Per-Logger Levels"),
      ),
      div(
        {
          class:
            "bg-zinc-200/30 dark:bg-zinc-700/30 rounded-lg border border-zinc-300/50 dark:border-zinc-600/50 p-4 max-h-64 overflow-y-auto",
        },
        div(
          { class: "space-y-1 divide-y divide-zinc-300/30 dark:divide-zinc-600/30" },
          ...loggerNames.map((name) => LoggerRow({ name })),
        ),
      ),
    );
  };
}

/** Logging settings section */
function LoggingSection() {
  return SettingsSection({
    icon: "fa-terminal",
    iconColor: "bg-cyan-500/20 text-cyan-400",
    title: "Logging",
    description: "Configure application logging behavior",
    children: [
      // Global Log Level
      SettingsRow({
        label: "Default Log Level",
        description: "Base level for all loggers",
        control: SelectDropdown({
          value: getLogLevel,
          onChange: updateLogLevel,
          options: logLevelOptions,
        }),
      }),
      // Use Global Log Level Toggle
      SettingsRow({
        label: "Use Global Level for All",
        description: "When enabled, all loggers use the default level above",
        control: Toggle({ value: getUseGlobalLogLevel, onChange: updateUseGlobalLogLevel }),
      }),
      // Per-logger controls (shown when global is disabled)
      PerLoggerControls(),
      // Log to File
      SettingsRow({
        label: "Log to File",
        description: "Save logs to disk for troubleshooting",
        control: Toggle({ value: getLogToFile, onChange: updateLogToFile }),
      }),
      // Log Location
      SettingsRow({
        label: "Log File Location",
        description: () => getLogsPathData(),
        control: button(
          {
            class:
              "px-3 py-1.5 rounded-lg bg-surface-inset hover:bg-surface-active text-fg-3 text-sm transition-colors flex items-center gap-2",
            onclick: handleSelectLogsFolder,
          },
          i({ class: "fadr fa-folder" }),
          "Select",
        ),
      }),
    ],
  });
}

/** Processing settings section */
function ProcessingSection() {
  return SettingsSection({
    icon: "fa-microchip",
    iconColor: "bg-blue-500/20 text-accent-blue",
    title: "Processing",
    description: "Configure how files are processed",
    children: [
      // Similarity Threshold
      div(
        {},
        // Info banner explaining hamming distance
        div(
          { class: "bg-blue-500/10 border border-blue-500/20 rounded-lg p-3 mb-4" },
          div(
            { class: "flex items-start gap-2" },
            i({ class: "fadr fa-circle-info text-blue-400 mt-0.5" }),
            div(
              { class: "flex-1 text-xs" },
              p({ class: "text-accent-blue font-medium mb-1" }, "Perceptual Hashing Hamming Distance"),
              p(
                { class: "text-accent-blue" },
                "Lower values are stricter (only very similar images). Recommended: 5 (catches duplicates with minor edits). Higher values may include false positives.",
              ),
            ),
          ),
        ),
        div(
          { class: "flex items-center justify-between mb-2" },
          div(
            {},
            p({ class: "text-sm text-fg-2" }, "Similarity Threshold"),
            p({ class: "text-xs text-fg-faint" }, "Maximum hamming distance for duplicate detection (0-10)"),
          ),
          () =>
            span(
              { class: "text-sm font-medium text-accent-blue min-w-[50px] text-right" },
              `${getSimilarityThreshold()} ${getSimilarityThreshold() === 5 ? "(Recommended)" : ""}`,
            ),
        ),
        () => {
          const inputEl = input({
            type: "range",
            min: "0",
            max: "10",
            value: String(getSimilarityThreshold()),
            class:
              "w-full h-2 bg-zinc-300 dark:bg-zinc-600 rounded-full appearance-none cursor-pointer accent-blue-500",
            oninput: (e: Event) => updateSimilarityThreshold(Number((e.target as HTMLInputElement).value)),
          }) as HTMLInputElement;
          return inputEl;
        },
        div(
          { class: "flex justify-between text-xs text-fg-faint mt-1" },
          span({}, "0 (Identical only)"),
          span({}, "5 (Recommended)"),
          span({}, "10 (More matches)"),
        ),
      ),
      // Parallel Workers
      SettingsRow({
        label: "Parallel Workers",
        description: "Number of concurrent file processors",
        control: SelectDropdown({
          value: () => String(getParallelWorkers()),
          onChange: (v) => updateParallelWorkers(Number(v)),
          options: [
            { value: "1", label: "1 (Slowest)" },
            { value: "2", label: "2" },
            { value: "4", label: "4 (Recommended)" },
            { value: "8", label: "8" },
            { value: "16", label: "16 (Fastest)" },
          ],
        }),
      }),
      // Move to Trash
      SettingsRow({
        label: "Move Deleted Files to Trash",
        description: () => {
          const info = getTrashInfo();
          if (info.available) {
            return `Move files to system trash instead of permanently deleting (using ${info.command})`;
          }
          return span(
            {},
            "No trash command found. Files will be permanently deleted. ",
            button(
              {
                class: "text-accent-blue hover:underline cursor-pointer font-medium",
                onclick: (e: MouseEvent) => {
                  e.preventDefault();
                  setShowTrashHelp(true);
                },
              },
              "How to enable trash",
            ),
          );
        },
        control: Toggle({
          value: () => (getTrashInfo().available ? getMoveToTrash() : false),
          onChange: (v) => {
            if (getTrashInfo().available) updateMoveToTrash(v);
          },
        }),
      }),
    ],
  });
}

/** Database settings section */
function DatabaseSection() {
  // Load database info when section is rendered
  if (!getDatabaseInfoData() && !getIsDatabaseLoading()) {
    handleLoadDatabaseInfo();
  }

  return SettingsSection({
    icon: "fa-database",
    iconColor: "bg-emerald-500/20 text-accent-green",
    title: "Database",
    description: "Manage application data storage",
    children: [
      // DB Location
      SettingsRow({
        label: "Database Location",
        description: () => {
          const dbInfo = getDatabaseInfoData();
          return dbInfo ? dbInfo.path : "Loading...";
        },
        control: button(
          {
            class:
              "px-3 py-1.5 rounded-lg bg-surface-inset hover:bg-surface-active text-fg-3 text-sm transition-colors flex items-center gap-2",
            onclick: handleOpenDatabaseFolder,
          },
          i({ class: "fadr fa-folder-open" }),
          "Open",
        ),
      }),
      // DB Size
      SettingsRow({
        label: "Database Size",
        description: "Current size of the database file",
        control: () => {
          const dbInfo = getDatabaseInfoData();
          const isLoading = getIsDatabaseLoading();
          return span({ class: "text-sm text-fg-3" }, isLoading ? "Loading..." : dbInfo ? dbInfo.sizeFormatted : "0 B");
        },
      }),
      // Reset Application
      SettingsRow({
        label: "Reset Application",
        description: "Reset all data, thumbnails, and logs",
        control: button(
          {
            class:
              "px-3 py-1.5 rounded-lg bg-red-600/20 hover:bg-red-600/30 text-accent-red text-sm border border-red-500/30 transition-colors flex items-center gap-2",
            onclick: showResetAppDialog,
          },
          i({ class: "fadr fa-trash" }),
          "Reset Application",
        ),
      }),
    ],
  });
}

/** About info row component */
function AboutRow({ label, value }: { label: string; value: () => string }) {
  return div({ class: "flex items-center justify-between" }, span({ class: "text-fg-muted" }, label), () =>
    span({ class: "text-fg-2" }, value()),
  );
}

/** About section */
function AboutSection() {
  return SettingsSection({
    icon: "fa-circle-info",
    iconColor: "bg-zinc-500/20 text-fg-muted",
    title: "About",
    description: "Application information",
    children: [
      div(
        { class: "space-y-3 text-sm" },
        AboutRow({
          label: "Version",
          value: () => getAppInfoData()?.appVersion ?? "Loading...",
        }),
        AboutRow({
          label: "Bun Version",
          value: () => getAppInfoData()?.bunVersion ?? "Loading...",
        }),
        AboutRow({
          label: "Electrobun",
          value: () => getAppInfoData()?.electrobunVersion ?? "Loading...",
        }),
        AboutRow({
          label: "Platform",
          value: () => {
            const info = getAppInfoData();
            if (!info) return "Loading...";
            return `${info.platform} (${info.arch})`;
          },
        }),
        div(
          { class: "flex items-center justify-between" },
          span({ class: "text-fg-muted" }, "License"),
          span({ class: "text-fg-2" }, "MIT"),
        ),
      ),
    ],
  });
}

/** Save button with status indicator */
function SaveButton() {
  return () => {
    const isDirty = getIsDirty();
    const status = getSaveStatus();

    let buttonText = "Save Changes";
    let buttonClass = "bg-blue-600 hover:bg-blue-500";
    let iconClass = "fadr fa-floppy-disk";
    let isDisabled = false;

    if (status === "loading") {
      buttonText = "Loading...";
      buttonClass = "bg-zinc-300 dark:bg-zinc-600 cursor-wait";
      iconClass = "fadr fa-spinner fa-spin";
      isDisabled = true;
    } else if (status === "saving") {
      buttonText = "Saving...";
      buttonClass = "bg-blue-600 opacity-75 cursor-wait";
      iconClass = "fadr fa-spinner fa-spin";
      isDisabled = true;
    } else if (status === "saved") {
      buttonText = "Saved!";
      buttonClass = "bg-emerald-600";
      iconClass = "fadr fa-check";
      isDisabled = true;
    } else if (status === "error") {
      buttonText = "Error - Retry";
      buttonClass = "bg-red-600 hover:bg-red-500";
      iconClass = "fadr fa-exclamation-triangle";
    } else if (!isDirty) {
      buttonClass = "bg-zinc-300 dark:bg-zinc-600 cursor-not-allowed opacity-50";
      isDisabled = true;
    }

    return button(
      {
        class: `px-4 py-2 rounded-lg ${buttonClass} text-white text-sm font-medium transition-colors flex items-center gap-2`,
        onclick: !isDisabled || status === "error" ? handleSaveSettings : undefined,
        disabled: isDisabled && status !== "error",
      },
      i({ class: iconClass }),
      buttonText,
    );
  };
}

/** Reset Application Confirmation Dialog */
function ResetAppDialog() {
  return () => {
    if (!getShowResetDialog()) {
      return div();
    }

    const status = getResetStatus();

    return div(
      {
        class: "fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4",
        onclick: (e: MouseEvent) => {
          // Close if clicking backdrop (not the dialog itself)
          if (e.target === e.currentTarget && status === "idle") {
            cancelResetApp();
          }
        },
      },
      div(
        {
          class: "bg-surface-card rounded-xl border border-edge shadow-2xl max-w-md w-full",
          onclick: (e: MouseEvent) => e.stopPropagation(), // Prevent backdrop click from closing
        },
        // Header
        div(
          { class: "px-6 py-4 border-b border-edge" },
          div(
            { class: "flex items-center gap-3" },
            div(
              { class: "w-10 h-10 rounded-lg bg-red-500/20 text-accent-red flex items-center justify-center" },
              i({ class: "fadr fa-exclamation-triangle text-xl" }),
            ),
            div(
              {},
              h3({ class: "text-lg font-semibold text-fg" }, "Reset Application"),
              p({ class: "text-sm text-fg-muted mt-0.5" }, "This action cannot be undone"),
            ),
          ),
        ),
        // Content
        div(
          { class: "px-6 py-4" },
          status === "clearing"
            ? div(
                { class: "flex items-center gap-3 text-fg-3" },
                i({ class: "fadr fa-spinner fa-spin" }),
                span({}, "Resetting application..."),
              )
            : status === "success"
              ? div(
                  { class: "flex items-center gap-3 text-accent-green" },
                  i({ class: "fadr fa-check-circle" }),
                  span({}, "Application reset successfully!"),
                )
              : status === "error"
                ? div(
                    { class: "flex items-center gap-3 text-accent-red" },
                    i({ class: "fadr fa-exclamation-circle" }),
                    span({}, "Failed to reset application. Please check the console for details."),
                  )
                : div(
                    { class: "space-y-3" },
                    p(
                      { class: "text-fg-3" },
                      "Are you sure you want to reset the application? This will remove all data and start fresh.",
                    ),
                    div(
                      { class: "bg-red-500/10 border border-red-500/20 rounded-lg p-3" },
                      p({ class: "text-sm text-accent-red font-medium mb-1" }, "This will permanently delete:"),
                      ul({ class: "text-sm text-red-400/80 space-y-1 list-disc list-inside" }, [
                        li({}, "All indexed scan folders and file data"),
                        li({}, "All duplicate detection results and review decisions"),
                        li({}, "Cached video thumbnails"),
                        li({}, "Application log files"),
                      ]),
                    ),
                    p(
                      { class: "text-sm text-fg-muted" },
                      "Your preferences (theme, window size, settings) will be preserved.",
                    ),
                  ),
        ),
        // Footer
        div(
          { class: "px-6 py-4 border-t border-edge flex items-center justify-end gap-3" },
          status === "idle"
            ? [
                button(
                  {
                    class:
                      "px-4 py-2 rounded-lg bg-surface-inset hover:bg-surface-active text-fg-3 text-sm font-medium transition-colors",
                    onclick: cancelResetApp,
                  },
                  "Cancel",
                ),
                button(
                  {
                    class:
                      "px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white text-sm font-medium transition-colors flex items-center gap-2",
                    onclick: handleResetAppConfirm,
                  },
                  i({ class: "fadr fa-trash" }),
                  "Reset Application",
                ),
              ]
            : button(
                {
                  class:
                    "px-4 py-2 rounded-lg bg-surface-inset hover:bg-surface-active text-fg-3 text-sm font-medium transition-colors",
                  onclick: cancelResetApp,
                },
                "Close",
              ),
        ),
      ),
    );
  };
}

/** Main settings view */
/** Dialog explaining how to install a trash CLI command */
function TrashHelpDialog() {
  return () => {
    if (!getShowTrashHelp()) return div();

    const info = getTrashInfo();

    return div(
      {
        class: "fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4",
        onclick: (e: MouseEvent) => {
          if (e.target === e.currentTarget) setShowTrashHelp(false);
        },
      },
      div(
        {
          class: "bg-surface-card rounded-xl border border-edge shadow-2xl max-w-lg w-full",
          onclick: (e: MouseEvent) => e.stopPropagation(),
        },
        // Header
        div(
          { class: "px-6 py-4 border-b border-edge" },
          div(
            { class: "flex items-center gap-3" },
            div(
              { class: "w-10 h-10 rounded-lg bg-blue-500/20 text-accent-blue flex items-center justify-center" },
              i({ class: "fadr fa-circle-info text-xl" }),
            ),
            div(
              {},
              h3({ class: "text-lg font-semibold text-fg" }, "Enable Trash Support"),
              p(
                { class: "text-sm text-fg-muted mt-0.5" },
                "Install a trash command to safely move files to trash instead of permanently deleting them",
              ),
            ),
          ),
        ),
        // Content
        div(
          { class: "px-6 py-4" },
          info.installHint
            ? pre(
                {
                  class:
                    "text-sm text-fg-3 bg-surface-inset rounded-lg p-4 whitespace-pre-wrap font-mono leading-relaxed",
                },
                info.installHint,
              )
            : p({ class: "text-sm text-fg-3" }, "Trash support is not available on this platform."),
          p(
            { class: "text-xs text-fg-faint mt-3" },
            "After installing, restart the application for the change to take effect.",
          ),
        ),
        // Footer
        div(
          { class: "px-6 py-4 border-t border-edge flex justify-end" },
          button(
            {
              class: "px-4 py-2 rounded-lg text-sm font-medium bg-surface-inset hover:bg-surface-active text-fg-3",
              onclick: () => setShowTrashHelp(false),
            },
            "Close",
          ),
        ),
      ),
    );
  };
}

export function SettingsView() {
  // Load settings when view is created
  if (!getIsLoaded()) {
    handleLoadSettings();
  }

  return div(
    { class: "h-full flex flex-col relative" },
    // Header - not sticky, just fixed at top of flex container
    header(
      { class: "flex-shrink-0 bg-surface border-b border-edge px-6 py-4 z-10" },
      div(
        { class: "flex items-center justify-between" },
        div(
          {},
          h2({ class: "text-xl font-semibold text-fg" }, "Settings"),
          p({ class: "text-sm text-fg-muted mt-0.5" }, "Configure application behavior"),
        ),
        SaveButton(),
      ),
    ),
    // Content - scrollable area
    div(
      { class: "flex-1 overflow-auto p-6" },
      LoggingSection(),
      ProcessingSection(),
      DatabaseSection(),
      AboutSection(),
    ),
    // Confirmation Dialog (overlay)
    ResetAppDialog(),
    // Trash help dialog (overlay)
    TrashHelpDialog(),
  );
}
