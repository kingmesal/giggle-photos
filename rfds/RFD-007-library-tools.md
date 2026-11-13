# RFD-007: Library Tools: XMP sidecars and Google JSON cleanup

## Status
Implemented 2026-11-13. Supersedes RFD-006's writer (its date parsing stays). Requested by the
maintainer: helpers that run over the library **any time, separate from duplicate checking**.

## Tools

1. **Write XMP from file metadata** (`library/tool-xmp-from-files.ts`): an XMP sidecar for every
   analysed photo and video with its own date, GPS and camera make/model. A file with no date gets
   one from its file name or dated folder (RFD-006 rules: year-only → July 1, month-only → the 15th,
   day → noon).
2. **Convert Google JSON to XMP** (`library/tool-json-to-xmp.ts`): from each photo's own Takeout
   JSON: `photoTakenTime` (exact, UTC), GPS (Google's 0,0 means none), description, favourite →
   `xmp:Rating` 5, people → `Iptc4xmpExt:PersonInImage` (names only; Takeout has no face
   positions). Edited copies and motion videos inherit their original's JSON fields. Albums,
   archived and trashed have no standard XMP field and are not converted. The JSON stays in place.
3. **Remove Google JSON files** (`library/tool-remove-json.ts`, ⚠️ FRAGILE): a post-import cleanup.
   By default only a photo's JSON whose data is already in our sidecar (checked on disk) is
   removed. Options add photos' JSON that has not been converted, and album metadata, album
   references and unmatched/unreadable JSON. It follows Settings → Removal: quarantine (restorable),
   else trash, else delete. Their database rows are removed. immich-go's `from-google-photos` needs
   these files, so the confirmation says to run it after the import.

## One sidecar per file

- `<file>.xmp` (e.g. `IMG_1.jpg.xmp`, Immich's preferred naming) next to the original. Originals
  are never written.
- Standard tags: `exif:DateTimeOriginal`, `xmp:CreateDate`, `photoshop:DateCreated`,
  `exif:GPSLatitude/Longitude/Altitude(Ref)`, `dc:description`, `xmp:Rating`,
  `Iptc4xmpExt:PersonInImage`, `tiff:Make/Model`, plus `xmp:CreatorTool="Giggle Photos"`.
- `giggle:Fields` holds the same fields with their **sources** as JSON, so the tools merge into
  their own sidecars without parsing arbitrary XMP. A field is replaced only by an equal or more
  trusted source: Google JSON > the file's own metadata > file name > folder. Running the tools in
  any order gives the same sidecar. JSON wins over the file's own data because it carries edits made
  in Google Photos.
- An `.xmp` without that marker was written by another app and is never touched (reported as
  skipped).
- Verified with exiftool-vendored (what Immich reads metadata with): every field reads back.
- Removing a file (deduplication) takes its `.xmp` with it, into quarantine and back on restore.

## Importing
`from-folder` and Immich external libraries read the sidecars; `from-google-photos` reads only
the JSON (see RFD-006).

## Jobs
One tool at a time runs in the background (`apps/desktop/src/bun/handlers/library-tools.ts`); the
screen polls its progress and refreshes the previews when it finishes.
