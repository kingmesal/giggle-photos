import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "bun:test";
import { ExifTool } from "exiftool-vendored";
import { parseXmp, renderXmp, xmpCoordinate } from "./xmp-document";
import { mergeFields, type XmpFields } from "./xmp-fields";

const FULL: XmpFields = {
  dateTaken: { value: "2019-05-12T21:30:00+00:00", source: "json" },
  gps: { value: { lat: 37.774929, lon: -122.419416, alt: 16.5 }, source: "json" },
  description: { value: 'Beach & "sun" <3', source: "json" },
  rating: { value: 5, source: "json" },
  people: { value: ["Heather", "Jim"], source: "json" },
  cameraMake: { value: "Google", source: "embedded" },
  cameraModel: { value: "Pixel 8", source: "embedded" },
};

describe("XMP document", () => {
  test("round-trips our fields; another app's sidecar is foreign", () => {
    expect(parseXmp(renderXmp(FULL))).toEqual({ ours: true, fields: FULL });
    expect(parseXmp("<x:xmpmeta xmlns:x='adobe:ns:meta/'/>")).toEqual({ ours: false });
  });

  test("GPS as degrees + decimal minutes with hemisphere", () => {
    expect(xmpCoordinate(37.5, "lat")).toBe("37,30.000000N");
    expect(xmpCoordinate(-122.25, "lon")).toBe("122,15.000000W");
  });

  test("merge: a more trusted source wins; a guess never replaces real data", () => {
    const embedded: XmpFields = { dateTaken: { value: "2019-05-12T14:30:00", source: "embedded" } };
    const folder: XmpFields = { dateTaken: { value: "2019-07-01T12:00:00", source: "folder" } };
    const json: XmpFields = { dateTaken: { value: "2019-05-12T21:30:00+00:00", source: "json" } };
    expect(mergeFields(embedded, folder).dateTaken?.source).toBe("embedded");
    expect(mergeFields(embedded, json).dateTaken?.source).toBe("json");
    expect(mergeFields(json, embedded).dateTaken?.source).toBe("json");
    expect(mergeFields({ rating: { value: 5, source: "json" } }, embedded)).toMatchObject({ rating: { value: 5 } });
  });
});

const dir = mkdtempSync(join(tmpdir(), "xmp-doc-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

test("ExifTool (as Immich uses it) reads every field", async () => {
  const path = join(dir, "IMG.jpg.xmp");
  writeFileSync(path, renderXmp(FULL));
  const et = new ExifTool({ maxProcs: 1 });
  try {
    const t = (await et.read(path)) as Record<string, unknown>;
    expect(String(t.DateTimeOriginal)).toBe("2019-05-12T21:30:00Z");
    expect(t.GPSLatitude as number).toBeCloseTo(37.774929, 5);
    expect(t.GPSLongitude as number).toBeCloseTo(-122.419416, 5);
    expect(t.GPSAltitude as number).toBeCloseTo(16.5, 2);
    expect(t.Description).toBe('Beach & "sun" <3');
    expect(t.Rating).toBe(5);
    expect(t.PersonInImage).toEqual(["Heather", "Jim"]);
    expect(t.Make).toBe("Google");
    expect(t.Model).toBe("Pixel 8");
  } finally {
    await et.end();
  }
}, 30_000);
