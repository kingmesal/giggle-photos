# RFD-006: Capture dates from Google JSON, file names and dated folders

## Status
Implemented 2026-11-13. Decisions by the maintainer: write **into the file**, **no backup**;
year-only dates become **July 1**; **review list, then apply**.

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
- **Apply** (`dates/capture-date-writer.ts`, ⚠️ FRAGILE): ExifTool (`exiftool-vendored`, lossless)
  writes EXIF `DateTimeOriginal` + `CreateDate` for photos and QuickTime `CreateDate` /
  `MediaCreateDate` / `TrackCreateDate` for videos, with `-overwrite_original` (no backup). Then the
  database follows: the new SHA-256 and size, and `dateTaken`. Proposals are recomputed at apply
  time, so a file dated since the review is never overwritten. It runs as a background job with
  progress, and each file's failure is reported without stopping the rest.
- **The final step, after duplicate checks** (maintainer's decision, 2026-11-13): writing changes
  the bytes, so SHA-256 would no longer pair a changed copy with its untouched twin. Writing is
  locked until no sha256 / content-hash / pHash groups are pending, no conflicts remain, and no
  delete decisions are waiting to be applied (`dates/readiness.ts`). The desktop handler refuses
  to start otherwise, and the screen shows a preview plus the reasons. CLIP groups are review-only
  and do not block.

## Packaging
`exiftool-vendored` is external to the bundle and shipped by the postBuild hook (RFD-001), which
starts ExifTool from the packaged copy before accepting the build. On macOS and Linux it runs the
bundled Perl script and needs the system `perl` (macOS ships it; most Linux distributions do).
Windows uses the bundled `exiftool.exe`.

## Open Questions
- Time zone for exact instants: written as UTC. With GPS, the local zone could be derived (the
  library includes tz lookup); not done yet.
- Videos dated from a name or folder: QuickTime stores UTC, so the wall time is written as if it
  were UTC (off by the local zone offset at most).
