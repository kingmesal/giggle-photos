// ⚠️ FRAGILE: See _FRAGILE.md — this decides which files are removed.
/**
 * Pure deletion planning (RFD-003 §E.5, §F). Given decisions, group membership, pairs and
 * sidecars, decide exactly what to remove and what to refuse, with a reason for every refusal.
 *
 * Safety rules:
 *   1. A file is removed only with a "delete" decision and no "keep" decision in any group.
 *   2. A file missing on disk is skipped (nothing to remove; its record stays for a re-scan).
 *   3. Motion pairs move together: removing one member removes its partner, and if the partner is
 *      kept the pair is left alone (never split a pair).
 *   4. Never the last copy: every group keeps at least one surviving member.
 *   5. A file's own sidecars go with it, unless a remaining file still relies on them (an edited
 *      copy or motion video that inherits the JSON).
 */

export interface PlanDecision {
  mediaFileId: number;
  action: "keep" | "delete";
  reviewGroupKey: string;
}

export interface PlanFile {
  id: number;
  path: string;
  existsOnDisk: boolean;
}

export interface PlanSidecar {
  id: number;
  path: string;
  /** The file this JSON is the own sidecar of. */
  mediaFileId: number;
}

export interface PlanInput {
  decisions: PlanDecision[];
  /** Every file referenced by the decisions, groups or pairs. */
  files: Map<number, PlanFile>;
  /** reviewGroupKey → current member file ids. */
  groups: Map<string, number[]>;
  motionPairs: { primaryId: number; secondaryId: number }[];
  /** Edited pairs (secondary inherits the primary's JSON). */
  editedPairs: { primaryId: number; secondaryId: number }[];
  sidecars: PlanSidecar[];
}

export interface PlannedRemoval {
  fileId: number;
  path: string;
  because: "decision" | "motion_partner";
  sidecars: { id: number; path: string }[];
}

export interface DeletionPlan {
  remove: PlannedRemoval[];
  skipped: { fileId: number; path: string; reason: string }[];
}

export function planDeletions(input: PlanInput): DeletionPlan {
  const kept = new Set(input.decisions.filter((d) => d.action === "keep").map((d) => d.mediaFileId));
  const skipped: DeletionPlan["skipped"] = [];
  const pathOf = (id: number) => input.files.get(id)?.path ?? `#${id}`;
  const skip = (id: number, reason: string) => {
    if (!skipped.some((s) => s.fileId === id)) skipped.push({ fileId: id, path: pathOf(id), reason });
  };

  // Rule 1 + 2: candidates from decisions.
  const remove = new Map<number, PlannedRemoval["because"]>();
  for (const d of input.decisions) {
    if (d.action !== "delete" || remove.has(d.mediaFileId)) continue;
    const file = input.files.get(d.mediaFileId);
    if (kept.has(d.mediaFileId)) skip(d.mediaFileId, "Also marked keep in another group");
    else if (!file) skip(d.mediaFileId, "File record not found");
    else if (!file.existsOnDisk) skip(d.mediaFileId, "File does not exist on disk");
    else remove.set(d.mediaFileId, "decision");
  }

  // Rule 3: motion pairs together.
  const partners = new Map<number, number>();
  for (const p of input.motionPairs) {
    partners.set(p.primaryId, p.secondaryId);
    partners.set(p.secondaryId, p.primaryId);
  }
  for (const [id] of [...remove]) {
    const partner = partners.get(id);
    if (partner === undefined || remove.has(partner)) continue;
    if (kept.has(partner)) {
      remove.delete(id);
      skip(id, "Would split a motion pair: its partner is marked keep");
    } else if (input.files.get(partner)?.existsOnDisk) {
      remove.set(partner, "motion_partner");
    }
  }

  // Rule 4: never the last copy. Spare the lowest id of a group that would be emptied (with its
  // motion partner), and repeat until every group has a survivor.
  for (let changed = true; changed; ) {
    changed = false;
    for (const [key, members] of input.groups) {
      const present = members.filter((id) => input.files.get(id)?.existsOnDisk !== false);
      if (present.length === 0 || present.some((id) => !remove.has(id))) continue;
      const spare = Math.min(...present);
      for (const id of [spare, partners.get(spare)]) {
        if (id === undefined || !remove.has(id)) continue;
        remove.delete(id);
        skip(id, `Last copy in group ${key}: kept`);
      }
      changed = true;
    }
  }

  // Rule 5: sidecars follow their file unless a remaining edited copy / motion video inherits them.
  const inheritors = new Map<number, number[]>();
  for (const p of [...input.motionPairs, ...input.editedPairs]) {
    inheritors.set(p.primaryId, [...(inheritors.get(p.primaryId) ?? []), p.secondaryId]);
  }
  const removals: PlannedRemoval[] = [...remove].map(([fileId, because]) => {
    const stillNeeded = (inheritors.get(fileId) ?? []).some((s) => !remove.has(s));
    const sidecars = stillNeeded
      ? []
      : input.sidecars.filter((s) => s.mediaFileId === fileId).map((s) => ({ id: s.id, path: s.path }));
    return { fileId, path: pathOf(fileId), because, sidecars };
  });
  removals.sort((a, b) => a.fileId - b.fileId);
  return { remove: removals, skipped };
}
