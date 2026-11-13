import { describe, expect, test } from "bun:test";
import { getDefaultAppSettings } from "../config/user-config";
import { clipThresholds } from "./clip-settings";

describe("clipThresholds", () => {
  test("defaults follow RFD-002's bands", () => {
    expect(clipThresholds(getDefaultAppSettings())).toEqual({ strong: 0.02, review: 0.06, store: 0.12 });
  });

  test("similar shots extend review to the storage cutoff", () => {
    expect(clipThresholds({ ...getDefaultAppSettings(), clipSimilarShotsEnabled: true }).review).toBe(0.12);
  });

  test("values are clamped into order", () => {
    const t = clipThresholds({
      clipStrongMaxDistance: 0.3,
      clipReviewMaxDistance: 0.2,
      clipSimilarShotsEnabled: false,
      clipStoreMaxDistance: 0.1,
    });
    expect(t).toEqual({ strong: 0.1, review: 0.1, store: 0.1 });
  });
});
