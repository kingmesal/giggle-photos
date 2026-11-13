/** One pipeline step: status circle and connector line, clickable header with badge, and its content. */
import { Check, ChevronDown, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { STEP_ICONS } from "./icons";
import type { PipelineStep, StepStatus } from "./pipeline-logic";

const BADGES: Record<StepStatus, { className: string; text: string }> = {
  completed: { className: "bg-emerald-500/20 text-accent-green", text: "Completed" },
  "in-progress": { className: "bg-blue-500/20 text-accent-blue", text: "In Progress" },
  ready: { className: "bg-blue-500/20 text-accent-blue", text: "Ready" },
  pending: { className: "bg-surface-inset text-fg-muted", text: "Pending" },
};

const CIRCLES: Record<StepStatus, string> = {
  completed: "bg-emerald-500",
  "in-progress": "bg-blue-500",
  ready: "bg-surface-card border-2 border-blue-500",
  pending: "bg-surface-inset border-2 border-zinc-300 dark:border-zinc-600",
};

const LINES: Record<StepStatus, string> = {
  completed: "bg-emerald-500",
  "in-progress": "bg-gradient-to-b from-blue-500 to-zinc-300 dark:to-zinc-600",
  ready: "bg-zinc-300 dark:bg-zinc-600",
  pending: "bg-zinc-300 dark:bg-zinc-600",
};

function CircleIcon({ step, status }: { step: PipelineStep; status: StepStatus }): ReactNode {
  if (status === "completed") return <Check size="1em" className="text-white" aria-hidden="true" />;
  if (status === "in-progress") {
    const Icon = STEP_ICONS[step.icon];
    return <Icon size="1em" className="animate-pulse text-white" aria-hidden="true" />;
  }
  const color = status === "ready" ? "text-accent-blue" : "text-fg-muted";
  return <span className={`text-sm font-semibold ${color}`}>{step.id}</span>;
}

export interface StepCardProps {
  step: PipelineStep;
  status: StepStatus;
  isLastStep: boolean;
  isExpanded: boolean;
  content: ReactNode;
  onToggle: () => void;
}

/**
 * Pending steps are not expandable; an in-progress step always shows its content; completed and ready
 * steps expand and collapse on click.
 */
export function StepCard({ step, status, isLastStep, isExpanded, content, onToggle }: StepCardProps): ReactNode {
  const isExpandable = status !== "pending";
  const showContent = status === "in-progress" || (isExpandable && isExpanded);
  const titleClass =
    status === "completed" ? "text-accent-green" : status === "pending" ? "text-fg-muted" : "text-accent-blue";
  const descClass = status === "pending" ? "text-fg-faint" : "text-fg-muted";
  const badge = BADGES[status];
  const Chevron = showContent ? ChevronDown : ChevronRight;

  return (
    <div className="relative" data-step={step.stage} data-status={status}>
      <div className="flex items-start gap-4">
        <div className="flex flex-col items-center">
          <div className={`w-10 h-10 rounded-full ${CIRCLES[status]} flex items-center justify-center`}>
            <CircleIcon step={step} status={status} />
          </div>
          {!isLastStep && (
            <div className={`w-0.5 ${showContent && content ? "h-full" : "h-8"} ${LINES[status]} mt-2`} />
          )}
        </div>
        <div className={`flex-1 ${isLastStep ? "" : "pb-4"}`}>
          {/* biome-ignore lint/a11y/noStaticElementInteractions: a button would hide the step heading (h4) from the a11y tree */}
          {/* biome-ignore lint/a11y/useKeyWithClickEvents: same mouse-only header as the Sigment view */}
          <div
            className={`flex items-center justify-between ${isExpandable ? "cursor-pointer hover:bg-zinc-200/30 dark:hover:bg-zinc-700/30" : ""} -mx-2 px-2 py-1 rounded-lg`}
            onClick={isExpandable ? onToggle : undefined}
          >
            <div className="flex items-center gap-2">
              {isExpandable ? (
                <Chevron size="1em" className="text-fg-faint text-xs transition-transform" aria-hidden="true" />
              ) : (
                <div className="w-3" />
              )}
              <div>
                <h4 className={`font-medium ${titleClass}`}>{step.title}</h4>
                <p className={`text-sm ${descClass} mt-0.5`}>{step.description}</p>
              </div>
            </div>
            <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${badge.className}`}>{badge.text}</span>
          </div>
          {showContent && content && (
            <div className="overflow-hidden transition-all duration-200 ease-in-out">{content}</div>
          )}
        </div>
      </div>
    </div>
  );
}
