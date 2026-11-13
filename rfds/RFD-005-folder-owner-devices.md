# RFD-005: Folder owner devices: keep the copy in the phone owner's folder

## Status
Draft — 2026-11-12. Requested by the maintainer; implement **after RFD-004** (needs the folder
setup screen in the React UI).

## Problem

The household's Takeouts (one per person) overlap: shared albums and shared photos put the same
picture in both people's exports. When a duplicate group spans both, the right copy to keep is the
one in the folder of the person whose phone took the photo. Each person used different phone
models, and EXIF records the model, so the app can tell.

## Proposed Solution

- **Per-folder setup** (scan folder settings, RFD-004 UI): "Photos taken with these devices belong
  here." The screen lists the camera make/model values actually found in that folder's EXIF, with
  photo counts, so the user ticks real values instead of typing them. (EXIF names must match
  exactly: e.g. Google reports "Pixel 8" and "Pixel 8 Pro".)
- **Storage:** a `folderOwnerDevices` table (scanFolderId FK, cameraMake, cameraModel), five Zod
  schemas, ER diagram; or a JSON column on `scanFolders` if that stays simpler.
- **Preselection rule** (extends RFD-003 §E): within a duplicate group, if a copy lives in a folder
  that owns the photo's camera model, preselect *keep* for that copy. Order relative to RFD-003's
  rules: after "never split a pair" and "never delete the last copy"; before "album beats year
  folder"? To decide in review (an owner's year-folder copy vs the other person's album copy).
- Matching uses `imageMetadata.cameraMake/cameraModel` (already extracted). Photos without EXIF
  model fall through to the other rules. Always overridable in review.
- Report: per folder, how many photos matched an owned device and how many came from other devices.

## Open Questions
- Precedence against the album rule (see above).
- Videos: model often missing from container metadata; leave to other rules unless ffprobe has it.

## References
- RFD-003 §E (preselection rules), RFD-004 (folder setup UI)
