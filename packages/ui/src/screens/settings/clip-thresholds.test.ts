import { describe, expect, test } from "bun:test";
import { getDefaultSettings } from "../../services/settings-service";
import { setClipDistance } from "./clip-thresholds";
import { clampInt } from "./NumberField";
import { toSavePayload } from "./settings-draft";

const base = { clipStrongMaxDistance: 0.02, clipReviewMaxDistance: 0.06, clipStoreMaxDistance: 0.12 };

describe("setClipDistance", () => {
  test("a value between its neighbours changes only that field", () => {
    expect(setClipDistance(base, "clipReviewMaxDistance", 0.08)).toEqual({ ...base, clipReviewMaxDistance: 0.08 });
  });

  test("review below strong pulls strong down", () => {
    expect(setClipDistance(base, "clipReviewMaxDistance", 0.01)).toEqual({
      clipStrongMaxDistance: 0.01,
      clipReviewMaxDistance: 0.01,
      clipStoreMaxDistance: 0.12,
    });
  });

  test("strong above review and store pushes both up", () => {
    expect(setClipDistance(base, "clipStrongMaxDistance", 0.2)).toEqual({
      clipStrongMaxDistance: 0.2,
      clipReviewMaxDistance: 0.2,
      clipStoreMaxDistance: 0.2,
    });
  });

  test("store below review pulls review and strong down", () => {
    expect(setClipDistance(base, "clipStoreMaxDistance", 0.015)).toEqual({
      clipStrongMaxDistance: 0.015,
      clipReviewMaxDistance: 0.015,
      clipStoreMaxDistance: 0.015,
    });
  });

  test("values snap to the 0.005 step and clamp to 0–0.3", () => {
    expect(setClipDistance(base, "clipReviewMaxDistance", 0.0612).clipReviewMaxDistance).toBe(0.06);
    expect(setClipDistance(base, "clipStoreMaxDistance", 0.9).clipStoreMaxDistance).toBe(0.3);
    expect(setClipDistance(base, "clipStrongMaxDistance", -1).clipStrongMaxDistance).toBe(0);
  });
});

describe("clampInt", () => {
  test("parses and clamps integers, rejects the rest", () => {
    expect(clampInt("12", 1, 64)).toBe(12);
    expect(clampInt("0", 1, 64)).toBe(1);
    expect(clampInt("900", 1, 64)).toBe(64);
    expect(clampInt("", 1, 64)).toBeNull();
    expect(clampInt("1.5", 1, 64)).toBeNull();
  });
});

describe("toSavePayload", () => {
  test("leaves out themeMode and logPath, keeps review preferences", () => {
    const payload = toSavePayload({
      ...getDefaultSettings(),
      logPath: "/x",
      reviewGridSize: "xl",
      allowDeleteAll: true,
    });
    expect("themeMode" in payload).toBe(false);
    expect("logPath" in payload).toBe(false);
    expect(payload.reviewGridSize).toBe("xl");
    expect(payload.allowDeleteAll).toBe(true);
    expect(payload.quarantineEnabled).toBe(true);
  });
});
