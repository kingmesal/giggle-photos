# RFD-005: Folder owner devices: keep the copy in the phone owner's folder

## Status
Implemented 2026-11-12 (after RFD-004). Precedence decided by the maintainer: **album first by
default, with the order user-configurable**.

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
- **Storage:** a `folderOwnerDevices` table (scanFolderId FK cascade, cameraMake nullable,
  cameraModel; unique per folder), five Zod schemas, migration 0011, ER diagram.
- **Preselection rule** (extends RFD-003 §E): a copy is *owned* when its own scan folder owns the
  camera (exact make and model) that took it. Two narrowing rules, in the order set in
  Settings → Preselection (`preselectRuleOrder`, default `["album", "owner_device"]`): each keeps
  only the matching copies when some match and some don't. Then the usual ranking picks among what
  is left. "Never split a pair" and "never the last copy" still apply.
  - Album first (default): the other person's album copy beats the owner's year-folder copy, so it
    stays in its album. For exact duplicates every album copy is kept and the owner rule does not
    narrow further (deleting an album copy would drop it from that album).
  - Owner first: the owner's copies win; among them, album copies are kept. The other person's
    album copy is preselected for deletion (overridable in review).
  - Applies to sha256, content_hash and phash groups; never to CLIP groups.
- Matching uses `imageMetadata.cameraMake/cameraModel` (already extracted). Photos without EXIF
  model fall through to the other rules. Always overridable in review.
- UI: Folders → the phone button on a folder lists the cameras found in its photos with counts
  (owned ones ticked); saving re-evaluates the suggestions in review.

## Open Questions
- Videos: model often missing from container metadata; leave to other rules unless ffprobe has it.

## References
- RFD-003 §E (preselection rules), RFD-004 (folder setup UI)
