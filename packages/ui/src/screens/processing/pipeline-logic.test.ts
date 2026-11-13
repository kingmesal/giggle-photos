import { describe, expect, test } from "bun:test";
import {
  autoExpandTarget,
  currentStepIndex,
  formatDuration,
  isPausedBetweenStages,
  overallProgress,
} from "./pipeline-logic";
import { pipelineState } from "./test-fixtures";

const progress = (stage: "scanning" | "metadata" | "complete", stageProgress: number) => ({
  stage,
  stageProgress,
  currentOperation: "",
  filesProcessed: 0,
  totalFiles: 0,
  duplicatesFound: 0,
  errors: 0,
});

describe("pipeline-logic", () => {
  test("current step from persisted state after a restart", () => {
    expect(currentStepIndex(null, false, pipelineState())).toBe(0);
    expect(
      currentStepIndex(null, false, pipelineState({ hasUnscannedFolders: false, hasUndetectedDuplicates: true })),
    ).toBe(3);
    expect(currentStepIndex(null, false, pipelineState({ hasUnscannedFolders: false }))).toBe(5);
    expect(currentStepIndex(null, true, pipelineState())).toBe(-1);
    expect(currentStepIndex(progress("metadata", 3), true, pipelineState())).toBe(1);
  });

  test("paused at the end of a stage counts that stage as done", () => {
    const p = progress("scanning", 100);
    expect(isPausedBetweenStages(p, true, true)).toBe(true);
    expect(overallProgress(p, true, true, 1, pipelineState())).toEqual({
      statusText: "1 of 4 complete",
      percent: 25,
      showPercent: true,
    });
    expect(overallProgress(null, false, false, 0, pipelineState()).statusText).toBe("Ready to process");
    expect(overallProgress(null, false, false, 5, pipelineState({ hasUnscannedFolders: false })).statusText).toBe(
      "No pending work",
    );
  });

  test("auto-expand target and durations", () => {
    expect(autoExpandTarget(-1, false)).toBe(0);
    expect(autoExpandTarget(2, true)).toBe(3);
    expect(autoExpandTarget(5, false)).toBe(5);
    expect(formatDuration(500)).toBe("< 1s");
    expect(formatDuration(12_300)).toBe("12.3s");
    expect(formatDuration(120_000)).toBe("2m");
  });
});
