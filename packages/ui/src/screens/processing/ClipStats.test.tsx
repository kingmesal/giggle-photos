import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import type { ClipStageStats } from "../../services/clip-service";
import { ClipStatsLine } from "./ClipStats";

afterEach(cleanup);

const base: ClipStageStats = {
  skipped: null,
  embedded: 0,
  embedErrors: 0,
  pairsStored: 10,
  pairsInReview: 4,
  pairsStrong: 1,
  thresholds: { strong: 0.02, review: 0.06, store: 0.12 },
};

describe("ClipStatsLine — videos", () => {
  test("shows video pairs and what was embedded", () => {
    render(
      <ClipStatsLine clip={{ ...base, videoSkipped: null, videosEmbedded: 12, videoEmbedErrors: 1, videoPairs: 3 }} />,
    );
    expect(screen.getByText("Videos: 3 pairs, 12 newly embedded, 1 failed")).toBeTruthy();
  });

  test("asks for ffmpeg when it is missing", () => {
    render(<ClipStatsLine clip={{ ...base, videoSkipped: "no_ffmpeg", videoPairs: 0 }} />);
    expect(screen.getByText(/install ffmpeg/)).toBeTruthy();
  });

  test("stats from older runs (no video fields) show no video line", () => {
    render(<ClipStatsLine clip={base} />);
    expect(screen.queryByText(/Videos/)).toBeNull();
  });
});
