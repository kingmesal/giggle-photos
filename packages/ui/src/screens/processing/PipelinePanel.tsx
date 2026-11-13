/** The pipeline card: the five steps (auto-expanding the current one) and the overall progress bar. */
import { type ReactNode, useState } from "react";
import type { PipelineState, ProcessingStatus, ResultsSummary } from "../../services/processing-view-service";
import { InProgressContent, ReadyContent } from "./ActiveStepContent";
import { CompletedStepContent } from "./CompletedStepContent";
import { OverallProgressBar } from "./OverallProgressBar";
import {
  autoExpandTarget,
  currentStepIndex,
  getStepStatus,
  isPausedBetweenStages,
  overallProgress,
  PIPELINE_STEPS,
  type PipelineStep,
  type StepStatus,
} from "./pipeline-logic";
import { reviewStepContent } from "./ReviewStepContent";
import { StepCard } from "./StepCard";

export interface PipelinePanelProps {
  state: PipelineState;
  status: ProcessingStatus | null;
  summary: ResultsSummary | null;
  isPaused: boolean;
}

function stepContent(step: PipelineStep, stepStatus: StepStatus, props: PipelinePanelProps): ReactNode {
  const progress = props.status?.progress ?? null;
  if (step.stage === "complete") {
    const review = reviewStepContent(props.summary, stepStatus === "completed");
    if (review) return review;
  }
  if (stepStatus === "completed") return <CompletedStepContent step={step} progress={progress} state={props.state} />;
  if (stepStatus === "in-progress" && progress) return <InProgressContent progress={progress} />;
  if (stepStatus === "ready") return <ReadyContent step={step} progress={progress} state={props.state} />;
  return null;
}

/** Expanded step ids, re-targeted to the current step whenever it changes (adjusted during render). */
function useExpandedSteps(target: number): [Set<number>, (stepId: number) => void] {
  const [expanded, setExpanded] = useState<{ target: number | null; ids: Set<number> }>({
    target: null,
    ids: new Set([1]),
  });
  let current = expanded;
  if (expanded.target !== target) {
    current = { target, ids: new Set(target > 0 ? [target] : []) };
    setExpanded(current);
  }
  const toggle = (stepId: number): void =>
    setExpanded((prev) => {
      const ids = new Set(prev.ids);
      if (ids.has(stepId)) ids.delete(stepId);
      else ids.add(stepId);
      return { ...prev, ids };
    });
  return [current.ids, toggle];
}

export function PipelinePanel(props: PipelinePanelProps): ReactNode {
  const { state, status, isPaused } = props;
  const progress = status?.progress ?? null;
  const isRunning = status?.isRunning ?? false;
  const stepIndex = currentStepIndex(progress, isRunning, state);
  const between = isPausedBetweenStages(progress, isPaused, isRunning);
  const effectiveIndex = between ? stepIndex + 1 : stepIndex;
  const effectiveRunning = between ? false : isRunning;
  const [expanded, toggle] = useExpandedSteps(autoExpandTarget(effectiveIndex, effectiveRunning));
  const overall = overallProgress(progress, isRunning, isPaused, effectiveIndex, state);

  return (
    <div className="bg-surface-card rounded-xl border border-edge overflow-hidden">
      <div className="p-5">
        <div className="space-y-2">
          {PIPELINE_STEPS.map((step, idx) => {
            const stepStatus = getStepStatus(idx, effectiveIndex, effectiveRunning);
            return (
              <StepCard
                key={step.id}
                step={step}
                status={stepStatus}
                isLastStep={idx === PIPELINE_STEPS.length - 1}
                isExpanded={expanded.has(step.id)}
                content={stepContent(step, stepStatus, props)}
                onToggle={() => toggle(step.id)}
              />
            );
          })}
        </div>
      </div>
      <OverallProgressBar overall={overall} paused={isPaused && isRunning} />
    </div>
  );
}
