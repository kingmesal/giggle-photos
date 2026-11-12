/**
 * Folders view component
 * Manages source folders for scanning
 * Note: HTML element functions are globals provided by Sigment
 */
import { createSignal, signal } from "sigment";
import { getLogger } from "../services/logger-service";
import { invalidateReviewCache } from "./ReviewSignals";

const log = getLogger("ui:folders");

/**
 * ScanFolder type for UI (dates are strings from RPC)
 */
type ScanFolder = {
  id: number;
  path: string;
  priority: number;
  status: "added" | "scanning" | "ready" | "error";
  scanSubdirectories: boolean;
  includeVideos: boolean;
  imageCount: number;
  videoCount: number;
  totalSize: number;
  createdAt: string; // ISO date string from RPC
  updatedAt: string; // ISO date string from RPC
};

// Folder state
const [getFolders, setFolders] = createSignal<ScanFolder[]>([]);
const [getStats, setStats] = createSignal<{
  folderCount: number;
  totalImages: number;
  totalVideos: number;
  totalSize: number;
}>({
  folderCount: 0,
  totalImages: 0,
  totalVideos: 0,
  totalSize: 0,
});
const [getLoading, setLoading] = signal<boolean>(false);
const [getHasAttemptedLoad, setHasAttemptedLoad] = signal<boolean>(false);
const [getError, setError] = signal<string | null>(null);
const [getSortBy, setSortBy] = signal<"priority" | "name">("priority");
const [getSortDirection, setSortDirection] = signal<"asc" | "desc">("asc");

// Remove folder confirmation dialog state
const [getShowRemoveConfirm, setShowRemoveConfirm] = signal<boolean>(false);
const [getRemoveTarget, setRemoveTarget] = signal<{ id: number; path: string } | null>(null);

// RPC client reference (will be initialized from mainview.ts)
let rpcClient: {
  listFolders: () => Promise<ScanFolder[]>;
  getFolderStats: () => Promise<{
    folderCount: number;
    totalImages: number;
    totalVideos: number;
    totalSize: number;
  }>;
  addFolder: (params: {
    path: string;
    priority?: number;
    scanSubdirectories?: boolean;
  }) => Promise<{ success: boolean; folder: ScanFolder }>;
  updateFolder: (params: {
    id: number;
    priority?: number;
    status?: "added" | "scanning" | "ready" | "error";
    scanSubdirectories?: boolean;
    includeVideos?: boolean;
  }) => Promise<{ success: boolean; folder: ScanFolder }>;
  removeFolder: (params: { id: number }) => Promise<{ success: boolean }>;
  showFolderPicker: () => Promise<{ success: boolean; path: string | null }>;
  scanFolderQuick: (params: { id: number }) => Promise<{ success: boolean; folder: ScanFolder }>;
} | null = null;

/**
 * Initialize the folders service with an RPC client
 */
export function initFoldersService(rpc: typeof rpcClient): void {
  rpcClient = rpc;
  // Reset loading state when RPC client is initialized to handle race conditions
  if (getLoading()) {
    setLoading(false);
  }
}

/**
 * Load folders and stats from RPC
 */
async function loadFolders(): Promise<void> {
  if (!rpcClient) {
    setError("RPC client not initialized");
    setLoading(false);
    setHasAttemptedLoad(true);
    return;
  }

  setLoading(true);
  setError(null);
  setHasAttemptedLoad(true);

  try {
    const [folders, stats] = await Promise.all([rpcClient.listFolders(), rpcClient.getFolderStats()]);
    // Sort folders based on current sort setting
    const sorted = sortFolders(folders);
    setFolders(sorted);
    setStats(stats);
  } catch (error) {
    log.error("Failed to load folders", error);
    setError(error instanceof Error ? error.message : "Failed to load folders");
  } finally {
    setLoading(false);
  }
}

/**
 * Format bytes to human-readable size
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / k ** i).toFixed(1)} ${sizes[i]}`;
}

/**
 * Format number with approximate indicator
 */
function formatApprox(value: number): string {
  if (value === 0) return "0";
  if (value < 1000) return String(value);
  return `~${(value / 1000).toFixed(1)}k`;
}

/**
 * Sort folders based on current sort setting
 */
function sortFolders(folders: ScanFolder[]): ScanFolder[] {
  const sortBy = getSortBy();
  const direction = getSortDirection();
  const sorted = [...folders];
  const multiplier = direction === "asc" ? 1 : -1;

  if (sortBy === "priority") {
    // Sort by priority, then by name as secondary sort
    sorted.sort((a, b) => {
      if (a.priority !== b.priority) {
        return (a.priority - b.priority) * multiplier;
      }
      return a.path.localeCompare(b.path);
    });
  } else {
    // Sort by name (alphabetical)
    sorted.sort((a, b) => a.path.localeCompare(b.path) * multiplier);
  }

  return sorted;
}

/**
 * Handle sorting by name
 * Toggles direction if already sorting by name, otherwise switches to name with asc
 */
function handleSortByName(): void {
  const currentSort = getSortBy();
  if (currentSort === "name") {
    // Toggle direction
    const newDirection = getSortDirection() === "asc" ? "desc" : "asc";
    setSortDirection(newDirection);
  } else {
    // Switch to name sorting with ascending
    setSortBy("name");
    setSortDirection("asc");
  }
  // Re-sort folders
  const sorted = sortFolders(getFolders());
  setFolders(sorted);
}

/**
 * Handle sorting by priority
 * Toggles direction if already sorting by priority, otherwise switches to priority with asc
 */
function handleSortByPriority(): void {
  const currentSort = getSortBy();
  if (currentSort === "priority") {
    // Toggle direction
    const newDirection = getSortDirection() === "asc" ? "desc" : "asc";
    setSortDirection(newDirection);
  } else {
    // Switch to priority sorting with ascending
    setSortBy("priority");
    setSortDirection("asc");
  }
  // Re-sort folders
  const sorted = sortFolders(getFolders());
  setFolders(sorted);
}

/**
 * Sortable column header component
 */
function SortableHeader({
  label,
  sortKey,
  onClick,
}: {
  label: string;
  sortKey: "priority" | "name";
  onClick: () => void;
}) {
  return () => {
    const sortBy = getSortBy();
    const direction = getSortDirection();
    const isActive = sortBy === sortKey;

    // Determine icon based on sort key and direction
    let iconClass = "";
    if (isActive) {
      if (sortKey === "name") {
        iconClass = direction === "asc" ? "fa-arrow-down-a-z" : "fa-arrow-up-a-z";
      } else {
        iconClass = direction === "asc" ? "fa-arrow-down-1-9" : "fa-arrow-up-1-9";
      }
    }

    return button(
      {
        class: `flex items-center gap-2 text-xs font-medium uppercase tracking-wide transition-colors cursor-pointer ${
          isActive ? "text-fg-3" : "text-fg-muted hover:text-fg-3"
        }`,
        onclick: onClick,
        title: isActive
          ? `Click to sort ${direction === "asc" ? "descending" : "ascending"}`
          : `Click to sort by ${sortKey === "name" ? "name" : "priority"}`,
      },
      span({}, label),
      isActive
        ? i({
            class: `fadr text-xs ${iconClass}`,
          })
        : null,
    );
  };
}

/**
 * Handle adding a new folder
 */
async function handleAddFolder(): Promise<void> {
  if (!rpcClient) {
    setError("RPC client not initialized");
    return;
  }

  setError(null);

  try {
    // Show native folder picker dialog (don't set loading yet - user might cancel)
    const pickerResult = await rpcClient.showFolderPicker();

    if (!pickerResult.success || !pickerResult.path) {
      // User cancelled or error occurred - no loading state needed
      return;
    }

    // Add the selected folder (loadFolders will set loading state)
    const addResult = await rpcClient.addFolder({ path: pickerResult.path });
    // Reload to get updated list (this will set loading state internally)
    await loadFolders();

    // Auto quick scan the newly added folder
    if (addResult.success && addResult.folder) {
      await handleQuickScan(addResult.folder.id);
    }
  } catch (error) {
    log.error("Failed to add folder", error);
    setError(error instanceof Error ? error.message : "Failed to add folder");
  } finally {
    setLoading(false);
  }
}

/**
 * Handle updating folder priority
 */
async function handleUpdatePriority(folderId: number, priority: number): Promise<void> {
  if (!rpcClient) {
    setError("RPC client not initialized");
    return;
  }

  setLoading(true);
  setError(null);

  try {
    await rpcClient.updateFolder({ id: folderId, priority });
    await loadFolders(); // Reload to get updated list
  } catch (error) {
    log.error("Failed to update folder", error);
    setError(error instanceof Error ? error.message : "Failed to update folder");
  } finally {
    setLoading(false);
  }
}

/**
 * Handle removing a folder
 */
function handleRemoveFolder(folderId: number, folderPath: string): void {
  if (!rpcClient) {
    setError("RPC client not initialized");
    return;
  }

  // Show custom confirmation dialog
  setRemoveTarget({ id: folderId, path: folderPath });
  setShowRemoveConfirm(true);
}

/** Confirm folder removal (called from dialog) */
async function confirmRemoveFolder(): Promise<void> {
  const target = getRemoveTarget();
  if (!target || !rpcClient) return;

  setShowRemoveConfirm(false);
  setRemoveTarget(null);
  setLoading(true);
  setError(null);

  try {
    await rpcClient.removeFolder({ id: target.id });
    await loadFolders(); // Reload to get updated list
    // Invalidate review cache so stale duplicates from the deleted folder are cleared
    invalidateReviewCache();
  } catch (error) {
    log.error("Failed to remove folder", error);
    setError(error instanceof Error ? error.message : "Failed to remove folder");
  } finally {
    setLoading(false);
  }
}

/** Cancel folder removal dialog */
function cancelRemoveFolder(): void {
  setShowRemoveConfirm(false);
  setRemoveTarget(null);
}

/**
 * Handle updating scanSubdirectories setting
 */
async function handleUpdateScanSubdirectories(folderId: number, scanSubdirectories: boolean): Promise<void> {
  if (!rpcClient) {
    setError("RPC client not initialized");
    return;
  }

  setError(null);

  // Optimistically update the folder in local state
  const folders = getFolders();
  const updatedFolders = folders.map((f) => (f.id === folderId ? { ...f, scanSubdirectories } : f));
  setFolders(updatedFolders);

  try {
    await rpcClient.updateFolder({ id: folderId, scanSubdirectories });
    // No need to reload - we already updated the local state
  } catch (error) {
    log.error("Failed to update folder", error);
    setError(error instanceof Error ? error.message : "Failed to update folder");
    // Revert the optimistic update on error
    await loadFolders();
  }
}

/**
 * Handle updating includeVideos setting
 */
async function handleUpdateIncludeVideos(folderId: number, includeVideos: boolean): Promise<void> {
  if (!rpcClient) {
    setError("RPC client not initialized");
    return;
  }

  setError(null);

  // Optimistically update the folder in local state
  const folders = getFolders();
  const updatedFolders = folders.map((f) => (f.id === folderId ? { ...f, includeVideos } : f));
  setFolders(updatedFolders);

  try {
    await rpcClient.updateFolder({ id: folderId, includeVideos });
    // When disabling, reload folders to get updated counts (videos were deleted)
    if (!includeVideos) {
      await loadFolders();
    }
  } catch (error) {
    log.error("Failed to update folder", error);
    setError(error instanceof Error ? error.message : "Failed to update folder");
    // Revert the optimistic update on error
    await loadFolders();
  }
}

/**
 * Handle quick scanning a folder
 */
async function handleQuickScan(folderId: number): Promise<void> {
  if (!rpcClient) {
    setError("RPC client not initialized");
    return;
  }

  setError(null);

  // Optimistically update the folder status to scanning
  const folders = getFolders();
  const updatedFolders = folders.map((f) => (f.id === folderId ? { ...f, status: "scanning" as const } : f));
  setFolders(updatedFolders);

  try {
    await rpcClient.scanFolderQuick({ id: folderId });
    await loadFolders(); // Reload to get updated list with scan results
  } catch (error) {
    log.error("Failed to scan folder", error);
    setError(error instanceof Error ? error.message : "Failed to scan folder");
    await loadFolders(); // Reload to reset state
  }
}

/**
 * Priority dropdown component — custom div/button dropdown (not native <select>)
 * because Electrobun's CEF webview makes native <select> non-interactive after RPC calls.
 */
function PrioritySelect({ folderId, currentPriority }: { folderId: number; currentPriority: number }) {
  const [getOpen, setOpen] = signal(false);
  const options = [
    { value: 1, label: "1 - Highest" },
    { value: 2, label: "2 - High" },
    { value: 3, label: "3 - Medium" },
    { value: 4, label: "4 - Low" },
    { value: 5, label: "5 - Lowest" },
  ];

  // Track portalled menu and trigger for positioning and outside-click cleanup
  let triggerEl: HTMLElement | null = null;
  let portalledMenu: HTMLElement | null = null;

  function removePortalledMenu() {
    if (portalledMenu?.parentElement === document.body) {
      document.body.removeChild(portalledMenu);
    }
    portalledMenu = null;
  }

  function handleDocumentClick(e: MouseEvent) {
    if (!getOpen()) return;
    const target = e.target as Node;
    if (triggerEl?.contains(target) || portalledMenu?.contains(target)) return;
    setOpen(false);
  }
  document.addEventListener("click", handleDocumentClick, true);

  return () => {
    const priority = currentPriority;
    const isOpen = getOpen();
    const selectedLabel = options.find((o) => o.value === priority)?.label ?? `${priority}`;

    // Clean up any previously portalled menu on every re-run
    removePortalledMenu();

    const triggerBtn = button(
      {
        class:
          "w-full px-2 py-1.5 rounded-lg bg-surface-inset border border-zinc-300 dark:border-zinc-600 text-xs text-fg-2 flex items-center justify-between gap-1 cursor-pointer hover:bg-surface-hover",
        onclick: (e: MouseEvent) => {
          e.stopPropagation();
          setOpen(!isOpen);
        },
      },
      span({}, selectedLabel),
      i({ class: `fadr fa-chevron-down text-fg-faint text-[10px] ${isOpen ? "rotate-180" : ""}` }),
    );
    triggerEl = triggerBtn;

    if (!isOpen) {
      return div({ class: "relative" }, triggerBtn);
    }

    // Build menu options
    const menu = document.createElement("div");
    menu.className = "fixed z-[100] bg-surface-card border border-edge rounded-lg shadow-xl py-1 min-w-[8rem]";

    for (const opt of options) {
      const optBtn = button(
        {
          class: `w-full px-3 py-1.5 text-xs text-left flex items-center gap-2 ${
            opt.value === priority ? "bg-blue-600/20 text-accent-blue font-medium" : "text-fg-3 hover:bg-surface-hover"
          }`,
          onclick: (e: MouseEvent) => {
            e.stopPropagation();
            setOpen(false);
            if (opt.value !== priority) {
              handleUpdatePriority(folderId, opt.value);
            }
          },
        },
        opt.value === priority ? i({ class: "fadr fa-check text-[10px]" }) : span({ class: "w-3" }),
        opt.label,
      );
      menu.appendChild(optBtn);
    }

    portalledMenu = menu;

    // Portal to document.body and position relative to trigger
    requestAnimationFrame(() => {
      if (menu.parentElement !== document.body) {
        document.body.appendChild(menu);
      }
      if (triggerEl) {
        const r = triggerEl.getBoundingClientRect();
        menu.style.top = `${r.bottom + 2}px`;
        menu.style.left = `${r.left}px`;
        menu.style.width = `${r.width}px`;
      }
    });

    return div({ class: "relative" }, triggerBtn);
  };
}

/**
 * Status badge component
 */
function StatusBadge({ status }: { status: "added" | "scanning" | "ready" | "error" }) {
  return () => {
    const statusConfig = {
      added: {
        class: "bg-gray-500/20 text-gray-400",
        icon: "fa-circle-plus",
        label: "Added",
      },
      scanning: {
        class: "bg-blue-500/20 text-accent-blue",
        icon: "fa-spinner fa-spin",
        label: "Scanning",
      },
      ready: {
        class: "bg-emerald-500/20 text-accent-green",
        icon: "fa-circle-check",
        label: "Ready",
      },
      error: {
        class: "bg-red-500/20 text-accent-red",
        icon: "fa-circle-exclamation",
        label: "Error",
      },
    };

    const config = statusConfig[status];

    return span(
      {
        class: `px-2.5 py-1 rounded-full text-xs font-medium ${config.class}`,
      },
      i({ class: `fadr ${config.icon} mr-1` }),
      config.label,
    );
  };
}

/**
 * Subdirectories toggle component - sliding toggle switch
 */
function SubdirectoriesToggle({ folderId, enabled }: { folderId: number; enabled: boolean }) {
  return () => {
    const isEnabled = enabled;

    return button(
      {
        class:
          "relative w-12 h-6 rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-zinc-50 dark:focus:ring-offset-zinc-800 focus:ring-emerald-500/50 " +
          (isEnabled ? "bg-emerald-500/40" : "bg-zinc-300/40 dark:bg-zinc-600/40"),
        onclick: () => handleUpdateScanSubdirectories(folderId, !isEnabled),
        title: isEnabled
          ? "Scanning subdirectories (click to disable)"
          : "Not scanning subdirectories (click to enable)",
        role: "switch",
        "aria-checked": String(isEnabled),
      },
      // Sliding knob
      span({
        class:
          "absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200 " +
          (isEnabled ? "translate-x-6" : "translate-x-0"),
      }),
    );
  };
}

/**
 * Include videos toggle component - sliding toggle switch
 */
function IncludeVideosToggle({ folderId, enabled }: { folderId: number; enabled: boolean }) {
  return () => {
    const isEnabled = enabled;

    return button(
      {
        class:
          "relative w-12 h-6 rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-zinc-50 dark:focus:ring-offset-zinc-800 focus:ring-emerald-500/50 " +
          (isEnabled ? "bg-emerald-500/40" : "bg-zinc-300/40 dark:bg-zinc-600/40"),
        onclick: () => handleUpdateIncludeVideos(folderId, !isEnabled),
        title: isEnabled ? "Including videos (click to exclude)" : "Excluding videos (click to include)",
        role: "switch",
        "aria-checked": String(isEnabled),
      },
      // Sliding knob
      span({
        class:
          "absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200 " +
          (isEnabled ? "translate-x-6" : "translate-x-0"),
      }),
    );
  };
}

/**
 * Folder row component
 */
function FolderRow({ folder }: { folder: ScanFolder }) {
  return div(
    {
      class: "flex items-center gap-4 px-5 py-4 hover:bg-zinc-200/30 dark:hover:bg-zinc-700/30 transition-colors group",
    },
    // Folder icon
    i({
      class: `fadr fa-folder-open text-2xl text-amber-400 ${folder.status === "scanning" ? "fa-beat-fade" : ""}`,
    }),
    // Folder info
    div(
      { class: "flex-1 min-w-0" },
      div({ class: "flex items-center gap-2" }, p({ class: "font-medium truncate" }, folder.path)),
      div(
        { class: "flex items-center gap-4 text-xs text-fg-muted mt-1" },
        span({}, i({ class: "fadr fa-image text-blue-400 mr-1" }), `${formatApprox(folder.imageCount)} images`),
        span({}, i({ class: "fadr fa-film text-violet-400 mr-1" }), `${formatApprox(folder.videoCount)} videos`),
        span({}, i({ class: "fadr fa-hard-drive mr-1" }), formatBytes(folder.totalSize)),
      ),
    ),
    // Subdirectories toggle
    div(
      { class: "w-24 flex justify-center" },
      SubdirectoriesToggle({ folderId: folder.id, enabled: folder.scanSubdirectories }),
    ),
    // Include videos toggle
    div(
      { class: "w-24 flex justify-center" },
      IncludeVideosToggle({ folderId: folder.id, enabled: folder.includeVideos }),
    ),
    // Priority dropdown
    div({ class: "w-32" }, PrioritySelect({ folderId: folder.id, currentPriority: folder.priority })),
    // Status badge
    div({ class: "w-24 flex justify-center" }, StatusBadge({ status: folder.status })),
    // Scan button
    button(
      {
        class: `p-2 rounded-lg transition-colors ${
          folder.status === "scanning"
            ? "bg-blue-500/20 text-accent-blue cursor-not-allowed"
            : "hover:bg-blue-600/20 text-fg-muted hover:text-accent-blue"
        }`,
        onclick: folder.status === "scanning" ? undefined : () => handleQuickScan(folder.id),
        title: folder.status === "scanning" ? "Scanning..." : "Rescan",
        disabled: folder.status === "scanning",
      },
      i({ class: `fadr ${folder.status === "scanning" ? "fa-spinner fa-spin" : "fa-arrows-rotate"}` }),
    ),
    // Delete button
    button(
      {
        class: "p-2 hover:bg-red-600/20 hover:text-accent-red rounded-lg transition-colors text-fg-muted",
        onclick: () => handleRemoveFolder(folder.id, folder.path),
        title: "Delete folder",
      },
      i({ class: "fadr fa-trash" }),
    ),
  );
}

/**
 * Stats card component
 */
function StatsCard({
  icon,
  iconColor,
  value,
  label,
}: {
  icon: string;
  iconColor: string;
  value: () => string | number;
  label: string;
}) {
  return div(
    { class: "bg-surface-card rounded-lg border border-edge p-4" },
    div(
      { class: "flex items-center gap-3" },
      div(
        { class: `w-10 h-10 rounded-lg ${iconColor} flex items-center justify-center` },
        i({ class: `fadr ${icon}` }),
      ),
      div(
        {},
        () => p({ class: "text-2xl font-semibold" }, String(value())),
        p({ class: "text-xs text-fg-muted" }, label),
      ),
    ),
  );
}

/** Remove Folder Confirmation Dialog */
function RemoveFolderDialog() {
  return () => {
    if (!getShowRemoveConfirm()) {
      return div();
    }

    const target = getRemoveTarget();
    const folderPath = target?.path ?? "";

    return div(
      {
        class: "fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4",
        onclick: (e: MouseEvent) => {
          if (e.target === e.currentTarget) {
            cancelRemoveFolder();
          }
        },
      },
      div(
        {
          class: "bg-surface-card rounded-xl border border-edge shadow-2xl max-w-md w-full",
          onclick: (e: MouseEvent) => e.stopPropagation(),
        },
        // Header
        div(
          { class: "px-6 py-4 border-b border-edge" },
          div(
            { class: "flex items-center gap-3" },
            div(
              { class: "w-10 h-10 rounded-lg bg-red-500/20 text-accent-red flex items-center justify-center" },
              i({ class: "fadr fa-folder-xmark text-xl" }),
            ),
            div(
              {},
              h3({ class: "text-lg font-semibold text-fg" }, "Confirm Removal"),
              p({ class: "text-sm text-fg-muted mt-0.5" }, "This folder will be removed from scanning"),
            ),
          ),
        ),
        // Content
        div(
          { class: "px-6 py-4 space-y-3" },
          p({ class: "text-fg-3" }, "Are you sure you want to remove this folder?"),
          div(
            { class: "bg-zinc-50/50 dark:bg-zinc-900/50 border border-edge rounded-lg p-3 flex items-center gap-2" },
            i({ class: "fadr fa-folder text-fg-faint flex-shrink-0" }),
            p({ class: "text-sm text-fg-muted break-all" }, folderPath),
          ),
          p(
            { class: "text-sm text-fg-faint" },
            "Your files will not be deleted. Only the folder reference and its scan data will be removed.",
          ),
        ),
        // Footer
        div(
          { class: "px-6 py-4 border-t border-edge flex items-center justify-end gap-3" },
          button(
            {
              class:
                "px-4 py-2 rounded-lg bg-surface-inset hover:bg-surface-active text-fg-3 text-sm font-medium transition-colors",
              onclick: cancelRemoveFolder,
            },
            "Cancel",
          ),
          button(
            {
              class:
                "px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white text-sm font-medium transition-colors flex items-center gap-2",
              onclick: confirmRemoveFolder,
            },
            i({ class: "fadr fa-trash" }),
            "Remove Folder",
          ),
        ),
      ),
    );
  };
}

/**
 * Main folders view
 */
export function FoldersView() {
  // Load folders when view is created (only if we haven't attempted yet)
  if (!getHasAttemptedLoad() && !getLoading() && rpcClient) {
    loadFolders();
  }

  return div(
    { class: "h-full flex flex-col" },
    // Header
    header(
      { class: "flex-shrink-0 bg-surface border-b border-edge px-6 py-4 z-10" },
      div(
        { class: "flex items-center justify-between" },
        div(
          {},
          h2({ class: "text-xl font-semibold text-fg" }, "Source Folders"),
          p({ class: "text-sm text-fg-muted mt-0.5" }, "Manage folders to scan for images and videos"),
        ),
        button(
          {
            class:
              "px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium transition-colors flex items-center gap-2",
            onclick: handleAddFolder,
          },
          i({ class: "fadr fa-folder-plus" }),
          "Add Folder",
        ),
      ),
    ),
    // Content - scrollable area
    div(
      { class: "flex-1 overflow-auto p-6" },
      // Error message
      () => {
        const error = getError();
        if (error) {
          return div(
            {
              class: "mb-4 p-4 rounded-lg bg-red-500/20 border border-red-500/30 text-accent-red text-sm",
            },
            i({ class: "fadr fa-circle-exclamation mr-2" }),
            error,
          );
        }
        return null;
      },
      // Summary stats
      div(
        { class: "grid grid-cols-5 gap-4 mb-6" },
        StatsCard({
          icon: "fa-folders",
          iconColor: "bg-violet-500/20 text-violet-400",
          value: () => getStats().folderCount,
          label: "Folders",
        }),
        StatsCard({
          icon: "fa-image",
          iconColor: "bg-blue-500/20 text-accent-blue",
          value: () => formatApprox(getStats().totalImages),
          label: "Images",
        }),
        StatsCard({
          icon: "fa-film",
          iconColor: "bg-violet-500/20 text-violet-400",
          value: () => formatApprox(getStats().totalVideos),
          label: "Videos",
        }),
        StatsCard({
          icon: "fa-files",
          iconColor: "bg-cyan-500/20 text-cyan-400",
          value: () => formatApprox(getStats().totalImages + getStats().totalVideos),
          label: "Total Files",
        }),
        StatsCard({
          icon: "fa-hard-drive",
          iconColor: "bg-emerald-500/20 text-accent-green",
          value: () => formatBytes(getStats().totalSize),
          label: "Total Size",
        }),
      ),
      // Folder priority info
      div(
        {
          class:
            "bg-zinc-100/50 dark:bg-zinc-800/50 rounded-lg border border-zinc-200/50 dark:border-zinc-700/50 p-4 mb-4 flex items-start gap-3",
        },
        i({ class: "fadr fa-circle-info text-blue-400 mt-0.5" }),
        div(
          { class: "text-sm" },
          p({ class: "text-fg-3 font-medium" }, "Folder Priority for Duplicate Resolution"),
          p(
            { class: "text-fg-faint mt-1" },
            "When duplicates are found, files from higher priority folders will be suggested to keep. Click the 'Folder' column header to sort by name or priority. You can always override suggestions when reviewing duplicates.",
          ),
        ),
      ),
      // Folder list
      () => {
        const folders = getFolders();
        const loading = getLoading();
        const hasAttemptedLoad = getHasAttemptedLoad();

        // Only show loading spinner if we're actively loading AND we have an RPC client
        // AND we have attempted to load before (to avoid showing on initial mount)
        // AND we're not in the middle of adding a folder (which has its own loading state)
        if (loading && rpcClient && hasAttemptedLoad && folders.length > 0) {
          return div(
            { class: "flex items-center justify-center py-12 text-fg-muted" },
            i({ class: "fadr fa-spinner animate-spin text-2xl mr-3" }),
            "Loading folders...",
          );
        }

        // Show empty state if there are no folders
        // Don't show loading if RPC client isn't initialized or if we haven't attempted to load
        if (folders.length === 0) {
          return div(
            {
              class: "bg-surface-card rounded-xl border border-edge p-12 text-center",
            },
            i({ class: "fadr fa-folder-open text-4xl text-zinc-300 dark:text-zinc-600 mb-4" }),
            p({ class: "text-fg-muted mb-2" }, "No folders added yet"),
            p({ class: "text-sm text-fg-faint" }, "Click 'Add Folder' to get started"),
          );
        }

        return div(
          { class: "bg-surface-card rounded-xl border border-edge overflow-hidden" },
          // List header
          div(
            {
              class: "px-5 py-3 border-b border-edge bg-zinc-200/30 dark:bg-zinc-700/30 flex items-center gap-4",
            },
            div({ class: "flex-1" }, SortableHeader({ label: "Folder", sortKey: "name", onClick: handleSortByName })),
            div(
              { class: "w-24 text-center text-xs font-medium text-fg-muted uppercase tracking-wide whitespace-nowrap" },
              "Scan All",
            ),
            div(
              { class: "w-24 text-center text-xs font-medium text-fg-muted uppercase tracking-wide whitespace-nowrap" },
              "Videos",
            ),
            div(
              { class: "w-32 text-center" },
              SortableHeader({ label: "Priority", sortKey: "priority", onClick: handleSortByPriority }),
            ),
            div({ class: "w-24 text-center text-xs font-medium text-fg-muted uppercase tracking-wide" }, "Status"),
            div({ class: "w-20" }),
          ),
          // Folder rows
          div(
            { class: "divide-y divide-zinc-200 dark:divide-zinc-700" },
            ...folders.map((folder) => FolderRow({ folder })),
          ),
        );
      },
    ),
    // Remove folder confirmation dialog (overlay)
    RemoveFolderDialog(),
  );
}
