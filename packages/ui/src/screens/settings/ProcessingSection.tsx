/**
 * Processing: perceptual-hash similarity threshold and parallel workers.
 */
import { Cpu, Info } from "lucide-react";
import type { ReactNode } from "react";
import { SettingsRow, SettingsSection } from "./controls";
import { SelectDropdown } from "./SelectDropdown";
import type { SectionProps } from "./settings-draft";

const WORKER_OPTIONS = [
  { value: "1", label: "1 (Slowest)" },
  { value: "2", label: "2" },
  { value: "4", label: "4 (Recommended)" },
  { value: "8", label: "8" },
  { value: "16", label: "16 (Fastest)" },
];

export function ProcessingSection({ draft, update }: SectionProps): ReactNode {
  const threshold = draft.similarityThreshold;
  return (
    <SettingsSection
      icon={<Cpu size={16} />}
      iconColor="bg-blue-500/20 text-accent-blue"
      title="Processing"
      description="Configure how files are processed"
    >
      <div>
        <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3 mb-4">
          <div className="flex items-start gap-2">
            <Info size={14} className="text-blue-400 mt-0.5" />
            <div className="flex-1 text-xs">
              <p className="text-accent-blue font-medium mb-1">Perceptual Hashing Hamming Distance</p>
              <p className="text-accent-blue">
                Lower values are stricter (only very similar images). Recommended: 5 (catches duplicates with minor
                edits). Higher values may include false positives.
              </p>
            </div>
          </div>
        </div>
        <div className="flex items-center justify-between mb-2">
          <div>
            <p className="text-sm text-fg-2">Similarity Threshold</p>
            <p className="text-xs text-fg-faint">Maximum hamming distance for duplicate detection (0-10)</p>
          </div>
          <span className="text-sm font-medium text-accent-blue min-w-[50px] text-right">
            {`${threshold} ${threshold === 5 ? "(Recommended)" : ""}`}
          </span>
        </div>
        <input
          type="range"
          aria-label="Hamming distance"
          min={0}
          max={10}
          value={threshold}
          className="w-full h-2 bg-zinc-300 dark:bg-zinc-600 rounded-full appearance-none cursor-pointer accent-blue-500"
          onChange={(e) => update({ similarityThreshold: Number(e.target.value) })}
        />
        <div className="flex justify-between text-xs text-fg-faint mt-1">
          <span>0 (Identical only)</span>
          <span>5 (Recommended)</span>
          <span>10 (More matches)</span>
        </div>
      </div>
      <SettingsRow
        label="Parallel Workers"
        description="Number of concurrent file processors"
        control={
          <SelectDropdown
            label="Parallel Workers"
            value={String(draft.parallelWorkers)}
            onChange={(v) => update({ parallelWorkers: Number(v) })}
            options={WORKER_OPTIONS}
          />
        }
      />
    </SettingsSection>
  );
}
