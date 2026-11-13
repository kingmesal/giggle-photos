# RFD-006: Capture dates from Google JSON, file names and dated folders

## Status
**Superseded by RFD-007 (Library Tools)** for writing: the date parsing and source rules below
still apply; the writer, the Capture Dates screen and the "final step" lock were replaced by
Library Tools, which run any time (maintainer, 2026-11-13).

Implemented 2026-11-13. Decisions by the maintainer: **XMP sidecars** (originals untouched; this
replaced a first version that wrote into the files with ExifTool); year-only dates become
**July 1**; **review list, then apply**; **the final step, after duplicate checks**.

## Problem

Some photos and videos have no capture date in their metadata (scans, messaging apps, edited
exports, old cameras). Immich then sorts them by file date, which is usually the download or copy
date. Often the date is still known: Google Takeout's JSON sidecar has `photoTakenTime`, the file
name has it (`IMG_20190512_143000.jpg`), or the photo sits in a dated folder (`2019-05-12 Trip`,
`2019/05`, `Photos from 2019`).

## Solution

- **Candidates:** files whose image or video metadata has no `dateTaken` (files never analysed
  are skipped).
- **Source, best first** (`dates/capture-dates.ts`):
  1. Google JSON `photoTakenTime`: an exact instant, written as UTC (`+00:00`).
  2. File name: a day, often with a time (milliseconds ignored).
  3. Folder, deepest first: day (`2019-05-12 …`, `2019/05/12`), month (`2019-05`, `2019/05`) or
     year (`Photos from 2019`, `2019`).
  Partial dates: year-only → July 1, month-only → the 15th, a day without a time → 12:00 (noon keeps
  the day stable across time zones). Years before 1990 or after next year are ignored.
- **Review:** the Capture Dates screen lists every proposal with its source and precision, counts by
  source and precision, and how many undated files nothing could date (left alone).
- **Apply** (`dates/capture-date-writer.ts`): writes `<file>.xmp` next to each file (e.g.
  `IMG_1.jpg.xmp`, Immich's preferred naming) with `exif:DateTimeOriginal`, `xmp:CreateDate` and
  `photoshop:DateCreated` (exact instants as `+00:00`, wall times without a zone), `dc:source` saying
  where the date came from, and `xmp:CreatorTool="Giggle Photos"`. Sidecars with that marker may be
  rewritten; any other existing `.xmp` is left alone and reported as skipped. The original is never
  touched, so its SHA-256 does not change. The database records `dateTaken` so the file is not
  proposed again. A background job with progress; each file's failure is reported without stopping
  the rest. The tests read the sidecars back with exiftool-vendored, which is what Immich uses.
- Removing a file (quarantine, trash or delete) takes its `.xmp` with it; restore brings it back.
- **The final step, after duplicate checks** (maintainer's decision, 2026-11-13): dates are
  written only for the copies that are kept. Writing is
  locked until no sha256 / content-hash / pHash groups are pending, no conflicts remain, and no
  delete decisions are waiting to be applied (`dates/readiness.ts`). The desktop handler refuses
  to start otherwise, and the screen shows a preview plus the reasons. CLIP groups are review-only
  and do not block.

## Importing with immich-go

- `immich-go upload from-folder` and Immich external libraries read `<file>.xmp` sidecars.
- `immich-go upload from-google-photos` (the Takeout path, RFD-003) reads only Google's JSON; it
  lists `.xmp` files as unknown and does not use them (checked in its source, 2026-11-13). Takeout
  files dated from their own JSON need nothing more. Takeout files with no JSON and no EXIF date
  (dated here from a name or folder) do not get the sidecar's date through `from-google-photos`.
  See Open Questions.

## Open Questions
- Takeout files with neither EXIF nor JSON date, imported with `from-google-photos`: the sidecar
  is not read. Options: import those with `from-folder`, or write a supplemental JSON sidecar that
  immich-go does read. Decide after the first real Takeout run shows how many there are.
- Time zone for exact instants: written as UTC. With GPS, the local zone could be derived (the
  library includes tz lookup); not done yet.
