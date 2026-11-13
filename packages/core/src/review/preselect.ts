/**
 * Keep/delete preselection for a duplicate group (RFD-003 §E). Pure; the user can override
 * everything in review. ⚠️ FRAGILE: See _FRAGILE.md (it decides what is offered for deletion).
 *
 * Rules, in order:
 *   - clip groups: no preselection (review-only, RFD-002 §G).
 *   - Ordered narrowing rules (the user's order; default album, then owner device). Each narrows the
 *     candidates only when it splits them (some match, some don't):
 *       album (sha256 and phash): copies in an album. "In an album" = lives in an album folder, or an
 *         album-only sidecar points at it (deleting it would drop it from that album).
 *       owner_device (RFD-005): copies taken with a camera their own scan folder owns.
 *   - E.1 sha256 groups whose candidates are album copies: keep EVERY one of them.
 *   - otherwise keep ONE of the candidates, ranked:
 *       sha256 / content_hash (same bytes / pixels): Google copy over non-Google (E.3), not in a
 *         special folder (Trash/Archive), has a sidecar (E.2), folder priority, oldest, lowest id.
 *       phash (near-duplicates, E.4): in an album, has a sidecar, higher resolution, larger file,
 *         more EXIF fields, folder priority, oldest, lowest id.
 *   - never against each other: an original and its edited copy in the same group are both kept;
 *     a kept still keeps its motion video (and vice versa) — pairs are never split.
 *   - never the last copy: every non-clip preselection keeps at least one file.
 */

export type PreselectMethod = "sha256" | "content_hash" | "phash" | "clip";

/** Rules whose order the user sets (RFD-005); the first that splits a group wins. */
export type PreselectRule = "album" | "owner_device";
export const DEFAULT_RULE_ORDER: readonly PreselectRule[] = ["album", "owner_device"];

export interface PreselectFile {
  id: number;
  /** Scan folder priority (1 = highest). */
  folderPriority: number;
  dateTaken: Date | null;
  /** Takeout folder kind; null when the file is not inside a Google Takeout. */
  folderKind: "year" | "album" | "special" | null;
  /** An album-only sidecar points at this file (album membership by reference). */
  albumReferenced: boolean;
  /** Has a JSON sidecar of its own or inherited through a pair. */
  hasSidecar: boolean;
  /** width × height, 0 when unknown. */
  pixels: number;
  size: number;
  /** Number of EXIF-derived metadata fields present (camera, date, GPS…). */
  exifFields: number;
  motionPartnerId: number | null;
  editedPartnerId: number | null;
  /** Taken with a camera that this file's own scan folder owns (RFD-005). */
  ownedDevice?: boolean;
}

export interface Preselection {
  /** Files to preselect as keep; empty means "no preselection" (clip). */
  keepFileIds: number[];
  rule: "clip_review_only" | "album_copies" | "best_copy";
  reason: string;
}

const inAlbum = (f: PreselectFile) => f.folderKind === "album" || f.albumReferenced;

/** Comparators return <0 when `a` should be kept over `b`. */
type Compare = (a: PreselectFile, b: PreselectFile) => number;
const preferTrue =
  (pick: (f: PreselectFile) => boolean): Compare =>
  (a, b) =>
    Number(pick(b)) - Number(pick(a));
const preferHigher =
  (pick: (f: PreselectFile) => number): Compare =>
  (a, b) =>
    pick(b) - pick(a);
const oldest: Compare = (a, b) => {
  if (a.dateTaken && b.dateTaken) return a.dateTaken.getTime() - b.dateTaken.getTime();
  return a.dateTaken ? -1 : b.dateTaken ? 1 : 0;
};
const tail: Compare[] = [(a, b) => a.folderPriority - b.folderPriority, oldest, (a, b) => a.id - b.id];

const EXACT_RANKING: [string, Compare][] = [
  ["Google Takeout copy (has its JSON)", preferTrue((f) => f.folderKind !== null)],
  ["Not in Trash/Archive", preferTrue((f) => f.folderKind !== "special")],
  ["Has a JSON sidecar", preferTrue((f) => f.hasSidecar)],
];
const NEAR_RANKING: [string, Compare][] = [
  ["In an album", preferTrue(inAlbum)],
  ["Has a JSON sidecar", preferTrue((f) => f.hasSidecar)],
  ["Higher resolution", preferHigher((f) => f.pixels)],
  ["Larger file", preferHigher((f) => f.size)],
  ["More EXIF metadata", preferHigher((f) => f.exifFields)],
];

/** Rank files and explain which criterion separated the winner from the runner-up. */
function bestFile(files: PreselectFile[], ranking: [string, Compare][]): { file: PreselectFile; reason: string } {
  const criteria: [string, Compare][] = [
    ...ranking,
    ["Higher folder priority", tail[0] as Compare],
    ["Oldest date taken", tail[1] as Compare],
    ["Stable fallback (lowest file ID)", tail[2] as Compare],
  ];
  const sorted = [...files].sort((a, b) => {
    for (const [, compare] of criteria) {
      const c = compare(a, b);
      if (c !== 0) return c;
    }
    return 0;
  });
  const [winner, runnerUp] = sorted as [PreselectFile, PreselectFile | undefined];
  const decisive = runnerUp ? criteria.find(([, compare]) => compare(winner, runnerUp) < 0) : undefined;
  return { file: winner, reason: decisive?.[0] ?? "Only file" };
}

/** Add pair partners that are in the group, so a kept file never loses its partner. */
function withPartners(keep: Set<number>, files: PreselectFile[]): Set<number> {
  const inGroup = new Set(files.map((f) => f.id));
  for (const f of files) {
    if (!keep.has(f.id)) continue;
    for (const partner of [f.motionPartnerId, f.editedPartnerId]) {
      if (partner !== null && inGroup.has(partner)) keep.add(partner);
    }
  }
  // An original and its edited copy are never deleted against each other.
  for (const f of files) {
    if (f.editedPartnerId !== null && inGroup.has(f.editedPartnerId)) keep.add(f.id).add(f.editedPartnerId);
  }
  return keep;
}

const NARROWING: Record<PreselectRule, { label: string; match: (f: PreselectFile) => boolean }> = {
  album: { label: "In an album", match: inAlbum },
  owner_device: { label: "Taken with this folder owner's device", match: (f) => f.ownedDevice === true },
};

export function preselect(
  method: PreselectMethod,
  files: readonly PreselectFile[],
  ruleOrder: readonly PreselectRule[] = DEFAULT_RULE_ORDER,
): Preselection {
  if (method === "clip") {
    return { keepFileIds: [], rule: "clip_review_only", reason: "Visual matches are for review only" };
  }
  if (files.length === 0) return { keepFileIds: [], rule: "best_copy", reason: "No files" };
  const list = [...files];

  let candidates = list;
  let firstReason: string | null = null;
  let allAlbum = false;
  for (const rule of ruleOrder) {
    if (rule === "album" && method === "content_hash") continue; // same pixels, different bytes: E.3 ranking
    const matching = candidates.filter(NARROWING[rule].match);
    if (rule === "album") allAlbum = matching.length > 0;
    if (matching.length > 0 && matching.length < candidates.length) {
      candidates = matching;
      firstReason ??= NARROWING[rule].label;
    }
    // E.1: exact album copies are all kept (deleting one drops it from its album); later rules stop here.
    if (rule === "album" && method === "sha256" && allAlbum) break;
  }

  if (method === "sha256" && allAlbum && candidates.every(inAlbum)) {
    const keep = withPartners(new Set(candidates.map((f) => f.id)), list);
    const albumReason = candidates.length > 1 ? "Keep every album copy" : "Album copy beats year folder";
    const ownerFirst = firstReason === NARROWING.owner_device.label;
    return {
      keepFileIds: [...keep].sort((a, b) => a - b),
      rule: "album_copies",
      reason: ownerFirst ? `${firstReason}; ${albumReason.toLowerCase()}` : albumReason,
    };
  }

  const best = bestFile(candidates, method === "phash" ? NEAR_RANKING : EXACT_RANKING);
  const reason = candidates.length === 1 && firstReason ? firstReason : best.reason;
  const keep = withPartners(new Set([best.file.id]), list);
  const extra = keep.size > 1 ? " (with its edited/motion partner)" : "";
  return { keepFileIds: [...keep].sort((a, b) => a - b), rule: "best_copy", reason: `${reason}${extra}` };
}
