import { describe, expect, test } from "bun:test";
import { captureDatesReadiness } from "./readiness";

const done = { pendingSha256: 0, pendingContentHash: 0, pendingPhash: 0, decidedDelete: 0, conflictCount: 0 };

describe("captureDatesReadiness", () => {
  test("ready once duplicates are reviewed and deletions applied", () => {
    expect(captureDatesReadiness(done)).toEqual({ ready: true, blockers: [] });
  });

  test("pending groups, conflicts and unapplied deletions each block, with a reason", () => {
    const r = captureDatesReadiness({
      pendingSha256: 2,
      pendingContentHash: 1,
      pendingPhash: 1,
      conflictCount: 1,
      decidedDelete: 30,
    });
    expect(r.ready).toBe(false);
    expect(r.blockers).toEqual([
      "4 duplicate groups still to review",
      "1 conflict to resolve",
      "30 files marked for deletion; apply the deletions first",
    ]);
  });

  test("visually similar (CLIP) groups do not block: they are review-only", () => {
    expect(captureDatesReadiness({ ...done, pendingClip: 500 } as typeof done).ready).toBe(true);
  });
});
