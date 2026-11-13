import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { type ClipModelStatus, initClipService, resetClipServiceForTests } from "../../services/clip-service";
import {
  initProcessingService,
  type ProcessingStatus,
  resetProcessingViewForTests,
} from "../../services/processing-view-service";
import { initTakeoutService, type TakeoutReport, type TakeoutRPC } from "../../services/takeout-service";
import { ClipModelBanner } from "./ClipModelBanner";
import { ProcessingScreen } from "./ProcessingScreen";
import { fakeRPC, pipelineState } from "./test-fixtures";

afterEach(() => {
  cleanup();
  resetProcessingViewForTests();
  resetClipServiceForTests();
  initTakeoutService(null as unknown as TakeoutRPC);
});

const SUMMARY = {
  folders: { year: 3, album: 2, special: 1 },
  sidecars: { media: 10, album_metadata: 2, other: 0, unparseable: 0 },
  mediaSidecarsMatched: 8,
  mediaSidecarsUnmatched: 2,
  byMethod: { name_exact: 7, title: 1 },
  mediaWithoutSidecar: 1,
  pairs: { motion: 4, edited: 1 },
};

const completed: ProcessingStatus = {
  isRunning: false,
  isPaused: false,
  progress: {
    stage: "complete",
    stageProgress: 100,
    currentOperation: "",
    filesProcessed: 120,
    totalFiles: 120,
    duplicatesFound: 6,
    errors: 3,
    stageStats: {
      scanning: {
        processed: 120,
        errors: 0,
        skipped: 0,
        images: 100,
        videos: 20,
        takeout: { roots: 1, warnings: ["Takeout part 2 missing"], summary: SUMMARY },
      },
      metadata: {
        processed: 120,
        errors: 3,
        skipped: 1,
        images: 100,
        videos: 20,
        errorBreakdown: { "unsupported_format:heic": 3 },
        timingMs: { imageMetadata: 4.2, videoMetadata: 30 },
      },
      detecting: {
        processed: 120,
        errors: 0,
        skipped: 0,
        clip: {
          skipped: null,
          embedded: 5,
          embedErrors: 1,
          pairsStored: 9,
          pairsInReview: 4,
          pairsStrong: 2,
          provider: "cpu",
          thresholds: { strong: 0.1, review: 0.2, store: 0.3 },
        },
      },
    },
  },
};

describe("ProcessingScreen after a completed run", () => {
  test("marks the processing steps completed, summarises review work, and expands stage cards on click", async () => {
    const report: TakeoutReport = {
      summary: SUMMARY,
      unmatchedSidecars: [{ id: 1, path: "/t/a.json", title: null }],
      mediaWithoutSidecar: [{ id: 2, path: "/t/b.jpg" }],
      listLimit: 500,
    };
    const getTakeoutReport = mock(async () => report);
    initTakeoutService({ getTakeoutReport, compareImmichGoReport: mock(async () => ({ rows: [], events: {} })) });
    const summary = { pendingSha256: 2, pendingContentHash: 0, pendingPhash: 1, decidedKeep: 1, decidedDelete: 0 };
    initProcessingService(
      fakeRPC({ status: completed, state: pipelineState({ hasUnscannedFolders: false }), summary }),
    );
    render(<ProcessingScreen />);

    await screen.findByText("3 pending groups to review");
    expect(screen.getByText("1 decision made")).toBeTruthy();
    expect(screen.getByText("4 of 4 complete")).toBeTruthy();
    expect(screen.getByText("100%")).toBeTruthy();
    for (const stage of ["scanning", "metadata", "hashing", "detecting"]) {
      expect(document.querySelector(`[data-step="${stage}"]`)?.getAttribute("data-status")).toBe("completed");
    }
    // As in the Sigment view, live "complete" progress leaves the review step "Ready"
    expect(document.querySelector('[data-step="complete"]')?.getAttribute("data-status")).toBe("ready");
    expect(screen.queryByRole("button", { name: /Start Processing|Continue Processing/ })).toBeNull();

    // File Discovery: totals and the Takeout report with its drill-down lists
    fireEvent.click(screen.getByText("File Discovery"));
    expect(screen.getByText("Total files found").nextSibling?.textContent).toBe("120");
    expect(screen.getByText("Takeout part 2 missing")).toBeTruthy();
    expect(screen.getByText("Google Takeout: 3 year folders, 2 albums, 1 special")).toBeTruthy();
    expect(screen.getByText("Sidecars linked: 8 of 10 (by name: 7 · by title: 1)")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show unmatched files" }));
    await screen.findByText("/t/a.json");
    expect(screen.getByText("Media without a sidecar (1)")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Hide lists" }));
    expect(screen.queryByText("/t/a.json")).toBeNull();

    // Metadata: counts, timings, errors and the labelled breakdown
    fireEvent.click(screen.getByText("Metadata Extraction"));
    expect(screen.getByText(/^Image: 4ms avg/)).toBeTruthy();
    expect(screen.getByText("Unsupported format (HEIC): 3")).toBeTruthy();
    expect(screen.getByText("Skipped:").nextSibling?.textContent).toBe("1");

    // Similarity: CLIP stats line
    fireEvent.click(screen.getByText("Similarity Analysis"));
    expect(screen.getByText(/Visual similarity \(CLIP\): 4 pairs to review \(≤ 0.2\), 2 strong/)).toBeTruthy();
    expect(screen.getByText("Embedded later: 5, failed: 1 (cpu)")).toBeTruthy();

    // Collapsing again hides the card content
    fireEvent.click(screen.getByText("Similarity Analysis"));
    expect(screen.queryByText("Embedded later: 5, failed: 1 (cpu)")).toBeNull();
  });
});

describe("ClipModelBanner", () => {
  test("renders nothing without RPC", () => {
    const { container } = render(<ClipModelBanner />);
    expect(container.textContent).toBe("");
  });

  test("shows download progress", async () => {
    initClipService({
      getClipModelStatus: async () => ({
        state: "downloading",
        file: "m",
        receivedBytes: 52428800,
        totalBytes: 104857600,
      }),
      retryClipModelSetup: async () => ({ state: "missing" }),
      importClipModelFile: async () => ({ status: { state: "missing" }, error: null }),
    });
    render(<ClipModelBanner />);
    await screen.findByText("Downloading the visual similarity model: 50 MB of 100 MB (50%)");
  });

  test("on error offers retry and import, showing the import error", async () => {
    const error: ClipModelStatus = { state: "error", message: "ECONNRESET" };
    const retryClipModelSetup = mock(async (): Promise<ClipModelStatus> => ({ state: "verifying", file: "m" }));
    initClipService({
      getClipModelStatus: async () => error,
      retryClipModelSetup,
      importClipModelFile: async () => ({ status: error, error: "Not a model file" }),
    });
    render(<ClipModelBanner />);
    await screen.findByText("ECONNRESET");
    fireEvent.click(screen.getByRole("button", { name: "Import model file…" }));
    await screen.findByText("Not a model file");
    fireEvent.click(screen.getByRole("button", { name: "Retry download" }));
    await waitFor(() => expect(retryClipModelSetup).toHaveBeenCalled());
  });
});
