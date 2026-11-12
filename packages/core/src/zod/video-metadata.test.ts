import { describe, expect, test } from "bun:test";
import { NewVideoMetadata, UpdateVideoMetadata, VideoMetadata, VideoMetadataRecord } from "./video-metadata";

const validDate = new Date("2024-01-15T12:00:00.000Z");
const validDate2 = new Date("2024-01-16T12:00:00.000Z");
const dateTaken = new Date("2023-12-25T10:30:00.000Z");

function validVideoMetadataInput(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    mediaFileId: 100,
    width: 1920,
    height: 1080,
    duration: 120.5,
    frameRate: 29.97,
    codec: "h264",
    audioCodec: "aac",
    bitrate: 5000000,
    dateTaken: dateTaken,
    createdAt: validDate,
    updatedAt: validDate2,
    ...overrides,
  };
}

describe("video-metadata", () => {
  describe("VideoMetadata", () => {
    test("parses valid full input", () => {
      const input = validVideoMetadataInput();
      const result = VideoMetadata.parse(input);
      expect(result.id).toBe(1);
      expect(result.mediaFileId).toBe(100);
      expect(result.width).toBe(1920);
      expect(result.height).toBe(1080);
      expect(result.duration).toBe(120.5);
      expect(result.frameRate).toBe(29.97);
      expect(result.codec).toBe("h264");
      expect(result.audioCodec).toBe("aac");
      expect(result.bitrate).toBe(5000000);
      expect(result.dateTaken).toEqual(dateTaken);
      expect(result.createdAt).toEqual(validDate);
      expect(result.updatedAt).toEqual(validDate2);
    });

    test("applies defaults for nullable fields", () => {
      const input = {
        id: 1,
        mediaFileId: 100,
        width: 1920,
        height: 1080,
        duration: 60,
        createdAt: validDate,
        updatedAt: validDate2,
      };
      const result = VideoMetadata.parse(input);
      expect(result.frameRate).toBe(null);
      expect(result.codec).toBe(null);
      expect(result.audioCodec).toBe(null);
      expect(result.bitrate).toBe(null);
      expect(result.dateTaken).toBe(null);
    });

    test("accepts explicit null for nullable fields", () => {
      const input = validVideoMetadataInput({
        frameRate: null,
        codec: null,
        audioCodec: null,
        bitrate: null,
        dateTaken: null,
      });
      const result = VideoMetadata.parse(input);
      expect(result.frameRate).toBe(null);
      expect(result.codec).toBe(null);
      expect(result.audioCodec).toBe(null);
      expect(result.bitrate).toBe(null);
      expect(result.dateTaken).toBe(null);
    });

    test("rejects id zero or negative", () => {
      expect(VideoMetadata.safeParse(validVideoMetadataInput({ id: 0 })).success).toBe(false);
      expect(VideoMetadata.safeParse(validVideoMetadataInput({ id: -1 })).success).toBe(false);
    });

    test("rejects non-integer id", () => {
      expect(VideoMetadata.safeParse(validVideoMetadataInput({ id: 1.5 })).success).toBe(false);
    });

    test("rejects mediaFileId zero or negative", () => {
      expect(VideoMetadata.safeParse(validVideoMetadataInput({ mediaFileId: 0 })).success).toBe(false);
      expect(VideoMetadata.safeParse(validVideoMetadataInput({ mediaFileId: -1 })).success).toBe(false);
    });

    test("rejects non-integer mediaFileId", () => {
      expect(VideoMetadata.safeParse(validVideoMetadataInput({ mediaFileId: 1.5 })).success).toBe(false);
    });

    test("rejects width zero or negative", () => {
      expect(VideoMetadata.safeParse(validVideoMetadataInput({ width: 0 })).success).toBe(false);
      expect(VideoMetadata.safeParse(validVideoMetadataInput({ width: -1 })).success).toBe(false);
    });

    test("rejects non-integer width", () => {
      expect(VideoMetadata.safeParse(validVideoMetadataInput({ width: 1920.5 })).success).toBe(false);
    });

    test("rejects height zero or negative", () => {
      expect(VideoMetadata.safeParse(validVideoMetadataInput({ height: 0 })).success).toBe(false);
      expect(VideoMetadata.safeParse(validVideoMetadataInput({ height: -1 })).success).toBe(false);
    });

    test("rejects non-integer height", () => {
      expect(VideoMetadata.safeParse(validVideoMetadataInput({ height: 1080.5 })).success).toBe(false);
    });

    test("accepts zero duration", () => {
      const result = VideoMetadata.parse(validVideoMetadataInput({ duration: 0 }));
      expect(result.duration).toBe(0);
    });

    test("accepts decimal duration", () => {
      const result = VideoMetadata.parse(validVideoMetadataInput({ duration: 123.456 }));
      expect(result.duration).toBe(123.456);
    });

    test("rejects negative duration", () => {
      expect(VideoMetadata.safeParse(validVideoMetadataInput({ duration: -1 })).success).toBe(false);
      expect(VideoMetadata.safeParse(validVideoMetadataInput({ duration: -0.5 })).success).toBe(false);
    });

    test("accepts positive frameRate", () => {
      const result = VideoMetadata.parse(validVideoMetadataInput({ frameRate: 60 }));
      expect(result.frameRate).toBe(60);
    });

    test("accepts decimal frameRate", () => {
      const result = VideoMetadata.parse(validVideoMetadataInput({ frameRate: 23.976 }));
      expect(result.frameRate).toBe(23.976);
    });

    test("rejects zero or negative frameRate", () => {
      expect(VideoMetadata.safeParse(validVideoMetadataInput({ frameRate: 0 })).success).toBe(false);
      expect(VideoMetadata.safeParse(validVideoMetadataInput({ frameRate: -1 })).success).toBe(false);
    });

    test("accepts various codec strings", () => {
      for (const codec of ["h264", "hevc", "vp9", "av1", "mpeg4"]) {
        const result = VideoMetadata.parse(validVideoMetadataInput({ codec }));
        expect(result.codec).toBe(codec);
      }
    });

    test("accepts various audioCodec strings", () => {
      for (const audioCodec of ["aac", "mp3", "opus", "flac", "ac3"]) {
        const result = VideoMetadata.parse(validVideoMetadataInput({ audioCodec }));
        expect(result.audioCodec).toBe(audioCodec);
      }
    });

    test("accepts positive bitrate", () => {
      const result = VideoMetadata.parse(validVideoMetadataInput({ bitrate: 1000000 }));
      expect(result.bitrate).toBe(1000000);
    });

    test("rejects zero or negative bitrate", () => {
      expect(VideoMetadata.safeParse(validVideoMetadataInput({ bitrate: 0 })).success).toBe(false);
      expect(VideoMetadata.safeParse(validVideoMetadataInput({ bitrate: -1 })).success).toBe(false);
    });

    test("rejects non-integer bitrate", () => {
      expect(VideoMetadata.safeParse(validVideoMetadataInput({ bitrate: 1000000.5 })).success).toBe(false);
    });

    test("accepts date-like inputs for createdAt/updatedAt", () => {
      const input = validVideoMetadataInput({
        createdAt: validDate.getTime(),
        updatedAt: validDate2.getTime(),
      });
      const result = VideoMetadata.parse(input);
      expect(result.createdAt).toBeInstanceOf(Date);
      expect(result.updatedAt).toBeInstanceOf(Date);
    });

    test("accepts date-like input for dateTaken", () => {
      const input = validVideoMetadataInput({
        dateTaken: dateTaken.getTime(),
      });
      const result = VideoMetadata.parse(input);
      expect(result.dateTaken).toBeInstanceOf(Date);
    });

    test("accepts string date for dateTaken", () => {
      const input = validVideoMetadataInput({
        dateTaken: "2023-12-25T10:30:00.000Z",
      });
      const result = VideoMetadata.parse(input);
      expect(result.dateTaken).toBeInstanceOf(Date);
      expect(result.dateTaken?.toISOString()).toBe("2023-12-25T10:30:00.000Z");
    });
  });

  describe("VideoMetadataRecord", () => {
    test("parses input with SQL types for dates", () => {
      const input = {
        mediaFileId: 100,
        width: 1920,
        height: 1080,
        duration: 120.5,
        frameRate: 29.97,
        codec: "h264",
        audioCodec: "aac",
        bitrate: 5000000,
        dateTaken: dateTaken.getTime(),
        createdAt: validDate.getTime(),
        updatedAt: validDate2.getTime(),
      };
      const result = VideoMetadataRecord.parse(input);
      expect(result.mediaFileId).toBe(100);
      expect(result.width).toBe(1920);
      expect(result.height).toBe(1080);
      expect(result.duration).toBe(120.5);
      expect(result.frameRate).toBe(29.97);
      expect(result.codec).toBe("h264");
      expect(result.audioCodec).toBe("aac");
      expect(result.bitrate).toBe(5000000);
      expect(result.dateTaken).toBe(dateTaken.getTime());
      expect(result.createdAt).toBe(validDate.getTime());
      expect(result.updatedAt).toBe(validDate2.getTime());
    });

    test("preprocesses Date to timestamp for dates", () => {
      const input = {
        mediaFileId: 100,
        width: 1920,
        height: 1080,
        duration: 60,
        frameRate: null,
        codec: null,
        audioCodec: null,
        bitrate: null,
        dateTaken: dateTaken,
        createdAt: validDate,
        updatedAt: validDate2,
      };
      const result = VideoMetadataRecord.parse(input);
      expect(result.dateTaken).toBe(dateTaken.getTime());
      expect(result.createdAt).toBe(validDate.getTime());
      expect(result.updatedAt).toBe(validDate2.getTime());
    });

    test("accepts null for dateTaken", () => {
      const input = {
        mediaFileId: 100,
        width: 1920,
        height: 1080,
        duration: 60,
        frameRate: null,
        codec: null,
        audioCodec: null,
        bitrate: null,
        dateTaken: null,
        createdAt: validDate.getTime(),
        updatedAt: validDate2.getTime(),
      };
      const result = VideoMetadataRecord.parse(input);
      expect(result.dateTaken).toBe(null);
    });

    test("parsed result omits id (schema has no id field)", () => {
      const input = {
        id: 1,
        mediaFileId: 100,
        width: 1920,
        height: 1080,
        duration: 60,
        frameRate: null,
        codec: null,
        audioCodec: null,
        bitrate: null,
        dateTaken: null,
        createdAt: 0,
        updatedAt: 0,
      };
      const result = VideoMetadataRecord.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) expect("id" in result.data).toBe(false);
    });

    test("applies defaults for nullable fields", () => {
      const input = {
        mediaFileId: 100,
        width: 1920,
        height: 1080,
        duration: 60,
        createdAt: 0,
        updatedAt: 0,
      };
      const result = VideoMetadataRecord.parse(input);
      expect(result.frameRate).toBe(null);
      expect(result.codec).toBe(null);
      expect(result.audioCodec).toBe(null);
      expect(result.bitrate).toBe(null);
      expect(result.dateTaken).toBe(null);
    });
  });

  describe("NewVideoMetadata", () => {
    test("parses input without id, createdAt, updatedAt", () => {
      const input = {
        mediaFileId: 100,
        width: 1920,
        height: 1080,
        duration: 120.5,
        frameRate: 29.97,
        codec: "h264",
        audioCodec: "aac",
        bitrate: 5000000,
        dateTaken: dateTaken,
      };
      const result = NewVideoMetadata.parse(input);
      expect(result.mediaFileId).toBe(100);
      expect(result.width).toBe(1920);
      expect(result.height).toBe(1080);
      expect(result.duration).toBe(120.5);
      expect(result.frameRate).toBe(29.97);
      expect(result.codec).toBe("h264");
      expect(result.audioCodec).toBe("aac");
      expect(result.bitrate).toBe(5000000);
      expect(result.dateTaken).toEqual(dateTaken);
      expect("id" in result).toBe(false);
      expect("createdAt" in result).toBe(false);
      expect("updatedAt" in result).toBe(false);
    });

    test("applies defaults for nullable fields", () => {
      const input = {
        mediaFileId: 100,
        width: 1920,
        height: 1080,
        duration: 60,
      };
      const result = NewVideoMetadata.parse(input);
      expect(result.frameRate).toBe(null);
      expect(result.codec).toBe(null);
      expect(result.audioCodec).toBe(null);
      expect(result.bitrate).toBe(null);
      expect(result.dateTaken).toBe(null);
    });

    test("requires mediaFileId", () => {
      const input = {
        width: 1920,
        height: 1080,
        duration: 60,
      };
      expect(NewVideoMetadata.safeParse(input).success).toBe(false);
    });

    test("requires width", () => {
      const input = {
        mediaFileId: 100,
        height: 1080,
        duration: 60,
      };
      expect(NewVideoMetadata.safeParse(input).success).toBe(false);
    });

    test("requires height", () => {
      const input = {
        mediaFileId: 100,
        width: 1920,
        duration: 60,
      };
      expect(NewVideoMetadata.safeParse(input).success).toBe(false);
    });

    test("requires duration", () => {
      const input = {
        mediaFileId: 100,
        width: 1920,
        height: 1080,
      };
      expect(NewVideoMetadata.safeParse(input).success).toBe(false);
    });

    test("rejects invalid mediaFileId", () => {
      const input = {
        mediaFileId: 0,
        width: 1920,
        height: 1080,
        duration: 60,
      };
      expect(NewVideoMetadata.safeParse(input).success).toBe(false);
    });

    test("rejects invalid width", () => {
      const input = {
        mediaFileId: 100,
        width: -1,
        height: 1080,
        duration: 60,
      };
      expect(NewVideoMetadata.safeParse(input).success).toBe(false);
    });

    test("rejects invalid height", () => {
      const input = {
        mediaFileId: 100,
        width: 1920,
        height: 0,
        duration: 60,
      };
      expect(NewVideoMetadata.safeParse(input).success).toBe(false);
    });

    test("rejects invalid duration", () => {
      const input = {
        mediaFileId: 100,
        width: 1920,
        height: 1080,
        duration: -5,
      };
      expect(NewVideoMetadata.safeParse(input).success).toBe(false);
    });
  });

  describe("UpdateVideoMetadata", () => {
    test("requires id", () => {
      expect(UpdateVideoMetadata.safeParse({ mediaFileId: 100 }).success).toBe(false);
      const result = UpdateVideoMetadata.safeParse({ id: 1 });
      expect(result.success).toBe(true);
    });

    test("accepts partial update with id", () => {
      const result = UpdateVideoMetadata.parse({ id: 1, width: 3840 });
      expect(result.id).toBe(1);
      expect(result.width).toBe(3840);
    });

    test("accepts only id", () => {
      const result = UpdateVideoMetadata.parse({ id: 5 });
      expect(result.id).toBe(5);
    });

    test("accepts multiple optional fields", () => {
      const result = UpdateVideoMetadata.parse({
        id: 2,
        mediaFileId: 200,
        width: 3840,
        height: 2160,
        duration: 300,
        frameRate: 60,
        codec: "hevc",
        audioCodec: "opus",
        bitrate: 10000000,
        dateTaken: dateTaken,
      });
      expect(result.id).toBe(2);
      expect(result.mediaFileId).toBe(200);
      expect(result.width).toBe(3840);
      expect(result.height).toBe(2160);
      expect(result.duration).toBe(300);
      expect(result.frameRate).toBe(60);
      expect(result.codec).toBe("hevc");
      expect(result.audioCodec).toBe("opus");
      expect(result.bitrate).toBe(10000000);
      expect(result.dateTaken).toEqual(dateTaken);
    });

    test("rejects invalid id", () => {
      expect(UpdateVideoMetadata.safeParse({ id: 0 }).success).toBe(false);
      expect(UpdateVideoMetadata.safeParse({ id: -1 }).success).toBe(false);
    });

    test("rejects non-integer id", () => {
      expect(UpdateVideoMetadata.safeParse({ id: 1.5 }).success).toBe(false);
    });

    test("rejects invalid width when provided", () => {
      expect(UpdateVideoMetadata.safeParse({ id: 1, width: 0 }).success).toBe(false);
      expect(UpdateVideoMetadata.safeParse({ id: 1, width: -1 }).success).toBe(false);
    });

    test("rejects invalid height when provided", () => {
      expect(UpdateVideoMetadata.safeParse({ id: 1, height: 0 }).success).toBe(false);
      expect(UpdateVideoMetadata.safeParse({ id: 1, height: -1 }).success).toBe(false);
    });

    test("rejects invalid duration when provided", () => {
      expect(UpdateVideoMetadata.safeParse({ id: 1, duration: -1 }).success).toBe(false);
    });

    test("rejects invalid frameRate when provided", () => {
      expect(UpdateVideoMetadata.safeParse({ id: 1, frameRate: 0 }).success).toBe(false);
      expect(UpdateVideoMetadata.safeParse({ id: 1, frameRate: -1 }).success).toBe(false);
    });

    test("rejects invalid bitrate when provided", () => {
      expect(UpdateVideoMetadata.safeParse({ id: 1, bitrate: 0 }).success).toBe(false);
      expect(UpdateVideoMetadata.safeParse({ id: 1, bitrate: -1 }).success).toBe(false);
    });

    test("accepts null for nullable fields", () => {
      const result = UpdateVideoMetadata.parse({
        id: 1,
        frameRate: null,
        codec: null,
        audioCodec: null,
        bitrate: null,
        dateTaken: null,
      });
      expect(result.frameRate).toBe(null);
      expect(result.codec).toBe(null);
      expect(result.audioCodec).toBe(null);
      expect(result.bitrate).toBe(null);
      expect(result.dateTaken).toBe(null);
    });
  });
});
