import { describe, expect, test } from "bun:test";
import { ImageMetadata, ImageMetadataRecord, NewImageMetadata, UpdateImageMetadata } from "./image-metadata";

const validDate = new Date("2024-01-15T12:00:00.000Z");
const validDate2 = new Date("2024-01-16T12:00:00.000Z");
const dateTaken = new Date("2023-06-20T14:30:00.000Z");

function validImageMetadataInput(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    mediaFileId: 42,
    width: 1920,
    height: 1080,
    format: "jpeg",
    colorSpace: "sRGB",
    hasAlpha: false,
    orientation: 1,
    dateTaken: dateTaken,
    cameraMake: "Canon",
    cameraModel: "EOS R5",
    gpsLatitude: 40.7128,
    gpsLongitude: -74.006,
    createdAt: validDate,
    updatedAt: validDate2,
    ...overrides,
  };
}

describe("image-metadata", () => {
  describe("ImageMetadata", () => {
    test("parses valid full input", () => {
      const input = validImageMetadataInput();
      const result = ImageMetadata.parse(input);
      expect(result.id).toBe(1);
      expect(result.mediaFileId).toBe(42);
      expect(result.width).toBe(1920);
      expect(result.height).toBe(1080);
      expect(result.format).toBe("jpeg");
      expect(result.colorSpace).toBe("sRGB");
      expect(result.hasAlpha).toBe(false);
      expect(result.orientation).toBe(1);
      expect(result.dateTaken).toEqual(dateTaken);
      expect(result.cameraMake).toBe("Canon");
      expect(result.cameraModel).toBe("EOS R5");
      expect(result.gpsLatitude).toBe(40.7128);
      expect(result.gpsLongitude).toBe(-74.006);
      expect(result.createdAt).toEqual(validDate);
      expect(result.updatedAt).toEqual(validDate2);
    });

    test("applies defaults for nullable fields", () => {
      const input = {
        id: 1,
        mediaFileId: 10,
        width: 800,
        height: 600,
        format: "png",
        hasAlpha: true,
        createdAt: validDate,
        updatedAt: validDate2,
      };
      const result = ImageMetadata.parse(input);
      expect(result.colorSpace).toBeNull();
      expect(result.orientation).toBeNull();
      expect(result.dateTaken).toBeNull();
      expect(result.cameraMake).toBeNull();
      expect(result.cameraModel).toBeNull();
      expect(result.gpsLatitude).toBeNull();
      expect(result.gpsLongitude).toBeNull();
    });

    test("rejects id zero or negative", () => {
      expect(ImageMetadata.safeParse(validImageMetadataInput({ id: 0 })).success).toBe(false);
      expect(ImageMetadata.safeParse(validImageMetadataInput({ id: -1 })).success).toBe(false);
    });

    test("rejects non-integer id", () => {
      expect(ImageMetadata.safeParse(validImageMetadataInput({ id: 1.5 })).success).toBe(false);
    });

    test("rejects mediaFileId zero or negative", () => {
      expect(ImageMetadata.safeParse(validImageMetadataInput({ mediaFileId: 0 })).success).toBe(false);
      expect(ImageMetadata.safeParse(validImageMetadataInput({ mediaFileId: -1 })).success).toBe(false);
    });

    test("rejects non-integer mediaFileId", () => {
      expect(ImageMetadata.safeParse(validImageMetadataInput({ mediaFileId: 2.5 })).success).toBe(false);
    });

    test("rejects width zero or negative", () => {
      expect(ImageMetadata.safeParse(validImageMetadataInput({ width: 0 })).success).toBe(false);
      expect(ImageMetadata.safeParse(validImageMetadataInput({ width: -100 })).success).toBe(false);
    });

    test("rejects non-integer width", () => {
      expect(ImageMetadata.safeParse(validImageMetadataInput({ width: 1920.5 })).success).toBe(false);
    });

    test("rejects height zero or negative", () => {
      expect(ImageMetadata.safeParse(validImageMetadataInput({ height: 0 })).success).toBe(false);
      expect(ImageMetadata.safeParse(validImageMetadataInput({ height: -100 })).success).toBe(false);
    });

    test("rejects non-integer height", () => {
      expect(ImageMetadata.safeParse(validImageMetadataInput({ height: 1080.5 })).success).toBe(false);
    });

    test("rejects empty format", () => {
      expect(ImageMetadata.safeParse(validImageMetadataInput({ format: "" })).success).toBe(false);
    });

    test("accepts various format values", () => {
      const formats = ["jpeg", "png", "webp", "gif", "tiff", "bmp", "heic"];
      for (const format of formats) {
        const result = ImageMetadata.parse(validImageMetadataInput({ format }));
        expect(result.format).toBe(format);
      }
    });

    test("accepts colorSpace as null", () => {
      const result = ImageMetadata.parse(validImageMetadataInput({ colorSpace: null }));
      expect(result.colorSpace).toBeNull();
    });

    test("accepts various colorSpace values", () => {
      const colorSpaces = ["sRGB", "Adobe RGB", "ProPhoto RGB", "Display P3"];
      for (const colorSpace of colorSpaces) {
        const result = ImageMetadata.parse(validImageMetadataInput({ colorSpace }));
        expect(result.colorSpace).toBe(colorSpace);
      }
    });

    test("converts hasAlpha truthy values to boolean", () => {
      expect(ImageMetadata.parse(validImageMetadataInput({ hasAlpha: true })).hasAlpha).toBe(true);
      expect(ImageMetadata.parse(validImageMetadataInput({ hasAlpha: false })).hasAlpha).toBe(false);
      expect(ImageMetadata.parse(validImageMetadataInput({ hasAlpha: 1 })).hasAlpha).toBe(true);
      expect(ImageMetadata.parse(validImageMetadataInput({ hasAlpha: 0 })).hasAlpha).toBe(false);
      expect(ImageMetadata.parse(validImageMetadataInput({ hasAlpha: "true" })).hasAlpha).toBe(true);
      expect(ImageMetadata.parse(validImageMetadataInput({ hasAlpha: "false" })).hasAlpha).toBe(false);
    });

    test("accepts orientation values 1-8", () => {
      for (let o = 1; o <= 8; o++) {
        const result = ImageMetadata.parse(validImageMetadataInput({ orientation: o }));
        expect(result.orientation).toBe(o);
      }
    });

    test("rejects orientation below 1 or above 8", () => {
      expect(ImageMetadata.safeParse(validImageMetadataInput({ orientation: 0 })).success).toBe(false);
      expect(ImageMetadata.safeParse(validImageMetadataInput({ orientation: 9 })).success).toBe(false);
    });

    test("accepts orientation as null", () => {
      const result = ImageMetadata.parse(validImageMetadataInput({ orientation: null }));
      expect(result.orientation).toBeNull();
    });

    test("rejects non-integer orientation", () => {
      expect(ImageMetadata.safeParse(validImageMetadataInput({ orientation: 1.5 })).success).toBe(false);
    });

    test("accepts dateTaken as Date object", () => {
      const result = ImageMetadata.parse(validImageMetadataInput({ dateTaken }));
      expect(result.dateTaken).toEqual(dateTaken);
    });

    test("accepts dateTaken as timestamp", () => {
      const result = ImageMetadata.parse(validImageMetadataInput({ dateTaken: dateTaken.getTime() }));
      expect(result.dateTaken).toBeInstanceOf(Date);
    });

    test("accepts dateTaken as ISO string", () => {
      const result = ImageMetadata.parse(validImageMetadataInput({ dateTaken: "2023-06-20T14:30:00.000Z" }));
      expect(result.dateTaken).toBeInstanceOf(Date);
    });

    test("accepts dateTaken as null", () => {
      const result = ImageMetadata.parse(validImageMetadataInput({ dateTaken: null }));
      expect(result.dateTaken).toBeNull();
    });

    test("accepts cameraMake and cameraModel as null", () => {
      const result = ImageMetadata.parse(validImageMetadataInput({ cameraMake: null, cameraModel: null }));
      expect(result.cameraMake).toBeNull();
      expect(result.cameraModel).toBeNull();
    });

    test("accepts various cameraMake and cameraModel values", () => {
      const cameras = [
        { make: "Canon", model: "EOS R5" },
        { make: "Nikon", model: "Z9" },
        { make: "Sony", model: "A7R IV" },
        { make: "Apple", model: "iPhone 15 Pro" },
      ];
      for (const camera of cameras) {
        const result = ImageMetadata.parse(
          validImageMetadataInput({ cameraMake: camera.make, cameraModel: camera.model }),
        );
        expect(result.cameraMake).toBe(camera.make);
        expect(result.cameraModel).toBe(camera.model);
      }
    });

    test("accepts gpsLatitude as null", () => {
      const result = ImageMetadata.parse(validImageMetadataInput({ gpsLatitude: null }));
      expect(result.gpsLatitude).toBeNull();
    });

    test("accepts gpsLongitude as null", () => {
      const result = ImageMetadata.parse(validImageMetadataInput({ gpsLongitude: null }));
      expect(result.gpsLongitude).toBeNull();
    });

    test("accepts valid GPS coordinates", () => {
      const coordinates = [
        { lat: 40.7128, lng: -74.006 }, // New York
        { lat: -33.8688, lng: 151.2093 }, // Sydney
        { lat: 51.5074, lng: -0.1278 }, // London
        { lat: 0, lng: 0 }, // Origin
        { lat: 90, lng: 180 }, // Max positive
        { lat: -90, lng: -180 }, // Max negative
      ];
      for (const coord of coordinates) {
        const result = ImageMetadata.parse(
          validImageMetadataInput({ gpsLatitude: coord.lat, gpsLongitude: coord.lng }),
        );
        expect(result.gpsLatitude).toBe(coord.lat);
        expect(result.gpsLongitude).toBe(coord.lng);
      }
    });

    test("accepts date-like inputs for createdAt/updatedAt", () => {
      const input = validImageMetadataInput({
        createdAt: validDate.getTime(),
        updatedAt: validDate2.getTime(),
      });
      const result = ImageMetadata.parse(input);
      expect(result.createdAt).toBeInstanceOf(Date);
      expect(result.updatedAt).toBeInstanceOf(Date);
    });
  });

  describe("ImageMetadataRecord", () => {
    test("parses input with SQL types for hasAlpha and dates", () => {
      const input = {
        mediaFileId: 42,
        width: 1920,
        height: 1080,
        format: "jpeg",
        colorSpace: "sRGB",
        hasAlpha: 0,
        orientation: 1,
        dateTaken: dateTaken.getTime(),
        cameraMake: "Canon",
        cameraModel: "EOS R5",
        gpsLatitude: 40.7128,
        gpsLongitude: -74.006,
        createdAt: validDate.getTime(),
        updatedAt: validDate2.getTime(),
      };
      const result = ImageMetadataRecord.parse(input);
      expect(result.mediaFileId).toBe(42);
      expect(result.hasAlpha).toBe(0);
      expect(result.createdAt).toBe(validDate.getTime());
      expect(result.updatedAt).toBe(validDate2.getTime());
    });

    test("preprocesses hasAlpha boolean to 0/1", () => {
      const input = {
        mediaFileId: 10,
        width: 800,
        height: 600,
        format: "png",
        colorSpace: null,
        hasAlpha: true,
        orientation: null,
        dateTaken: null,
        cameraMake: null,
        cameraModel: null,
        gpsLatitude: null,
        gpsLongitude: null,
        createdAt: 0,
        updatedAt: 0,
      };
      const result = ImageMetadataRecord.parse(input);
      expect(result.hasAlpha).toBe(1);
    });

    test("preprocesses hasAlpha false to 0", () => {
      const input = {
        mediaFileId: 10,
        width: 800,
        height: 600,
        format: "png",
        colorSpace: null,
        hasAlpha: false,
        orientation: null,
        dateTaken: null,
        cameraMake: null,
        cameraModel: null,
        gpsLatitude: null,
        gpsLongitude: null,
        createdAt: 0,
        updatedAt: 0,
      };
      const result = ImageMetadataRecord.parse(input);
      expect(result.hasAlpha).toBe(0);
    });

    test("accepts dateTaken as timestamp or null", () => {
      const input = {
        mediaFileId: 10,
        width: 800,
        height: 600,
        format: "png",
        colorSpace: null,
        hasAlpha: 0,
        orientation: null,
        dateTaken: dateTaken.getTime(),
        cameraMake: null,
        cameraModel: null,
        gpsLatitude: null,
        gpsLongitude: null,
        createdAt: 0,
        updatedAt: 0,
      };
      const result = ImageMetadataRecord.parse(input);
      expect(result.dateTaken).toBe(dateTaken.getTime());

      const inputNull = { ...input, dateTaken: null };
      const resultNull = ImageMetadataRecord.parse(inputNull);
      expect(resultNull.dateTaken).toBeNull();
    });

    test("accepts dateTaken as undefined (optional)", () => {
      const input = {
        mediaFileId: 10,
        width: 800,
        height: 600,
        format: "png",
        colorSpace: null,
        hasAlpha: 0,
        orientation: null,
        cameraMake: null,
        cameraModel: null,
        gpsLatitude: null,
        gpsLongitude: null,
        createdAt: 0,
        updatedAt: 0,
      };
      const result = ImageMetadataRecord.parse(input);
      expect(result.dateTaken).toBeUndefined();
    });

    test("parsed result omits id (schema has no id field)", () => {
      const input = {
        id: 1,
        mediaFileId: 10,
        width: 800,
        height: 600,
        format: "png",
        colorSpace: null,
        hasAlpha: 0,
        orientation: null,
        dateTaken: null,
        cameraMake: null,
        cameraModel: null,
        gpsLatitude: null,
        gpsLongitude: null,
        createdAt: 0,
        updatedAt: 0,
      };
      const result = ImageMetadataRecord.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) expect("id" in result.data).toBe(false);
    });

    test("converts Date to timestamp for createdAt/updatedAt", () => {
      const input = {
        mediaFileId: 10,
        width: 800,
        height: 600,
        format: "png",
        colorSpace: null,
        hasAlpha: 0,
        orientation: null,
        dateTaken: null,
        cameraMake: null,
        cameraModel: null,
        gpsLatitude: null,
        gpsLongitude: null,
        createdAt: validDate,
        updatedAt: validDate2,
      };
      const result = ImageMetadataRecord.parse(input);
      expect(result.createdAt).toBe(validDate.getTime());
      expect(result.updatedAt).toBe(validDate2.getTime());
    });
  });

  describe("NewImageMetadata", () => {
    test("parses input without id, createdAt, updatedAt", () => {
      const input = {
        mediaFileId: 100,
        width: 3840,
        height: 2160,
        format: "heic",
        colorSpace: "Display P3",
        hasAlpha: false,
        orientation: 6,
        dateTaken: dateTaken,
        cameraMake: "Apple",
        cameraModel: "iPhone 15 Pro",
        gpsLatitude: 37.7749,
        gpsLongitude: -122.4194,
      };
      const result = NewImageMetadata.parse(input);
      expect(result.mediaFileId).toBe(100);
      expect(result.width).toBe(3840);
      expect(result.height).toBe(2160);
      expect(result.format).toBe("heic");
      expect("id" in result).toBe(false);
      expect("createdAt" in result).toBe(false);
      expect("updatedAt" in result).toBe(false);
    });

    test("applies defaults for nullable fields", () => {
      const input = {
        mediaFileId: 1,
        width: 100,
        height: 100,
        format: "jpeg",
        hasAlpha: false,
      };
      const result = NewImageMetadata.parse(input);
      expect(result.colorSpace).toBeNull();
      expect(result.orientation).toBeNull();
      expect(result.dateTaken).toBeNull();
      expect(result.cameraMake).toBeNull();
      expect(result.cameraModel).toBeNull();
      expect(result.gpsLatitude).toBeNull();
      expect(result.gpsLongitude).toBeNull();
    });

    test("requires mediaFileId", () => {
      const input = {
        width: 100,
        height: 100,
        format: "jpeg",
        hasAlpha: false,
      };
      expect(NewImageMetadata.safeParse(input).success).toBe(false);
    });

    test("requires width", () => {
      const input = {
        mediaFileId: 1,
        height: 100,
        format: "jpeg",
        hasAlpha: false,
      };
      expect(NewImageMetadata.safeParse(input).success).toBe(false);
    });

    test("requires height", () => {
      const input = {
        mediaFileId: 1,
        width: 100,
        format: "jpeg",
        hasAlpha: false,
      };
      expect(NewImageMetadata.safeParse(input).success).toBe(false);
    });

    test("requires format", () => {
      const input = {
        mediaFileId: 1,
        width: 100,
        height: 100,
        hasAlpha: false,
      };
      expect(NewImageMetadata.safeParse(input).success).toBe(false);
    });

    test("defaults hasAlpha to false when not provided", () => {
      const input = {
        mediaFileId: 1,
        width: 100,
        height: 100,
        format: "jpeg",
      };
      const result = NewImageMetadata.parse(input);
      expect(result.hasAlpha).toBe(false);
    });

    test("rejects empty format", () => {
      const input = {
        mediaFileId: 1,
        width: 100,
        height: 100,
        format: "",
        hasAlpha: false,
      };
      expect(NewImageMetadata.safeParse(input).success).toBe(false);
    });

    test("rejects invalid mediaFileId", () => {
      const input = {
        mediaFileId: 0,
        width: 100,
        height: 100,
        format: "jpeg",
        hasAlpha: false,
      };
      expect(NewImageMetadata.safeParse(input).success).toBe(false);
    });

    test("rejects invalid dimensions", () => {
      expect(
        NewImageMetadata.safeParse({
          mediaFileId: 1,
          width: 0,
          height: 100,
          format: "jpeg",
          hasAlpha: false,
        }).success,
      ).toBe(false);
      expect(
        NewImageMetadata.safeParse({
          mediaFileId: 1,
          width: 100,
          height: -1,
          format: "jpeg",
          hasAlpha: false,
        }).success,
      ).toBe(false);
    });
  });

  describe("UpdateImageMetadata", () => {
    test("requires id", () => {
      expect(UpdateImageMetadata.safeParse({ width: 1000 }).success).toBe(false);
      const result = UpdateImageMetadata.safeParse({ id: 1 });
      expect(result.success).toBe(true);
    });

    test("accepts partial update with id", () => {
      const result = UpdateImageMetadata.parse({ id: 1, width: 2000 });
      expect(result.id).toBe(1);
      expect(result.width).toBe(2000);
    });

    test("accepts only id", () => {
      const result = UpdateImageMetadata.parse({ id: 5 });
      expect(result.id).toBe(5);
    });

    test("accepts multiple optional fields", () => {
      const result = UpdateImageMetadata.parse({
        id: 2,
        width: 4000,
        height: 3000,
        format: "tiff",
        colorSpace: "Adobe RGB",
        hasAlpha: true,
        orientation: 8,
      });
      expect(result.id).toBe(2);
      expect(result.width).toBe(4000);
      expect(result.height).toBe(3000);
      expect(result.format).toBe("tiff");
      expect(result.colorSpace).toBe("Adobe RGB");
      expect(result.hasAlpha).toBe(true);
      expect(result.orientation).toBe(8);
    });

    test("accepts GPS coordinate updates", () => {
      const result = UpdateImageMetadata.parse({
        id: 1,
        gpsLatitude: 35.6762,
        gpsLongitude: 139.6503,
      });
      expect(result.gpsLatitude).toBe(35.6762);
      expect(result.gpsLongitude).toBe(139.6503);
    });

    test("accepts camera info updates", () => {
      const result = UpdateImageMetadata.parse({
        id: 1,
        cameraMake: "Fujifilm",
        cameraModel: "X-T5",
      });
      expect(result.cameraMake).toBe("Fujifilm");
      expect(result.cameraModel).toBe("X-T5");
    });

    test("accepts dateTaken update", () => {
      const newDate = new Date("2024-12-25T10:00:00.000Z");
      const result = UpdateImageMetadata.parse({
        id: 1,
        dateTaken: newDate,
      });
      expect(result.dateTaken).toEqual(newDate);
    });

    test("rejects invalid id", () => {
      expect(UpdateImageMetadata.safeParse({ id: 0 }).success).toBe(false);
      expect(UpdateImageMetadata.safeParse({ id: -1 }).success).toBe(false);
    });

    test("rejects invalid width when provided", () => {
      expect(UpdateImageMetadata.safeParse({ id: 1, width: 0 }).success).toBe(false);
      expect(UpdateImageMetadata.safeParse({ id: 1, width: -100 }).success).toBe(false);
    });

    test("rejects invalid height when provided", () => {
      expect(UpdateImageMetadata.safeParse({ id: 1, height: 0 }).success).toBe(false);
      expect(UpdateImageMetadata.safeParse({ id: 1, height: -100 }).success).toBe(false);
    });

    test("rejects invalid orientation when provided", () => {
      expect(UpdateImageMetadata.safeParse({ id: 1, orientation: 0 }).success).toBe(false);
      expect(UpdateImageMetadata.safeParse({ id: 1, orientation: 9 }).success).toBe(false);
    });

    test("rejects empty format when provided", () => {
      expect(UpdateImageMetadata.safeParse({ id: 1, format: "" }).success).toBe(false);
    });

    test("rejects invalid mediaFileId when provided", () => {
      expect(UpdateImageMetadata.safeParse({ id: 1, mediaFileId: 0 }).success).toBe(false);
      expect(UpdateImageMetadata.safeParse({ id: 1, mediaFileId: -1 }).success).toBe(false);
    });

    test("allows setting nullable fields to null", () => {
      const result = UpdateImageMetadata.parse({
        id: 1,
        colorSpace: null,
        orientation: null,
        dateTaken: null,
        cameraMake: null,
        cameraModel: null,
        gpsLatitude: null,
        gpsLongitude: null,
      });
      expect(result.colorSpace).toBeNull();
      expect(result.orientation).toBeNull();
      expect(result.dateTaken).toBeNull();
      expect(result.cameraMake).toBeNull();
      expect(result.cameraModel).toBeNull();
      expect(result.gpsLatitude).toBeNull();
      expect(result.gpsLongitude).toBeNull();
    });
  });
});
