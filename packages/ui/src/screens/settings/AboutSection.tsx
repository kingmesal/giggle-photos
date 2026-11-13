/**
 * About: app, Bun and Electrobun versions, platform, license.
 */
import { Info } from "lucide-react";
import type { ReactNode } from "react";
import type { AppInfo } from "../../services/app-info-service";
import { SettingsSection } from "./controls";

function AboutRow({ label, value }: { label: string; value: string }): ReactNode {
  return (
    <div className="flex items-center justify-between">
      <span className="text-fg-muted">{label}</span>
      <span className="text-fg-2">{value}</span>
    </div>
  );
}

export function AboutSection({ info }: { info: AppInfo | undefined }): ReactNode {
  const loading = "Loading...";
  return (
    <SettingsSection
      icon={<Info size={16} />}
      iconColor="bg-zinc-500/20 text-fg-muted"
      title="About"
      description="Application information"
    >
      <div className="space-y-3 text-sm">
        <AboutRow label="Version" value={info?.appVersion ?? loading} />
        <AboutRow label="Bun Version" value={info?.bunVersion ?? loading} />
        <AboutRow label="Electrobun" value={info?.electrobunVersion ?? loading} />
        <AboutRow label="Platform" value={info ? `${info.platform} (${info.arch})` : loading} />
        <AboutRow label="License" value="MIT" />
      </div>
    </SettingsSection>
  );
}
