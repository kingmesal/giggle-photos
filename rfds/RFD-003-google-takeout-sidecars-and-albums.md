# RFD-003: Google Takeout Awareness — JSON Sidecars, Albums, Motion Photos

## Status
Draft — 2026-11-12. Steps 1–4 implemented 2026-11-12 (see "Findings"); immich-go validation (step 5)
pending.

## Problem

The library being deduplicated is a **Google Photos Takeout**, destined for Immich via
`immich-go`. The app currently treats it as a plain folder of media files, which loses
information in three ways:

1. **JSON sidecars are ignored.** Takeout stores capture time (`photoTakenTime`), GPS
   (`geoData`), descriptions and people tags in per-file `.json` sidecars, often more
   reliably than EXIF (Google strips or rewrites EXIF on some exports). The scanner only
   looks at media files, so nothing ties a photo to its sidecar, and deleting a duplicate
   can delete the copy whose sidecar we needed.
2. **Album membership looks like duplication.** A photo in an album appears **twice,
   byte-identical**: once in `Photos from YYYY/` and once in the album folder (each with its
   own sidecar). The SHA-256 method groups them as exact duplicates. Deleting the album
   copy **removes the photo from that album** on import, because `immich-go` rebuilds albums
   from album folders.
3. **Motion photos can be pairs.** The library is Android-only (no iPhones). Pixel/Samsung
   motion photos usually embed the video inside the JPEG (`*.MP.jpg`, one file). But Takeout
   exports can also emit a separate companion video (`.MP`/`.mp4`) with the same base name.
   When a companion exists, dedup must keep or remove the pair together. Verify which form
   appears in the fresh Takeout before building section D.

## Decisions Already Made (by the maintainer)

- The production run starts from a **fresh, complete Google Takeout** and a fresh database.
- **Album rule:** if a file is in an album, the album is where it's meant to live; the
  non-album (`Photos from YYYY`) copy is the one to delete.
- The JSON sidecar must be kept with whichever **Google copy** is kept.

## Proposed Solution

### A. Pre-flight: one merged tree

Takeout ships as multiple zip parts, and **a sidecar can land in a different part than its
media file**. The app requires (and checks) a single extracted tree: all parts extracted into
one `Takeout/` root. The quick scan warns if it sees multiple `Takeout/` roots or zips.

### B. Folder classification

During scan, classify every directory under `Takeout/Google Photos/`:

| Kind | How detected |
|---|---|
| `year` | name matches `Photos from \d{4}` (localized variants configurable) |
| `album` | any other folder; album title from its `metadata.json` `title` if present, else the folder name |
| `special` | Trash / Archive / Locked folder names; excluded or flagged by setting |
| `non_takeout` | folders outside a Takeout root (other sources mixed into the scan) |

Store on `scanFolders`/a new `takeoutFolders` table; each `mediaFiles` row gets `folderKind`
and `albumName`.

### C. Sidecar linking

New `sidecars` table: `id`, `path`, `mediaFileId` (nullable FK), `kind`
(`media` | `album_metadata` | `other`), `title` (from JSON), `photoTakenTime`, `geoLat`,
`geoLon`, `matchMethod`, `createdAt`. Five Zod schemas as required.

Matching, in order (record which rule matched):

1. **By content:** parse the JSON and match its `title` (the original filename) against media
   files **in the same folder**. This is the most robust approach and survives every
   filename quirk below.
2. **Filename heuristics** as fallback, handling:
   - `IMG_1234.JPG.json`
   - newer exports: `IMG_1234.JPG.supplemental-metadata.json`, **including truncated
     forms** (`.supplemental-metad.json`, `.suppl.json`, …), because the whole name is capped
     at about 46–51 characters
   - long media names truncated before `.json`
   - duplicate-name counters: media `IMG_1234(1).JPG` ↔ sidecar `IMG_1234.JPG(1).json`
   - edited copies: `IMG_1234-edited.JPG` (localized suffix, e.g. `-bearbeitet`, `-modifié`)
     **share the original's sidecar**
3. Unmatched sidecars and media files without a sidecar are **reported in the UI** as a count
   with a drill-down list, never silently ignored.

Golden tests: a fixture tree covering every pattern above.

### D. Pairs that move together

`mediaPairs` table (or `pairId` on `mediaFiles`) for:

- Motion photos: still + companion `.MP`/`.mp4` with the same base name in the same folder (when Takeout emits one).
- Original + `-edited` copy: related, **never auto-deleted against each other** (both kept
  by default, since the edit is the user's work).

A decision on one member of a motion-photo pair applies to both.

### E. Keep / delete preselection rules

Applied when building review groups; the user can override anything in the UI.

1. **Album beats year folder.** For a SHA-256 group containing album copies, preselect *keep*
   for **every album copy** and *delete* for the year-folder copies. A photo in two albums keeps
   both album copies; `immich-go` sees identical files and creates one asset in both albums.
2. **Year-only exact duplicates:** keep one, preferring the copy with a matched sidecar.
3. **Google vs. non-Google sources** (when other folders are scanned alongside Takeout): prefer
   the Google copy when the files are otherwise equal (same SHA/content hash), since it carries
   the sidecar.
4. **Near-duplicates** (content_hash / phash / clip): existing review. Preselection tie-breakers:
   in an album → has sidecar → higher resolution → larger file → more EXIF fields.
   **clip groups are never preselected** (RFD-002).
5. Never preselect deletion of the *last* copy of anything, and never split a pair (section D).

### F. Deletion keeps the Takeout layout intact

- **Prune in place; never restructure.** `immich-go upload from-google-photos` reads the
  Takeout layout (album folders, sidecars), so files must stay where Google put them.
- Deleting a media file **also deletes its own sidecar** (each copy has its own). The kept
  file's sidecar is untouched. The "keep JSON with the kept Google copy" rule is satisfied
  by never moving anything.
- **Quarantine instead of deleting** for this run: move removed files to
  `<quarantine-root>/<path relative to Takeout root>`, outside the Takeout tree, so any
  mistake can be undone. Extend `applyDecisions.ts` (FRAGILE: follow `_FRAGILE.md`) with a
  `quarantineRoot` option alongside `dryRun` / `moveToTrash`.
- If the kept file is **not** a Google copy but a deleted Google duplicate had a sidecar, record
  that sidecar's metadata in the DB and (phase 2) write an `.xmp` sidecar next to the kept file
  so the capture date and GPS survive into Immich.

### G. Validation before import

After pruning:

1. `immich-go upload from-google-photos --dry-run <Takeout root>`: compare its counts of
   assets, albums and missing-sidecar warnings against the app's own report.
2. The app's report shows: files kept/quarantined per method, albums preserved (count of
   album folders still containing ≥1 file vs. before), sidecars matched/unmatched.

## Findings from implementing steps 1–2 (2026-11-12)

Built from the filename patterns real exports produce (as documented by importers that handle
them), with **synthetic** fixtures. Before the production run, check the classifier, matcher and
pair detection against an anonymized sample of the real Takeout and extend the fixtures.

- **Title alone is ambiguous.** `IMG.jpg` and `IMG(1).jpg` both carry `"title": "IMG.jpg"`, so
  §C's "by content first" cannot work on its own. Implemented order: sidecar **name** (exact, then
  truncated at the 51-char cap), then `title`, always requiring the duplicate counter to agree
  (`IMG.jpg(1).json` / `IMG.jpg.supplemental-metadata(1).json` ↔ `IMG(1).jpg`).
- **Album folders may hold only sidecars.** Some exports put the photo once in `Photos from YYYY`
  and only its JSON in the album folder. Problem §2 ("appears twice, byte-identical") is then
  false. Album membership is recorded either way: a physical album copy is a media file in an
  album folder; an album-only sidecar is linked to the year-folder photo with method
  `album_reference` (same name + counter, disambiguated by `photoTakenTime`'s year). Rule §E.1
  must treat both forms as "in an album". Which form this export uses is still to be verified.
- **Archive/trash are JSON flags**, not only folders: `archived` / `trashed` are stored per sidecar.
- **One sidecar, several files.** Edited copies and motion/live videos have no JSON of their own.
  Kept as in §C (one `mediaFileId` + `matchMethod` per sidecar); the secondary of a pair inherits
  the primary's sidecar through `mediaPairs` (reported as covered, not as missing). If the original
  is absent, the edited copy is linked directly (`edited_name`).
- **Data model** (migration 0008): `takeoutFolders` (kind, year, album title) referenced by
  `mediaFiles.takeoutFolderId` instead of `folderKind`/`albumName` columns; `sidecars` as §C plus
  `trashed`/`archived`/`favorited`/`people`/`takeoutFolderId` and kind `unparseable`;
  `mediaPairs` (`motion` | `edited`).
- **Pipeline:** indexing runs at the end of the scanning stage; the report (counts, warnings,
  drill-down lists via `getTakeoutReport`) is shown under the scanning step.
- Localized folder/suffix names beyond English are best-effort lists.

### Preselection and quarantine (steps 3–4), 2026-11-12

- `review/preselect.ts` implements §E as written, plus: a copy in Trash/Archive ranks last; a
  year-folder photo referenced by an album-only sidecar counts as "in an album" (E.1). Suggestions
  carry `keepFileIds` (several keeps); the review screen pre-marks all of them.
- Folder priority now ranks *after* the Takeout rules (it used to decide first).
- Apply: `deletion-plan.ts` enforces never-the-last-copy (per group, and for a motion partner's own
  exact-copy group), never splitting a motion pair, and sidecars-follow-their-file. These hold even
  when `allowDeleteAll` is on: a group can no longer be emptied completely.
- Quarantine is the default (`quarantineEnabled`, `quarantinePath` = `<app data>/quarantine`);
  paths mirror the location below the scan folder; `quarantine-manifest.jsonl` + `restoreQuarantine`
  undo it (no UI button for restore yet).
- The apply dialog runs a dry run first and shows the plan before the confirm button is enabled.
- Step 5 (immich-go dry-run validation) remains.

## Alternatives Considered

- **Let Immich deduplicate after import.** Rejected: Immich's exact-match check is per user and
  SHA-1 only; it has no metadata-stripped hash or pHash; its CLIP review is one group at a time,
  which is unworkable at this scale.
- **Flatten into a new folder structure, then import.** Rejected: loses the album and sidecar
  layout `immich-go` relies on.
- **Delete album copies and keep year-folder copies.** Rejected per the maintainer's album rule.

## Decision
Pending review.

## Implementation Notes

- Order: (1) folder classification + sidecar table/linking + report; (2) pairs; (3) preselection
  rules; (4) quarantine in `applyDecisions.ts`; (5) immich-go dry-run validation step.
- Migrations need an updated `packages/core/er-diagram.html`.
- Build fixtures from a small real Takeout (a handful of albums, a motion photo, an edited photo,
  a long filename) and anonymize them.

## References

- https://github.com/simulot/immich-go (Google Photos Takeout import)
- https://support.google.com/accounts/answer/3024190 (Google Takeout)
- RFD-002 (analysis pipeline, CLIP review-only rule), RFD-004 (review UI)
