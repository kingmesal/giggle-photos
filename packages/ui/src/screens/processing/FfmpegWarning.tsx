/** Banner shown when ffprobe is missing: video processing is unavailable until FFmpeg is installed. */
import { Info, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import type { SystemHealth } from "../../services/system-health-service";
import { INLINE_ICON } from "./icons";

export function ffmpegInstructions(platform: string): string {
  switch (platform) {
    case "darwin":
      return "brew install ffmpeg";
    case "win32":
      return "# Option 1: Download from https://ffmpeg.org/download.html\n# Option 2: Using Chocolatey\nchoco install ffmpeg\n# Option 3: Using winget\nwinget install ffmpeg";
    default:
      return "# Ubuntu/Debian\nsudo apt install ffmpeg\n# Fedora\nsudo dnf install ffmpeg\n# Arch Linux\nsudo pacman -S ffmpeg";
  }
}

export function FfmpegWarning({ health }: { health: SystemHealth }): ReactNode {
  return (
    <div className="mb-6 p-4 rounded-lg bg-amber-500/20 border border-amber-500/30">
      <div className="flex items-start gap-3">
        <TriangleAlert size="1em" className="text-accent-amber text-xl mt-0.5" aria-hidden="true" />
        <div className="flex-1">
          <h3 className="text-accent-amber font-semibold mb-1">FFmpeg Not Installed</h3>
          <p className="text-amber-800 dark:text-amber-200/80 text-sm mb-3">
            FFmpeg is required for video processing and metadata extraction. Video files will be skipped during
            processing until ffprobe is installed.
          </p>
          <div className="bg-zinc-50/50 dark:bg-zinc-900/50 rounded-lg p-3 mb-3">
            <p className="text-fg-muted text-xs mb-2 font-medium">Installation instructions:</p>
            <pre className="text-amber-800 dark:text-amber-200/90 text-xs font-mono whitespace-pre-wrap">
              {ffmpegInstructions(health.platform)}
            </pre>
          </div>
          <p className="text-amber-800 dark:text-amber-200/60 text-xs">
            <Info size="1em" className={`${INLINE_ICON} mr-1`} aria-hidden="true" />
            Restart the application after installing FFmpeg to enable video processing.
          </p>
        </div>
      </div>
    </div>
  );
}
