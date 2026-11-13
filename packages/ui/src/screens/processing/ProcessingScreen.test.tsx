import { afterEach, describe, expect, test } from "bun:test";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { initProcessingService, resetProcessingViewForTests } from "../../services/processing-view-service";
import { initSystemHealthService, type SystemHealthRPC } from "../../services/system-health-service";
import { currentView, navigateTo } from "../../state/navigation";
import { getReviewDataVersion } from "../../state/review-events";
import { ProcessingScreen } from "./ProcessingScreen";
import { fakeRPC, IDLE, pipelineState } from "./test-fixtures";

afterEach(() => {
  cleanup();
  resetProcessingViewForTests();
  initSystemHealthService(null as unknown as SystemHealthRPC);
});

const button = (name: string | RegExp) => screen.queryByRole("button", { name });

describe("ProcessingScreen without RPC (dev preview / E2E)", () => {
  test("shows the header and the no-folders empty state, without a start button", () => {
    render(<ProcessingScreen />);
    expect(screen.getByRole("heading", { name: "Processing Pipeline" })).toBeTruthy();
    expect(screen.getByText("Step-by-step progress through deduplication stages")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "No Folders Configured" })).toBeTruthy();
    expect(screen.getByText(/Add folders to scan for images/)).toBeTruthy();
    expect(button(/Start Processing/)).toBeNull();
    expect(screen.queryByText("Pause after each step")).toBeNull();
  });

  test("Add Folders navigates to the Folders view", () => {
    navigateTo("processing");
    render(<ProcessingScreen />);
    fireEvent.click(button(/Add Folders/) as HTMLElement);
    expect(currentView()).toBe("folders");
  });
});

describe("ProcessingScreen idle with folders", () => {
  test("offers Start Processing with the pause-after-step option and a ready first step", async () => {
    const rpc = fakeRPC();
    initProcessingService(rpc);
    render(<ProcessingScreen />);
    await screen.findByRole("button", { name: /Start Processing/ });
    expect(screen.getByText("Pause after each step")).toBeTruthy();
    expect(screen.getByText("Ready to process", { selector: "div" })).toBeTruthy();
    expect(document.querySelector('[data-step="scanning"]')?.getAttribute("data-status")).toBe("ready");
    expect(document.querySelector('[data-step="metadata"]')?.getAttribute("data-status")).toBe("pending");

    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(button(/Start Processing/) as HTMLElement);
    await waitFor(() => expect(rpc.startProcessing).toHaveBeenCalledWith({ pauseAfterSegment: false }));
  });

  test("says Continue Processing when scanning is done, with counts from the persisted state", async () => {
    const state = pipelineState({
      hasUnscannedFolders: false,
      hasUnhashedFiles: true,
      totalFiles: 30,
      statusCounts: { pending: 0, metadata: 12, hashed: 0, processed: 18, error: 2 },
    });
    initProcessingService(fakeRPC({ state }));
    render(<ProcessingScreen />);
    await screen.findByRole("button", { name: /Continue Processing/ });
    expect(screen.getByText("Ready — 12 files to process")).toBeTruthy();
    expect(screen.getByText("2 of 4 complete")).toBeTruthy();
    fireEvent.click(screen.getByText("Metadata Extraction"));
    expect(screen.getByText("Files:").nextSibling?.textContent).toBe("30");
  });

  test("hides the pipeline and shows the FFmpeg banner when ffprobe is missing", async () => {
    initSystemHealthService({
      getSystemHealth: async () => ({ ffprobe: { available: false, path: null }, platform: "darwin" }),
    });
    initProcessingService(fakeRPC());
    render(<ProcessingScreen />);
    await screen.findByRole("heading", { name: "FFmpeg Not Installed" });
    expect(screen.getByText("brew install ffmpeg")).toBeTruthy();
    expect(screen.queryByText("File Discovery")).toBeNull();
    expect(button(/Start Processing/)).toBeNull();
  });

  test("shows a load failure", async () => {
    const rpc = fakeRPC();
    rpc.getProcessingState.mockImplementation(async () => {
      throw new Error("db locked");
    });
    initProcessingService(rpc);
    render(<ProcessingScreen />);
    await screen.findByText("db locked");
  });
});

describe("ProcessingScreen running", () => {
  const running = {
    isRunning: true,
    isPaused: false,
    progress: {
      stage: "hashing" as const,
      stageProgress: 42,
      currentOperation: "/photos/a.jpg",
      filesProcessed: 10,
      totalFiles: 20,
      duplicatesFound: 0,
      errors: 0,
      liveImages: 8,
      liveVideos: 2,
      liveTimingMs: { sha256: 12.4, perceptualHash: 0 },
      etaMs: 65000,
    },
  };

  test("shows live progress and pauses", async () => {
    const rpc = fakeRPC({
      status: running,
      state: pipelineState({ hasUnscannedFolders: false, hasUnhashedFiles: true }),
    });
    initProcessingService(rpc);
    render(<ProcessingScreen />);
    await screen.findByText("Processing files...");
    expect(screen.getByText("42%")).toBeTruthy();
    expect(screen.getByText("10 / 20 files")).toBeTruthy();
    expect(screen.getByText("8 images")).toBeTruthy();
    expect(screen.getByText("SHA-256: 12ms avg")).toBeTruthy();
    expect(screen.getByText("Estimated time remaining: 1m 5s")).toBeTruthy();
    expect(screen.getByText("/photos/a.jpg")).toBeTruthy();
    expect(screen.getByText("2 of 4 complete: Evaluate and Analyze Media — 42%")).toBeTruthy();
    expect((screen.getByRole("progressbar") as HTMLElement).style.width).toBe("42%");
    expect(screen.getByRole("checkbox")).toHaveProperty("disabled", true);

    fireEvent.click(button(/Pause/) as HTMLElement);
    await screen.findByRole("button", { name: /Resume/ });
    expect(rpc.pauseProcessing).toHaveBeenCalled();
    expect(screen.getByText("— Click Resume to continue")).toBeTruthy();
  });

  test("when polling sees the run finish, it reloads and tells review screens", async () => {
    let current: typeof running | typeof IDLE = running;
    const rpc = fakeRPC({
      status: () => current,
      state: pipelineState({ hasUnscannedFolders: false, hasUnhashedFiles: true }),
    });
    initProcessingService(rpc);
    render(<ProcessingScreen />);
    await screen.findByText("Processing files...");
    const before = getReviewDataVersion();
    await act(async () => {
      current = IDLE;
      rpc.getProcessingState.mockImplementation(async () => pipelineState({ hasUnscannedFolders: false }));
    });
    await waitFor(() => expect(getReviewDataVersion()).toBe(before + 1), { timeout: 2000 });
    await screen.findByText("No duplicate files were found in your folders.");
  });
});
