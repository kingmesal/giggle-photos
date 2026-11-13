/**
 * Synthetic, anonymized Google Takeout layout covering every sidecar pattern RFD-003 handles.
 * Names follow patterns observed in real exports; none are copied from a real library.
 * Replace / extend with an anonymized real sample when one is available (RFD-003 §C).
 *
 * `sidecar` entries list the JSON file name, its `title`, and the expected link (media name or
 * null for "unmatched"), with the rule that should produce it.
 */
export interface FixtureSidecar {
  name: string;
  title: string | null;
  takenYear?: number;
  expect: { media: string; folder?: string; method: string } | null;
}
export interface FixtureFolder {
  name: string;
  media: string[];
  sidecars: FixtureSidecar[];
  /** Album folders: the metadata.json title (may differ from the folder name). */
  albumTitle?: string;
}

const s = (
  name: string,
  title: string | null,
  expect: FixtureSidecar["expect"],
  takenYear?: number,
): FixtureSidecar => ({
  name,
  title,
  expect,
  takenYear,
});

export const SYNTHETIC_TAKEOUT: Record<string, FixtureFolder> = {
  "Photos from 2023": {
    name: "Photos from 2023",
    media: [
      "PXL_20230102_101010101.jpg",
      "IMG_0042.JPG",
      "IMG_0042(1).JPG",
      "IMG_0050.jpg",
      "IMG_0050-edited.jpg",
      "IMG_0060.HEIC",
      "IMG_0060.MP4",
      "Screenshot_20230311_084512_Messages.jpg",
      "Screenshot_2023-03-11-08-45-12-123_com.whatsapp.jpg",
      "IMG_0070-edited.jpg",
      "NOSIDECAR_0001.jpg",
      "FAMILY_0001.jpg",
    ],
    sidecars: [
      s("PXL_20230102_101010101.jpg.json", "PXL_20230102_101010101.jpg", {
        media: "PXL_20230102_101010101.jpg",
        method: "name_exact",
      }),
      s("IMG_0042.JPG.json", "IMG_0042.JPG", { media: "IMG_0042.JPG", method: "name_exact" }),
      // Same title as the one above: only the counter tells them apart.
      s("IMG_0042.JPG(1).json", "IMG_0042.JPG", { media: "IMG_0042(1).JPG", method: "name_exact" }),
      s("IMG_0050.jpg.supplemental-metadata.json", "IMG_0050.jpg", { media: "IMG_0050.jpg", method: "name_exact" }),
      s("IMG_0060.HEIC.supplemental-metadata.json", "IMG_0060.HEIC", { media: "IMG_0060.HEIC", method: "name_exact" }),
      s("Screenshot_20230311_084512_Messages.jpg.supple.json", "Screenshot_20230311_084512_Messages.jpg", {
        media: "Screenshot_20230311_084512_Messages.jpg",
        method: "name_exact",
      }),
      s("Screenshot_2023-03-11-08-45-12-123_com.whatsap.json", "Screenshot_2023-03-11-08-45-12-123_com.whatsapp.jpg", {
        media: "Screenshot_2023-03-11-08-45-12-123_com.whatsapp.jpg",
        method: "name_truncated",
      }),
      // Original missing, edited copy present.
      s("IMG_0070.jpg.supplemental-metadata.json", "IMG_0070.jpg", {
        media: "IMG_0070-edited.jpg",
        method: "edited_name",
      }),
      s("FAMILY_0001.jpg.json", "FAMILY_0001.jpg", { media: "FAMILY_0001.jpg", method: "name_exact" }),
      // Media deleted from the export: nothing to link.
      s("GONE_0001.jpg.json", "GONE_0001.jpg", null),
    ],
  },
  "Photos from 2024": {
    name: "Photos from 2024",
    media: ["FAMILY_0001.jpg"],
    sidecars: [s("FAMILY_0001.jpg.json", "FAMILY_0001.jpg", { media: "FAMILY_0001.jpg", method: "name_exact" })],
  },
  "Trip to Lisbon": {
    name: "Trip to Lisbon",
    albumTitle: "Trip to Lisbon",
    // Album with physical copies (byte-identical to the year-folder files in a real export).
    media: ["PXL_20230102_101010101.jpg"],
    sidecars: [
      s("PXL_20230102_101010101.jpg.json", "PXL_20230102_101010101.jpg", {
        media: "PXL_20230102_101010101.jpg",
        method: "name_exact",
      }),
    ],
  },
  Family: {
    name: "Family",
    albumTitle: "Family ❤",
    // Album folder with sidecars only: the photo lives in a year folder. Two year folders hold a
    // FAMILY_0001.jpg; photoTakenTime's year picks the right one.
    media: [],
    sidecars: [
      s(
        "FAMILY_0001.jpg.json",
        "FAMILY_0001.jpg",
        { media: "FAMILY_0001.jpg", folder: "Photos from 2024", method: "album_reference" },
        2024,
      ),
      s(
        "IMG_0050.jpg.supplemental-metadata.json",
        "IMG_0050.jpg",
        { media: "IMG_0050.jpg", folder: "Photos from 2023", method: "album_reference" },
        2023,
      ),
    ],
  },
  Trash: {
    name: "Trash",
    media: ["TRASHED_0001.jpg"],
    sidecars: [s("TRASHED_0001.jpg.json", "TRASHED_0001.jpg", { media: "TRASHED_0001.jpg", method: "name_exact" })],
  },
};

/** Media expected to have no sidecar at all (own or inherited), as "folder/name". */
export const EXPECTED_WITHOUT_SIDECAR = ["Photos from 2023/NOSIDECAR_0001.jpg"];

/** Expected pairs as "folder/primary → secondary (kind)". */
export const EXPECTED_PAIRS = [
  "Photos from 2023/IMG_0050.jpg → IMG_0050-edited.jpg (edited)",
  "Photos from 2023/IMG_0060.HEIC → IMG_0060.MP4 (motion)",
];

/** Media that inherit a sidecar through a pair, as "folder/name (method)". */
export const EXPECTED_INHERITED = [
  "Photos from 2023/IMG_0050-edited.jpg (edited_copy)",
  "Photos from 2023/IMG_0060.MP4 (motion_video)",
];
