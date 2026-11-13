/** One folder in the list: counts, toggles, priority, status, rescan and delete. */
import {
  CircleAlert,
  CircleCheck,
  CirclePlus,
  Film,
  FolderOpen,
  HardDrive,
  Image,
  LoaderCircle,
  type LucideIcon,
  RefreshCw,
  Smartphone,
  Trash2,
} from "lucide-react";
import type { ReactElement } from "react";
import type { FolderStatus, ScanFolder } from "../../services/folders-service";
import { formatApprox, formatBytes, ICON } from "./format";
import { PrioritySelect } from "./PrioritySelect";

const STATUS: Record<FolderStatus, { className: string; icon: LucideIcon; spin?: boolean; label: string }> = {
  added: { className: "bg-gray-500/20 text-gray-400", icon: CirclePlus, label: "Added" },
  scanning: { className: "bg-blue-500/20 text-accent-blue", icon: LoaderCircle, spin: true, label: "Scanning" },
  ready: { className: "bg-emerald-500/20 text-accent-green", icon: CircleCheck, label: "Ready" },
  error: { className: "bg-red-500/20 text-accent-red", icon: CircleAlert, label: "Error" },
};

export function StatusBadge({ status }: { status: FolderStatus }): ReactElement {
  const config = STATUS[status];
  const Icon = config.icon;
  return (
    <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${config.className}`}>
      <Icon size="1em" className={`${ICON} mr-1 ${config.spin ? "animate-spin" : ""}`} />
      {config.label}
    </span>
  );
}

/** Sliding toggle switch. */
export function ToggleSwitch({
  enabled,
  onToggle,
  titleOn,
  titleOff,
}: {
  enabled: boolean;
  onToggle: () => void;
  titleOn: string;
  titleOff: string;
}): ReactElement {
  return (
    <button
      type="button"
      className={`relative w-12 h-6 rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-zinc-50 dark:focus:ring-offset-zinc-800 focus:ring-emerald-500/50 ${
        enabled ? "bg-emerald-500/40" : "bg-zinc-300/40 dark:bg-zinc-600/40"
      }`}
      onClick={onToggle}
      title={enabled ? titleOn : titleOff}
      role="switch"
      aria-checked={enabled}
    >
      <span
        className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200 ${
          enabled ? "translate-x-6" : "translate-x-0"
        }`}
      />
    </button>
  );
}

export interface FolderRowActions {
  setScanSubdirectories: (id: number, enabled: boolean) => void;
  setIncludeVideos: (id: number, enabled: boolean) => void;
  setPriority: (id: number, priority: number) => void;
  quickScan: (id: number) => void;
  requestRemove: (folder: { id: number; path: string }) => void;
  /** Open the owner devices setup (RFD-005). */
  editDevices?: (folder: { id: number; path: string }) => void;
}

export function FolderRow({ folder, actions }: { folder: ScanFolder; actions: FolderRowActions }): ReactElement {
  const isScanning = folder.status === "scanning";
  return (
    <div
      className="flex items-center gap-4 px-5 py-4 hover:bg-zinc-200/30 dark:hover:bg-zinc-700/30 transition-colors group"
      data-testid="folder-row"
    >
      <FolderOpen
        size="1em"
        className={`${ICON} text-2xl text-amber-700 dark:text-amber-400 ${isScanning ? "animate-pulse" : ""}`}
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="font-medium truncate">{folder.path}</p>
        </div>
        <div className="flex items-center gap-4 text-xs text-fg-muted mt-1">
          <span>
            <Image size="1em" className={`${ICON} text-blue-700 dark:text-blue-400 mr-1`} />
            {`${formatApprox(folder.imageCount)} images`}
          </span>
          <span>
            <Film size="1em" className={`${ICON} text-violet-700 dark:text-violet-400 mr-1`} />
            {`${formatApprox(folder.videoCount)} videos`}
          </span>
          <span>
            <HardDrive size="1em" className={`${ICON} mr-1`} />
            {formatBytes(folder.totalSize)}
          </span>
        </div>
      </div>
      <div className="w-24 flex justify-center">
        <ToggleSwitch
          enabled={folder.scanSubdirectories}
          onToggle={() => actions.setScanSubdirectories(folder.id, !folder.scanSubdirectories)}
          titleOn="Scanning subdirectories (click to disable)"
          titleOff="Not scanning subdirectories (click to enable)"
        />
      </div>
      <div className="w-24 flex justify-center">
        <ToggleSwitch
          enabled={folder.includeVideos}
          onToggle={() => actions.setIncludeVideos(folder.id, !folder.includeVideos)}
          titleOn="Including videos (click to exclude)"
          titleOff="Excluding videos (click to include)"
        />
      </div>
      <div className="w-32">
        <PrioritySelect priority={folder.priority} onChange={(p) => actions.setPriority(folder.id, p)} />
      </div>
      <div className="w-24 flex justify-center">
        <StatusBadge status={folder.status} />
      </div>
      <button
        type="button"
        className={`p-2 rounded-lg transition-colors ${
          isScanning
            ? "bg-blue-500/20 text-accent-blue cursor-not-allowed"
            : "hover:bg-blue-600/20 text-fg-muted hover:text-accent-blue"
        }`}
        onClick={isScanning ? undefined : () => actions.quickScan(folder.id)}
        title={isScanning ? "Scanning..." : "Rescan"}
        disabled={isScanning}
      >
        {isScanning ? (
          <LoaderCircle size="1em" className={`${ICON} animate-spin`} />
        ) : (
          <RefreshCw size="1em" className={ICON} />
        )}
      </button>
      {actions.editDevices && (
        <button
          type="button"
          className="p-2 rounded-lg transition-colors hover:bg-violet-600/20 text-fg-muted hover:text-violet-400"
          onClick={() => actions.editDevices?.({ id: folder.id, path: folder.path })}
          title="Owner devices"
          aria-label="Owner devices"
        >
          <Smartphone size="1em" className={ICON} />
        </button>
      )}
      <button
        type="button"
        className="p-2 hover:bg-red-600/20 hover:text-accent-red rounded-lg transition-colors text-fg-muted"
        onClick={() => actions.requestRemove({ id: folder.id, path: folder.path })}
        title="Delete folder"
      >
        <Trash2 size="1em" className={ICON} />
      </button>
    </div>
  );
}
