/**
 * Link Takeout JSON sidecars to media files (RFD-003 §C). Pure: no I/O. ⚠️ FRAGILE: See _FRAGILE.md
 *
 * Order (first rule wins; the rule is recorded as `method`):
 *   1. name_exact      sidecar name → media name in the same folder (counter in its usual place)
 *   2. name_truncated  sidecar name hit the 51-char cap; its base is a prefix of the media name
 *   3. title           the JSON `title` (original upload name) + duplicate counter, same folder
 *   4. edited_name     the original is missing but its edited copy is here: link the copy
 *   5. album_reference album-folder sidecar whose photo lives only in a year folder: the same
 *                      file name in the root's year folders, disambiguated by photoTakenTime's year
 * A title alone is ambiguous: both IMG.jpg and IMG(1).jpg have title "IMG.jpg", so the counter
 * from the sidecar name always has to agree.
 * Media without a sidecar of their own inherit one through a pair (edited copy, motion video).
 */
import type { TakeoutFolderKind } from "./folder-classify";
import { detectMediaPairs, type MediaPair } from "./media-pairs";
import {
  type MediaName,
  parseMediaName,
  parseSidecarName,
  type SidecarName,
  sidecarNameRefersTo,
} from "./sidecar-names";

export type MatchMethod = "name_exact" | "name_truncated" | "title" | "edited_name" | "album_reference";
export type InheritMethod = "edited_copy" | "motion_video";

export interface MatchFolder {
  id: number;
  /** Google Photos directory this folder belongs to (one per merged Takeout tree). */
  rootId: number;
  kind: TakeoutFolderKind;
  year: number | null;
}
export interface MatchMedia {
  id: number;
  folderId: number;
  name: string;
}
export interface MatchSidecar {
  id: number;
  folderId: number;
  name: string;
  title: string | null;
  photoTakenTime: Date | null;
}

export interface SidecarMatchResult {
  links: { sidecarId: number; mediaFileId: number; method: MatchMethod }[];
  inherited: { mediaFileId: number; sidecarId: number; method: InheritMethod }[];
  pairs: MediaPair[];
  unmatchedSidecarIds: number[];
  mediaWithoutSidecarIds: number[];
}

type ParsedMedia = MatchMedia & { parsed: MediaName };
type ParsedSidecar = MatchSidecar & { parsed: SidecarName };

const nfc = (s: string | null) => (s === null ? null : s.normalize("NFC"));

/** In-folder candidates for one sidecar, by rule. */
function inFolderMatch(sidecar: ParsedSidecar, media: ParsedMedia[], claimed: Set<number>) {
  const free = media.filter((m) => !claimed.has(m.id));
  const title = nfc(sidecar.title);
  const pick = (cands: ParsedMedia[]) => {
    if (cands.length <= 1) return cands[0];
    const byTitle = title ? cands.filter((m) => m.parsed.counterless === title) : [];
    return byTitle.length === 1 ? byTitle[0] : undefined; // still ambiguous → leave unmatched
  };
  const exact = pick(free.filter((m) => sidecarNameRefersTo(sidecar.parsed, m.parsed) === "exact"));
  if (exact) return { media: exact, method: "name_exact" as const };
  const truncated = pick(free.filter((m) => sidecarNameRefersTo(sidecar.parsed, m.parsed) === "truncated"));
  if (truncated) return { media: truncated, method: "name_truncated" as const };
  if (title) {
    const byTitle = free.filter((m) => m.parsed.counterless === title && m.parsed.counter === sidecar.parsed.counter);
    if (byTitle.length === 1) return { media: byTitle[0] as ParsedMedia, method: "title" as const };
  }
  const original = sidecar.parsed.truncated ? title : (title ?? sidecar.parsed.base);
  const edited = free.filter(
    (m) =>
      m.parsed.editedOf !== null &&
      (m.parsed.editedOf === original || m.parsed.editedOf === sidecar.parsed.base) &&
      m.parsed.counter === sidecar.parsed.counter,
  );
  if (edited.length === 1) return { media: edited[0] as ParsedMedia, method: "edited_name" as const };
  return null;
}

export function matchSidecars(
  folders: readonly MatchFolder[],
  media: readonly MatchMedia[],
  sidecars: readonly MatchSidecar[],
): SidecarMatchResult {
  const folderById = new Map(folders.map((f) => [f.id, f]));
  const mediaByFolder = new Map<number, ParsedMedia[]>();
  for (const m of media) {
    const list = mediaByFolder.get(m.folderId) ?? [];
    list.push({ ...m, parsed: parseMediaName(m.name) });
    mediaByFolder.set(m.folderId, list);
  }

  const result: SidecarMatchResult = {
    links: [],
    inherited: [],
    pairs: [],
    unmatchedSidecarIds: [],
    mediaWithoutSidecarIds: [],
  };
  const claimed = new Set<number>(); // media with their own sidecar
  const pending: ParsedSidecar[] = [];

  for (const s of sidecars) {
    const parsed = parseSidecarName(s.name);
    if (!parsed) {
      result.unmatchedSidecarIds.push(s.id);
      continue;
    }
    const sidecar = { ...s, parsed };
    const found = inFolderMatch(sidecar, mediaByFolder.get(s.folderId) ?? [], claimed);
    if (found) {
      claimed.add(found.media.id);
      result.links.push({ sidecarId: s.id, mediaFileId: found.media.id, method: found.method });
    } else {
      pending.push(sidecar);
    }
  }

  // Album sidecars whose photo exists only in a year folder: album membership by reference.
  for (const sidecar of pending) {
    const folder = folderById.get(sidecar.folderId);
    const title = nfc(sidecar.title);
    let target: ParsedMedia | undefined;
    if (folder?.kind === "album" && title) {
      const year = sidecar.photoTakenTime?.getUTCFullYear() ?? null;
      const candidates = folders
        .filter((f) => f.rootId === folder.rootId && f.kind === "year")
        .flatMap((f) => (mediaByFolder.get(f.id) ?? []).map((m) => ({ m, year: f.year })))
        .filter(({ m }) => m.parsed.counterless === title && m.parsed.counter === sidecar.parsed.counter);
      const narrowed = candidates.length > 1 && year !== null ? candidates.filter((c) => c.year === year) : candidates;
      if (narrowed.length === 1) target = narrowed[0]?.m;
    }
    if (target) result.links.push({ sidecarId: sidecar.id, mediaFileId: target.id, method: "album_reference" });
    else result.unmatchedSidecarIds.push(sidecar.id);
  }

  // Pairs per folder; the secondary inherits the primary's own sidecar when it has none.
  const ownSidecar = new Map<number, number>();
  for (const link of result.links)
    if (link.method !== "album_reference") ownSidecar.set(link.mediaFileId, link.sidecarId);
  for (const [folderId, list] of mediaByFolder) {
    if (folderById.get(folderId)?.kind === "non_takeout") continue;
    for (const pair of detectMediaPairs(list)) {
      result.pairs.push(pair);
      const sidecarId = ownSidecar.get(pair.primaryId);
      if (sidecarId !== undefined && !ownSidecar.has(pair.secondaryId)) {
        const method: InheritMethod = pair.kind === "edited" ? "edited_copy" : "motion_video";
        result.inherited.push({ mediaFileId: pair.secondaryId, sidecarId, method });
      }
    }
  }

  const covered = new Set([...result.links.map((l) => l.mediaFileId), ...result.inherited.map((i) => i.mediaFileId)]);
  for (const m of media) {
    const kind = folderById.get(m.folderId)?.kind;
    if (kind && kind !== "non_takeout" && !covered.has(m.id)) result.mediaWithoutSidecarIds.push(m.id);
  }
  return result;
}
