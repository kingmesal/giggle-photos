import { describe, expect, test } from "bun:test";
import { parseSidecarJson } from "./sidecar-parse";

// Synthetic, anonymized content in Google's export shape.
const mediaSidecar = {
  title: "PXL_20240102_101010101.jpg",
  description: "",
  imageViews: "3",
  creationTime: { timestamp: "1704200000", formatted: "Jan 2, 2024, 12:53:20 PM UTC" },
  photoTakenTime: { timestamp: "1704190210", formatted: "Jan 2, 2024, 10:10:10 AM UTC" },
  geoData: { latitude: 0.0, longitude: 0.0, altitude: 0.0, latitudeSpan: 0.0, longitudeSpan: 0.0 },
  geoDataExif: { latitude: 38.7223, longitude: -9.1393, altitude: 12.5, latitudeSpan: 0.0, longitudeSpan: 0.0 },
  people: [{ name: "Person A" }, { name: "Person B" }],
  url: "https://photos.google.com/photo/EXAMPLE",
  googlePhotosOrigin: { mobileUpload: { deviceType: "ANDROID_PHONE" } },
  favorited: true,
  archived: true,
};

describe("parseSidecarJson", () => {
  test("media sidecar: title, taken time, location fallback, flags, people", () => {
    const parsed = parseSidecarJson(JSON.stringify(mediaSidecar));
    expect(parsed).toEqual({
      kind: "media",
      title: "PXL_20240102_101010101.jpg",
      description: null,
      photoTakenTime: new Date(1704190210 * 1000),
      geoLat: 38.7223,
      geoLon: -9.1393,
      geoAlt: 12.5,
      trashed: false,
      archived: true,
      favorited: true,
      people: ["Person A", "Person B"],
    });
  });

  test("geoData wins over geoDataExif when set; 0/0 means no location", () => {
    const edited = { ...mediaSidecar, geoData: { latitude: 41.15, longitude: -8.61, altitude: 90 } };
    expect(parseSidecarJson(JSON.stringify(edited))).toMatchObject({ geoLat: 41.15, geoLon: -8.61 });
    const none = { ...mediaSidecar, geoDataExif: { latitude: 0, longitude: 0, altitude: 0 } };
    expect(parseSidecarJson(JSON.stringify(none))).toMatchObject({ geoLat: null, geoLon: null, geoAlt: null });
  });

  test("album metadata: a title and no photo fields", () => {
    const album = { title: "Trip to Lisbon", description: "", access: "protected", date: { timestamp: "0" } };
    expect(parseSidecarJson(JSON.stringify(album))).toMatchObject({ kind: "album_metadata", title: "Trip to Lisbon" });
  });

  test("anything else is 'other'", () => {
    expect(parseSidecarJson("[]").kind).toBe("other");
    expect(parseSidecarJson(JSON.stringify({ comments: [] })).kind).toBe("other");
  });

  test("missing or zero taken time is null", () => {
    const noTime = { ...mediaSidecar, photoTakenTime: { timestamp: "0" } };
    expect(parseSidecarJson(JSON.stringify(noTime)).photoTakenTime).toBeNull();
  });

  test("invalid JSON throws", () => {
    expect(() => parseSidecarJson("{not json")).toThrow();
  });
});
