import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { FileDecisionAction } from "../../services/processing";
import { initResultsService } from "../../services/review-service";
import { saveSettings } from "../../services/settings-service";
import { formatGpsCoords, formatTimeDiff, imageUrl } from "./lib";
import { prefsStore, resetReviewPrefs } from "./prefs";
import { ThumbnailGrid, VIRTUALIZE_AFTER } from "./ThumbnailGrid";
import { fakeRpc, file, twoGroups } from "./test-fixtures";

afterEach(() => {
  cleanup();
  resetReviewPrefs();
});

describe("ThumbnailGrid", () => {
  test("small groups render every card, suggested keep first", () => {
    const files = [file(3), file(1), file(2)];
    render(
      <ThumbnailGrid
        files={files}
        decisions={new Map<number, FileDecisionAction>([[2, "keep"]])}
        suggestedKeepId={2}
        compareThisId={2}
        keepCount={1}
        gridSize="md"
      />,
    );
    const names = screen.getAllByTestId("image-card").map((c) => c.querySelector("p")?.textContent);
    expect(names).toEqual(["img2.jpg", "img1.jpg", "img3.jpg"]);
  });

  test("large groups are virtualised (not every card is in the DOM)", () => {
    const files = Array.from({ length: VIRTUALIZE_AFTER * 10 }, (_, i) => file(i + 1));
    render(
      <ThumbnailGrid
        files={files}
        decisions={new Map()}
        suggestedKeepId={1}
        compareThisId={null}
        keepCount={0}
        gridSize="sm"
      />,
    );
    expect(screen.queryAllByTestId("image-card").length).toBeLessThan(files.length);
  });
});

describe("review preferences and helpers", () => {
  test("initResultsService loads grid size, compare mode and allowDeleteAll from settings", async () => {
    await saveSettings({ reviewGridSize: "xl", compareViewMode: "compact", allowDeleteAll: true });
    initResultsService(fakeRpc(twoGroups()));
    await waitFor(() =>
      expect(prefsStore.get()).toEqual({ gridSize: "xl", compareViewMode: "compact", allowDeleteAll: true }),
    );
    await saveSettings({ reviewGridSize: "md", compareViewMode: "balanced", allowDeleteAll: false });
  });

  test("formatting helpers", () => {
    expect(formatGpsCoords(51.5, -0.12, 35)).toBe("51.50° N 0.12° W +35m");
    expect(formatGpsCoords(null, 1, null)).toBeNull();
    expect(formatTimeDiff(-90_000)).toBe("-1m 30s");
    expect(imageUrl(0, "/a b.jpg")).toBe("file:///a b.jpg");
    expect(imageUrl(8080, "/a b.jpg")).toBe("http://127.0.0.1:8080/file?path=%2Fa%20b.jpg");
  });
});
