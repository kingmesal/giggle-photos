/** Summary stat cards above the folder list. */
import { Files, Film, Folders, HardDrive, Image, type LucideIcon } from "lucide-react";
import type { ReactElement } from "react";
import type { FolderStats } from "../../services/folders-service";
import { formatApprox, formatBytes, ICON } from "./format";

function StatsCard({
  icon: Icon,
  iconColor,
  value,
  label,
}: {
  icon: LucideIcon;
  iconColor: string;
  value: string | number;
  label: string;
}): ReactElement {
  return (
    <div className="bg-surface-card rounded-lg border border-edge p-4">
      <div className="flex items-center gap-3">
        <div className={`w-10 h-10 rounded-lg ${iconColor} flex items-center justify-center`}>
          <Icon size="1em" className={ICON} />
        </div>
        <div>
          <p className="text-2xl font-semibold">{String(value)}</p>
          <p className="text-xs text-fg-muted">{label}</p>
        </div>
      </div>
    </div>
  );
}

export function StatsCards({ stats }: { stats: FolderStats }): ReactElement {
  return (
    <div className="grid grid-cols-5 gap-4 mb-6">
      <StatsCard
        icon={Folders}
        iconColor="bg-violet-500/20 text-violet-400"
        value={stats.folderCount}
        label="Folders"
      />
      <StatsCard
        icon={Image}
        iconColor="bg-blue-500/20 text-accent-blue"
        value={formatApprox(stats.totalImages)}
        label="Images"
      />
      <StatsCard
        icon={Film}
        iconColor="bg-violet-500/20 text-violet-400"
        value={formatApprox(stats.totalVideos)}
        label="Videos"
      />
      <StatsCard
        icon={Files}
        iconColor="bg-cyan-500/20 text-cyan-400"
        value={formatApprox(stats.totalImages + stats.totalVideos)}
        label="Total Files"
      />
      <StatsCard
        icon={HardDrive}
        iconColor="bg-emerald-500/20 text-accent-green"
        value={formatBytes(stats.totalSize)}
        label="Total Size"
      />
    </div>
  );
}
