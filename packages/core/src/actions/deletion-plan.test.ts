import { describe, expect, test } from "bun:test";
import { type PlanDecision, type PlanInput, planDeletions } from "./deletion-plan";

/** Files 1..n exist at /p/<id>.jpg unless listed as missing. */
function input(over: Partial<PlanInput> & { n?: number; missing?: number[] } = {}): PlanInput {
  const n = over.n ?? 6;
  const files = new Map(
    Array.from({ length: n }, (_, i) => i + 1).map((id) => [
      id,
      { id, path: `/p/${id}.jpg`, existsOnDisk: !(over.missing ?? []).includes(id) },
    ]),
  );
  return { decisions: [], files, groups: new Map(), motionPairs: [], editedPairs: [], sidecars: [], ...over };
}
const d = (mediaFileId: number, action: "keep" | "delete", reviewGroupKey = "g"): PlanDecision => ({
  mediaFileId,
  action,
  reviewGroupKey,
});
const removed = (plan: ReturnType<typeof planDeletions>) => plan.remove.map((r) => r.fileId);

describe("planDeletions", () => {
  test("removes files marked delete when the group keeps another", () => {
    const plan = planDeletions(
      input({ decisions: [d(1, "keep"), d(2, "delete"), d(3, "delete")], groups: new Map([["g", [1, 2, 3]]]) }),
    );
    expect(removed(plan)).toEqual([2, 3]);
    expect(plan.skipped).toEqual([]);
  });

  test("rule 1: a file marked keep in another group is never removed", () => {
    const plan = planDeletions(
      input({
        decisions: [d(1, "keep", "a"), d(2, "delete", "a"), d(2, "keep", "b")],
        groups: new Map([
          ["a", [1, 2]],
          ["b", [2, 3]],
        ]),
      }),
    );
    expect(removed(plan)).toEqual([]);
    expect(plan.skipped[0]).toMatchObject({ fileId: 2, reason: "Also marked keep in another group" });
  });

  test("rule 2: a file missing on disk is skipped", () => {
    const plan = planDeletions(
      input({ missing: [2], decisions: [d(1, "keep"), d(2, "delete")], groups: new Map([["g", [1, 2]]]) }),
    );
    expect(removed(plan)).toEqual([]);
    expect(plan.skipped[0]?.reason).toBe("File does not exist on disk");
  });

  test("rule 3: removing a motion still also removes its video", () => {
    const plan = planDeletions(
      input({
        decisions: [d(1, "keep"), d(2, "delete")],
        groups: new Map([["g", [1, 2]]]),
        motionPairs: [{ primaryId: 2, secondaryId: 5 }],
      }),
    );
    expect(plan.remove.map((r) => [r.fileId, r.because])).toEqual([
      [2, "decision"],
      [5, "motion_partner"],
    ]);
  });

  test("rule 3: a pair is never split — if the partner is kept, neither is removed", () => {
    const plan = planDeletions(
      input({
        decisions: [d(1, "keep"), d(2, "delete"), d(5, "keep", "other")],
        groups: new Map([
          ["g", [1, 2]],
          ["other", [5, 6]],
        ]),
        motionPairs: [{ primaryId: 2, secondaryId: 5 }],
      }),
    );
    expect(removed(plan)).toEqual([]);
    expect(plan.skipped[0]).toMatchObject({
      fileId: 2,
      reason: "Would split a motion pair: its partner is marked keep",
    });
  });

  test("rule 4: never the last copy — an all-delete group keeps its lowest id", () => {
    const plan = planDeletions(
      input({ decisions: [d(3, "delete"), d(2, "delete"), d(4, "delete")], groups: new Map([["g", [2, 3, 4]]]) }),
    );
    expect(removed(plan)).toEqual([3, 4]);
    expect(plan.skipped).toEqual([{ fileId: 2, path: "/p/2.jpg", reason: "Last copy in group g: kept" }]);
  });

  test("rule 4: the spared last copy keeps its motion partner too", () => {
    const plan = planDeletions(
      input({
        decisions: [d(1, "delete"), d(2, "delete")],
        groups: new Map([["g", [1, 2]]]),
        motionPairs: [{ primaryId: 1, secondaryId: 6 }],
      }),
    );
    expect(removed(plan)).toEqual([2]);
    expect(plan.skipped.map((s) => s.fileId).sort()).toEqual([1, 6]);
  });

  test("rule 4: a group already emptied on disk does not block other removals", () => {
    const plan = planDeletions(
      input({
        missing: [1],
        decisions: [d(1, "delete"), d(2, "keep"), d(3, "delete")],
        groups: new Map([["g", [1, 2, 3]]]),
      }),
    );
    expect(removed(plan)).toEqual([3]);
  });

  test("rule 5: a removed file takes its own sidecar along", () => {
    const plan = planDeletions(
      input({
        decisions: [d(1, "keep"), d(2, "delete")],
        groups: new Map([["g", [1, 2]]]),
        sidecars: [{ id: 9, path: "/p/2.jpg.json", mediaFileId: 2 }],
      }),
    );
    expect(plan.remove[0]?.sidecars).toEqual([{ id: 9, path: "/p/2.jpg.json" }]);
  });

  test("rule 5: the sidecar stays when a remaining edited copy inherits it", () => {
    const plan = planDeletions(
      input({
        decisions: [d(1, "keep"), d(2, "delete")],
        groups: new Map([["g", [1, 2]]]),
        editedPairs: [{ primaryId: 2, secondaryId: 3 }],
        sidecars: [{ id: 9, path: "/p/2.jpg.json", mediaFileId: 2 }],
      }),
    );
    expect(plan.remove[0]?.sidecars).toEqual([]);
  });

  test("no decisions, no work", () => {
    expect(planDeletions(input())).toEqual({ remove: [], skipped: [] });
  });
});
