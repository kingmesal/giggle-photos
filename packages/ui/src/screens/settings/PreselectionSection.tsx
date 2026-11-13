/**
 * Preselection rule order (RFD-005): which rule decides first when duplicates disagree. Album keeps
 * album copies (so albums survive the import); owner device keeps the copy in the folder whose owner's
 * camera took the photo (set per folder on the Folders screen).
 */
import { ArrowDown, ArrowUp, ListOrdered } from "lucide-react";
import type { ReactNode } from "react";
import type { PreselectRule } from "../../services/settings-service";
import { SettingsSection } from "./controls";
import type { SectionProps } from "./settings-draft";

const RULES: Record<PreselectRule, { label: string; description: string }> = {
  album: {
    label: "Album copies",
    description: "Keep copies that are in an album, so they stay in that album after import",
  },
  owner_device: {
    label: "Owner's device",
    description: "Keep the copy in the folder whose owner's camera took the photo (Folders → owner devices)",
  },
};
const ARROW = "p-1.5 rounded hover:bg-surface-active text-fg-muted disabled:opacity-30 disabled:cursor-not-allowed";

export function PreselectionSection({ draft, update }: SectionProps): ReactNode {
  const order = draft.preselectRuleOrder;
  const move = (index: number, by: -1 | 1) => {
    const next = [...order];
    const [rule] = next.splice(index, 1);
    if (rule) next.splice(index + by, 0, rule);
    update({ preselectRuleOrder: next });
  };
  return (
    <SettingsSection
      icon={<ListOrdered size={16} />}
      iconColor="bg-violet-500/20 text-violet-400"
      title="Preselection"
      description="When duplicates disagree, the first rule that tells the copies apart decides what is kept"
    >
      <ol className="space-y-2" aria-label="Preselection rule order">
        {order.map((rule, i) => (
          <li
            key={rule}
            className="flex items-center gap-3 rounded-lg bg-surface-inset border border-edge px-3 py-2"
            data-testid={`preselect-rule-${rule}`}
          >
            <span className="w-6 text-center text-sm font-mono text-fg-faint">{i + 1}</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm text-fg-2">{RULES[rule].label}</p>
              <p className="text-xs text-fg-faint">{RULES[rule].description}</p>
            </div>
            <button
              type="button"
              className={ARROW}
              disabled={i === 0}
              onClick={() => move(i, -1)}
              aria-label={`Move ${RULES[rule].label} up`}
            >
              <ArrowUp size="1em" />
            </button>
            <button
              type="button"
              className={ARROW}
              disabled={i === order.length - 1}
              onClick={() => move(i, 1)}
              aria-label={`Move ${RULES[rule].label} down`}
            >
              <ArrowDown size="1em" />
            </button>
          </li>
        ))}
      </ol>
      <p className="text-xs text-fg-faint">
        Exact duplicates keep every album copy once the album rule decides. Everything else (sidecars, resolution,
        folder priority, date) breaks ties after these rules, and you can always override in review.
      </p>
    </SettingsSection>
  );
}
