/**
 * Visual similarity (CLIP): enable, execution provider, threads, review thresholds, advanced storage.
 *
 * The distance sliders sit behind a "Thresholds" disclosure (collapsed by default, current values shown
 * on it). The E2E parity spec asserts exactly one range input on the page while nothing is expanded.
 */
import { ChevronDown, ChevronRight, Info, ScanEye } from "lucide-react";
import { type ReactNode, useState } from "react";
import type { ClipExecutionProvider } from "../../services/settings-service";
import { activePreset, CLIP_PRESETS } from "./clip-presets";
import { type ClipDistanceField, formatDistance, setClipDistance } from "./clip-thresholds";
import { SettingsRow, SettingsSection, Toggle } from "./controls";
import { DistanceSlider } from "./DistanceSlider";
import { NumberField } from "./NumberField";
import { SelectDropdown } from "./SelectDropdown";
import type { SectionProps } from "./settings-draft";

const PROVIDER_OPTIONS: { value: ClipExecutionProvider; label: string }[] = [
  { value: "cpu", label: "CPU (default)" },
  { value: "coreml", label: "Core ML (macOS)" },
  { value: "dml", label: "DirectML (Windows)" },
  { value: "cuda", label: "CUDA (NVIDIA)" },
];

/** Giggle / Immich presets: fill the thresholds in (Save applies them, like any setting). */
function Presets({ draft, update }: SectionProps): ReactNode {
  const active = activePreset(draft);
  return (
    <fieldset aria-label="CLIP presets">
      <legend className="text-sm text-fg-2">Presets</legend>
      <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
        {CLIP_PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            aria-pressed={active === p.id}
            className={`text-left px-3 py-2 rounded-lg border text-sm ${
              active === p.id
                ? "border-violet-500/60 bg-violet-500/15 text-fg"
                : "border-edge bg-surface-inset hover:bg-surface-active text-fg-2"
            }`}
            onClick={() => update({ ...p.values })}
          >
            <span className="font-medium">{p.label}</span>
            <span className="block text-xs text-fg-muted mt-0.5">{p.description}</span>
          </button>
        ))}
      </div>
      {active === null && <p className="mt-1 text-xs text-fg-faint">Custom thresholds</p>}
    </fieldset>
  );
}

function Thresholds({ draft, update }: SectionProps): ReactNode {
  const setDistance = (field: ClipDistanceField, value: number) => update(setClipDistance(draft, field, value));
  return (
    <div className="space-y-5 pt-1">
      <DistanceSlider
        label="Same Photo Distance"
        description="Pairs at or below this are the same photo (crop, mirror, brightness)"
        value={draft.clipStrongMaxDistance}
        onChange={(v) => setDistance("clipStrongMaxDistance", v)}
      />
      <DistanceSlider
        label="Review Distance"
        description="Pairs up to this are offered for review (heavier edits, bursts). Never below the same-photo distance"
        value={draft.clipReviewMaxDistance}
        onChange={(v) => setDistance("clipReviewMaxDistance", v)}
      />
      <div className="pt-4 border-t border-edge space-y-5">
        <p className="text-xs font-medium uppercase tracking-wide text-fg-muted">Advanced</p>
        <DistanceSlider
          label="Storage Cutoff"
          description="Pairs up to this distance are stored. Raising it takes effect on the next embedding run"
          value={draft.clipStoreMaxDistance}
          onChange={(v) => setDistance("clipStoreMaxDistance", v)}
        />
        <SettingsRow
          label="Neighbours per Image"
          description="How many nearest images are compared with each image (1-1024)"
          control={
            <NumberField
              label="Neighbours per Image"
              value={draft.clipTopK}
              min={1}
              max={1024}
              onChange={(clipTopK) => update({ clipTopK })}
            />
          }
        />
      </div>
    </div>
  );
}

export function ClipSection({ draft, update }: SectionProps): ReactNode {
  const [expanded, setExpanded] = useState(false);
  return (
    <SettingsSection
      icon={<ScanEye size={16} />}
      iconColor="bg-violet-500/20 text-violet-700 dark:text-violet-400"
      title="Visual Similarity (CLIP)"
      description="Find the same photo after edits, using an on-device image model"
    >
      <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3">
        <div className="flex items-start gap-2">
          <Info size={14} className="text-blue-700 dark:text-blue-400 mt-0.5" />
          <p className="flex-1 text-xs text-accent-blue">
            Distances are cosine distances (0 = identical). The defaults are starting values: calibrate them on your own
            library. Pairs up to the storage cutoff are stored, so moving the review distances below it needs no
            recompute.
          </p>
        </div>
      </div>
      <SettingsRow
        label="Enable Visual Similarity"
        description="Compute image embeddings and match visually similar photos"
        control={
          <Toggle
            label="Enable Visual Similarity"
            value={draft.clipEnabled}
            onChange={(clipEnabled) => update({ clipEnabled })}
          />
        }
      />
      <SettingsRow
        label="Execution Provider"
        description="CPU is the default. Other providers fall back to CPU if they are not available"
        control={
          <SelectDropdown
            label="Execution Provider"
            value={draft.clipExecutionProvider}
            onChange={(v) => update({ clipExecutionProvider: v as ClipExecutionProvider })}
            options={PROVIDER_OPTIONS}
          />
        }
      />
      <SettingsRow
        label="Model Threads"
        description="Threads shared by concurrent embeddings (1-64). More than your cores slows things down"
        control={
          <NumberField
            label="Model Threads"
            value={draft.clipThreads}
            min={1}
            max={64}
            onChange={(clipThreads) => update({ clipThreads })}
          />
        }
      />
      <SettingsRow
        label="Review Similar Shots"
        description="Also offer pairs up to the storage cutoff for review (near-identical shots)"
        control={
          <Toggle
            label="Review Similar Shots"
            value={draft.clipSimilarShotsEnabled}
            onChange={(clipSimilarShotsEnabled) => update({ clipSimilarShotsEnabled })}
          />
        }
      />
      <Presets draft={draft} update={update} />
      <div>
        <button
          type="button"
          aria-expanded={expanded}
          className="w-full flex items-center justify-between gap-2 text-sm text-fg-2"
          onClick={() => setExpanded(!expanded)}
        >
          <span className="flex items-center gap-2">
            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            Thresholds
          </span>
          <span className="text-xs text-fg-faint font-mono">
            {`same ≤ ${formatDistance(draft.clipStrongMaxDistance)} · review ≤ ${formatDistance(draft.clipReviewMaxDistance)} · stored ≤ ${formatDistance(draft.clipStoreMaxDistance)}`}
          </span>
        </button>
        {expanded && (
          <div className="mt-4">
            <Thresholds draft={draft} update={update} />
          </div>
        )}
      </div>
    </SettingsSection>
  );
}
