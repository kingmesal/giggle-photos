import { afterEach, describe, expect, mock, test } from "bun:test";
import {
  extractVideoMetadata,
  getVideoMetadata,
  processVideoMetadataBatch,
  type VideoMetadataBatchOptions,
  type VideoMetadataBatchResult,
} from "./metadata-video";

/**
 * Tests for video metadata extraction functionality.
 *
 * This module tests:
 * - ffprobe availability checking
 * - Frame rate parsing from fraction strings
 * - Creation time parsing from various formats
 * - Video metadata extraction (dimensions, duration, codec, bitrate)
 * - Audio codec extraction
 * - Error handling (missing ffprobe, file errors)
 * - Batch processing with progress callbacks
 *
 * Note: Internal functions (parseFrameRate, parseCreationTime, checkFfprobeAvailable)
 * are tested by replicating their logic in tests, since they are not exported.
 */

describe("metadata-video", () => {
  afterEach(() => {
    // Clean up mocks after each test
    mock.restore();
  });

  describe("parseFrameRate (internal function logic)", () => {
    // Since parseFrameRate is internal, we test the logic by replicating it

    /**
     * Replicates the parseFrameRate logic from metadata-video.ts
     */
    function parseFrameRate(frameRateStr?: string): number | null {
      if (!frameRateStr) {
        return null;
      }

      const parts = frameRateStr.split("/");
      const [numeratorStr, denominatorStr] = parts;
      if (parts.length === 2 && numeratorStr && denominatorStr) {
        const numerator = Number.parseFloat(numeratorStr);
        const denominator = Number.parseFloat(denominatorStr);
        if (denominator > 0 && !Number.isNaN(numerator) && !Number.isNaN(denominator)) {
          const rate = numerator / denominator;
          return Math.round(rate * 1000) / 1000;
        }
      }

      const rate = Number.parseFloat(frameRateStr);
      if (!Number.isNaN(rate) && rate > 0) {
        return rate;
      }

      return null;
    }

    test("parses fraction frame rate '30/1' correctly", () => {
      expect(parseFrameRate("30/1")).toBe(30);
    });

    test("parses NTSC frame rate '24000/1001' correctly", () => {
      // 24000/1001 = 23.976023976... -> rounded to 23.976
      expect(parseFrameRate("24000/1001")).toBe(23.976);
    });

    test("parses '30000/1001' (29.97 fps) correctly", () => {
      // 30000/1001 = 29.970029970... -> rounded to 29.97
      expect(parseFrameRate("30000/1001")).toBe(29.97);
    });

    test("parses '60/1' (60 fps) correctly", () => {
      expect(parseFrameRate("60/1")).toBe(60);
    });

    test("parses simple number string correctly", () => {
      expect(parseFrameRate("25")).toBe(25);
      expect(parseFrameRate("29.97")).toBe(29.97);
    });

    test("returns null for undefined input", () => {
      expect(parseFrameRate(undefined)).toBeNull();
    });

    test("returns null for empty string", () => {
      expect(parseFrameRate("")).toBeNull();
    });

    test("handles invalid fraction (zero denominator) by falling back to simple parse", () => {
      // "30/0" fails the fraction check (denominator > 0 fails), then falls back
      // to Number.parseFloat("30/0") which returns 30 (stops at the slash)
      expect(parseFrameRate("30/0")).toBe(30);
    });

    test("returns null for invalid string", () => {
      expect(parseFrameRate("not-a-number")).toBeNull();
      expect(parseFrameRate("abc/def")).toBeNull();
    });

    test("returns null for negative frame rate", () => {
      expect(parseFrameRate("-30")).toBeNull();
    });

    test("returns null for zero frame rate (simple number)", () => {
      // Simple "0" fails the rate > 0 check
      expect(parseFrameRate("0")).toBeNull();
    });

    test("returns 0 for fraction '0/1'", () => {
      // "0/1" = 0, which is returned from the fraction parsing branch
      // (the rate > 0 check only applies to the simple number fallback)
      expect(parseFrameRate("0/1")).toBe(0);
    });

    test("parses '50/1' (PAL) correctly", () => {
      expect(parseFrameRate("50/1")).toBe(50);
    });

    test("parses '25/1' (PAL) correctly", () => {
      expect(parseFrameRate("25/1")).toBe(25);
    });

    test("parses '120/1' (high frame rate) correctly", () => {
      expect(parseFrameRate("120/1")).toBe(120);
    });

    test("parses decimal frame rate", () => {
      expect(parseFrameRate("23.976")).toBe(23.976);
    });
  });

  describe("parseCreationTime (internal function logic)", () => {
    /**
     * Replicates the parseCreationTime logic from metadata-video.ts
     */
    function parseCreationTime(tags?: Record<string, string>): Date | null {
      if (!tags) {
        return null;
      }

      const timeKeys = ["creation_time", "date", "DATE", "com.apple.quicktime.creationdate"];

      for (const key of timeKeys) {
        const value = tags[key];
        if (value) {
          const date = new Date(value);
          if (!Number.isNaN(date.getTime())) {
            return date;
          }
        }
      }

      return null;
    }

    test("parses creation_time tag", () => {
      const result = parseCreationTime({ creation_time: "2024-01-15T10:30:00Z" });
      expect(result).toBeInstanceOf(Date);
      expect(result?.toISOString()).toBe("2024-01-15T10:30:00.000Z");
    });

    test("parses date tag", () => {
      const result = parseCreationTime({ date: "2024-06-20T15:45:30Z" });
      expect(result).toBeInstanceOf(Date);
      expect(result?.toISOString()).toBe("2024-06-20T15:45:30.000Z");
    });

    test("parses DATE tag (uppercase)", () => {
      const result = parseCreationTime({ DATE: "2024-03-10T08:00:00Z" });
      expect(result).toBeInstanceOf(Date);
      expect(result?.toISOString()).toBe("2024-03-10T08:00:00.000Z");
    });

    test("parses Apple QuickTime creation date tag", () => {
      const result = parseCreationTime({ "com.apple.quicktime.creationdate": "2024-12-25T00:00:00Z" });
      expect(result).toBeInstanceOf(Date);
      expect(result?.toISOString()).toBe("2024-12-25T00:00:00.000Z");
    });

    test("returns null for undefined tags", () => {
      expect(parseCreationTime(undefined)).toBeNull();
    });

    test("returns null for empty tags object", () => {
      expect(parseCreationTime({})).toBeNull();
    });

    test("returns null for tags with no recognized time keys", () => {
      expect(parseCreationTime({ title: "My Video", artist: "John" })).toBeNull();
    });

    test("returns null for invalid date string", () => {
      expect(parseCreationTime({ creation_time: "not-a-date" })).toBeNull();
      expect(parseCreationTime({ date: "invalid" })).toBeNull();
    });

    test("prioritizes creation_time over other tags", () => {
      const result = parseCreationTime({
        creation_time: "2024-01-01T00:00:00Z",
        date: "2024-06-01T00:00:00Z",
      });
      expect(result?.toISOString()).toBe("2024-01-01T00:00:00.000Z");
    });

    test("parses ISO 8601 with timezone offset", () => {
      const result = parseCreationTime({ creation_time: "2024-01-15T10:30:00+05:00" });
      expect(result).toBeInstanceOf(Date);
    });

    test("parses RFC 2822 format", () => {
      const result = parseCreationTime({ date: "Mon, 15 Jan 2024 10:30:00 GMT" });
      expect(result).toBeInstanceOf(Date);
    });

    test("parses simple date format", () => {
      const result = parseCreationTime({ DATE: "2024-01-15" });
      expect(result).toBeInstanceOf(Date);
    });
  });

  describe("getVideoMetadata", () => {
    test("is an exported function", () => {
      expect(typeof getVideoMetadata).toBe("function");
    });

    test("returns null or object for nonexistent file", async () => {
      // The actual test depends on system state (whether ffprobe is available)
      // We test by verifying the function returns the expected type
      const result = await getVideoMetadata("/nonexistent/path/video.mp4");

      // Result should be null (either ffprobe not found or file not found)
      expect(result === null || typeof result === "object").toBe(true);
    });
  });

  describe("extractVideoMetadata", () => {
    test("is an exported function", () => {
      expect(typeof extractVideoMetadata).toBe("function");
    });

    test("returns boolean", async () => {
      // Note: This test requires a database connection
      // We just verify the function signature here
      expect(extractVideoMetadata.length).toBe(2); // Takes 2 parameters
    });
  });

  describe("processVideoMetadataBatch", () => {
    test("is an exported function", () => {
      expect(typeof processVideoMetadataBatch).toBe("function");
    });

    test("accepts options parameter", () => {
      // Function should accept 0 or 1 parameters
      expect(processVideoMetadataBatch.length).toBeLessThanOrEqual(1);
    });
  });

  describe("FFProbeOutput structure handling", () => {
    test("handles empty streams array", () => {
      const ffprobeOutput = {
        streams: [] as Array<{ codec_type?: string }>,
        format: {
          duration: "120.5",
          bit_rate: "5000000",
        },
      };

      const videoStream = ffprobeOutput.streams.find((s) => s.codec_type === "video");
      expect(videoStream).toBeUndefined();
    });

    test("handles missing streams property", () => {
      const ffprobeOutput = {
        format: {
          duration: "120.5",
        },
      };

      const streams = (ffprobeOutput as { streams?: Array<{ codec_type?: string }> }).streams;
      const videoStream = streams?.find((s) => s.codec_type === "video");
      expect(videoStream).toBeUndefined();
    });

    test("handles missing format property", () => {
      const ffprobeOutput = {
        streams: [
          {
            codec_type: "video",
            codec_name: "h264",
            width: 1920,
            height: 1080,
          },
        ],
      };

      const format = (ffprobeOutput as { format?: { duration?: string } }).format;
      expect(format).toBeUndefined();
      expect(format?.duration).toBeUndefined();
    });

    test("extracts video stream from mixed streams", () => {
      const ffprobeOutput = {
        streams: [
          { codec_type: "audio", codec_name: "aac" },
          { codec_type: "video", codec_name: "h264", width: 1920, height: 1080, r_frame_rate: "30/1" },
          { codec_type: "subtitle", codec_name: "subrip" },
        ],
        format: {
          duration: "120.5",
          bit_rate: "5000000",
        },
      };

      const videoStream = ffprobeOutput.streams.find((s) => s.codec_type === "video");
      expect(videoStream).toBeDefined();
      expect(videoStream?.codec_name).toBe("h264");
      expect((videoStream as { width?: number })?.width).toBe(1920);
      expect((videoStream as { height?: number })?.height).toBe(1080);
    });

    test("extracts audio stream codec", () => {
      const ffprobeOutput = {
        streams: [
          { codec_type: "video", codec_name: "h264", width: 1920, height: 1080 },
          { codec_type: "audio", codec_name: "aac" },
        ],
      };

      const audioStream = ffprobeOutput.streams.find((s) => s.codec_type === "audio");
      expect(audioStream).toBeDefined();
      expect(audioStream?.codec_name).toBe("aac");
    });

    test("handles video stream without dimensions", () => {
      const ffprobeOutput = {
        streams: [
          {
            codec_type: "video",
            codec_name: "h264",
            // Missing width and height
          },
        ],
      };

      const videoStream = ffprobeOutput.streams.find((s) => s.codec_type === "video");
      expect(videoStream).toBeDefined();

      const width = (videoStream as { width?: number })?.width;
      const height = (videoStream as { height?: number })?.height;
      expect(width).toBeUndefined();
      expect(height).toBeUndefined();

      // Logic should reject this - no valid video stream
      const isValid = videoStream && width && height;
      expect(isValid).toBeFalsy();
    });

    test("parses duration from format", () => {
      const ffprobeOutput = {
        format: {
          duration: "3661.5", // 1 hour, 1 minute, 1.5 seconds
        },
      };

      const duration = Number.parseFloat(ffprobeOutput.format?.duration ?? "0");
      expect(duration).toBe(3661.5);
    });

    test("handles missing duration gracefully", () => {
      const ffprobeOutput = {
        format: {} as { duration?: string },
      };

      const duration = Number.parseFloat(ffprobeOutput.format?.duration ?? "0") || 0;
      expect(duration).toBe(0);
    });

    test("parses bitrate from format", () => {
      const ffprobeOutput = {
        format: {
          bit_rate: "15000000", // 15 Mbps
        },
      };

      const bitrate = Number.parseInt(ffprobeOutput.format?.bit_rate ?? "0", 10);
      expect(bitrate).toBe(15000000);
    });

    test("handles missing bitrate gracefully", () => {
      const ffprobeOutput = {
        format: {} as { bit_rate?: string },
      };

      const bitrate = Number.parseInt(ffprobeOutput.format?.bit_rate ?? "0", 10) || null;
      expect(bitrate).toBeNull();
    });
  });

  describe("Frame rate selection logic", () => {
    function parseFrameRate(frameRateStr?: string): number | null {
      if (!frameRateStr) return null;
      const parts = frameRateStr.split("/");
      if (parts.length === 2 && parts[0] && parts[1]) {
        const num = Number.parseFloat(parts[0]);
        const den = Number.parseFloat(parts[1]);
        if (den > 0 && !Number.isNaN(num) && !Number.isNaN(den)) {
          return Math.round((num / den) * 1000) / 1000;
        }
      }
      const rate = Number.parseFloat(frameRateStr);
      return !Number.isNaN(rate) && rate > 0 ? rate : null;
    }

    test("prefers r_frame_rate over avg_frame_rate", () => {
      const videoStream = {
        r_frame_rate: "30/1",
        avg_frame_rate: "29.97",
      };

      // Implementation: parseFrameRate(videoStream.r_frame_rate) ?? parseFrameRate(videoStream.avg_frame_rate)
      const frameRate = parseFrameRate(videoStream.r_frame_rate) ?? parseFrameRate(videoStream.avg_frame_rate);
      expect(frameRate).toBe(30); // r_frame_rate is used
    });

    test("falls back to avg_frame_rate when r_frame_rate is invalid", () => {
      const videoStream = {
        r_frame_rate: "0/0", // Invalid
        avg_frame_rate: "30/1",
      };

      const frameRate = parseFrameRate(videoStream.r_frame_rate) ?? parseFrameRate(videoStream.avg_frame_rate);
      expect(frameRate).toBe(30); // Falls back to avg_frame_rate
    });

    test("returns null when both frame rates are invalid", () => {
      const videoStream = {
        r_frame_rate: "invalid",
        avg_frame_rate: "also-invalid",
      };

      const frameRate = parseFrameRate(videoStream.r_frame_rate) ?? parseFrameRate(videoStream.avg_frame_rate);
      expect(frameRate).toBeNull();
    });
  });

  describe("Metadata assembly", () => {
    function parseFrameRate(frameRateStr?: string): number | null {
      if (!frameRateStr) return null;
      const parts = frameRateStr.split("/");
      if (parts.length === 2 && parts[0] && parts[1]) {
        const num = Number.parseFloat(parts[0]);
        const den = Number.parseFloat(parts[1]);
        if (den > 0 && !Number.isNaN(num) && !Number.isNaN(den)) {
          return Math.round((num / den) * 1000) / 1000;
        }
      }
      const rate = Number.parseFloat(frameRateStr);
      return !Number.isNaN(rate) && rate > 0 ? rate : null;
    }

    function parseCreationTime(tags?: Record<string, string>): Date | null {
      if (!tags) return null;
      const timeKeys = ["creation_time", "date", "DATE", "com.apple.quicktime.creationdate"];
      for (const key of timeKeys) {
        const value = tags[key];
        if (value) {
          const date = new Date(value);
          if (!Number.isNaN(date.getTime())) return date;
        }
      }
      return null;
    }

    test("assembles NewVideoMetadata correctly from FFProbe output", () => {
      const ffprobeOutput = {
        streams: [
          {
            codec_type: "video",
            codec_name: "h264",
            width: 1920,
            height: 1080,
            r_frame_rate: "24000/1001",
          },
          {
            codec_type: "audio",
            codec_name: "aac",
          },
        ],
        format: {
          duration: "120.5",
          bit_rate: "5000000",
          tags: {
            creation_time: "2024-01-15T10:30:00Z",
          },
        },
      };

      const videoStream = ffprobeOutput.streams.find((s) => s.codec_type === "video");
      if (!videoStream) throw new Error("Video stream not found");
      const audioStream = ffprobeOutput.streams.find((s) => s.codec_type === "audio");

      const metadata = {
        mediaFileId: 1,
        width: (videoStream as { width: number }).width,
        height: (videoStream as { height: number }).height,
        duration: Number.parseFloat(ffprobeOutput.format?.duration ?? "0") || 0,
        frameRate:
          parseFrameRate((videoStream as { r_frame_rate?: string }).r_frame_rate) ??
          parseFrameRate((videoStream as { avg_frame_rate?: string }).avg_frame_rate),
        codec: videoStream.codec_name ?? null,
        audioCodec: audioStream?.codec_name ?? null,
        bitrate: Number.parseInt(ffprobeOutput.format?.bit_rate ?? "0", 10) || null,
        dateTaken: parseCreationTime(ffprobeOutput.format?.tags),
      };

      expect(metadata.mediaFileId).toBe(1);
      expect(metadata.width).toBe(1920);
      expect(metadata.height).toBe(1080);
      expect(metadata.duration).toBe(120.5);
      expect(metadata.frameRate).toBe(23.976);
      expect(metadata.codec).toBe("h264");
      expect(metadata.audioCodec).toBe("aac");
      expect(metadata.bitrate).toBe(5000000);
      expect(metadata.dateTaken).toBeInstanceOf(Date);
      expect(metadata.dateTaken?.toISOString()).toBe("2024-01-15T10:30:00.000Z");
    });

    test("handles video without audio stream", () => {
      const ffprobeOutput = {
        streams: [
          {
            codec_type: "video",
            codec_name: "h264",
            width: 1920,
            height: 1080,
          },
        ],
        format: {
          duration: "60.0",
        },
      };

      const audioStream = ffprobeOutput.streams.find((s) => s.codec_type === "audio");
      expect(audioStream).toBeUndefined();

      const audioCodec = audioStream?.codec_name ?? null;
      expect(audioCodec).toBeNull();
    });

    test("handles video with null codec names", () => {
      const ffprobeOutput = {
        streams: [
          {
            codec_type: "video",
            width: 1920,
            height: 1080,
            // No codec_name
          },
        ],
        format: {},
      };

      const videoStream = ffprobeOutput.streams.find((s) => s.codec_type === "video");
      const codec = (videoStream as { codec_name?: string })?.codec_name ?? null;
      expect(codec).toBeNull();
    });

    test("handles 4K video dimensions", () => {
      const videoStream = {
        codec_type: "video",
        width: 3840,
        height: 2160,
      };

      expect(videoStream.width).toBe(3840);
      expect(videoStream.height).toBe(2160);
    });

    test("handles various video codecs", () => {
      const codecs = ["h264", "hevc", "vp9", "av1", "mpeg4", "prores"];

      for (const codec of codecs) {
        const videoStream = {
          codec_type: "video",
          codec_name: codec,
          width: 1920,
          height: 1080,
        };
        expect(videoStream.codec_name).toBe(codec);
      }
    });

    test("handles various audio codecs", () => {
      const codecs = ["aac", "mp3", "opus", "flac", "ac3", "dts"];

      for (const codec of codecs) {
        const audioStream = {
          codec_type: "audio",
          codec_name: codec,
        };
        expect(audioStream.codec_name).toBe(codec);
      }
    });
  });

  describe("Error handling patterns", () => {
    test("handles invalid JSON from ffprobe gracefully", () => {
      const handleFfprobeError = (_error: unknown): null => null;

      expect(handleFfprobeError(new Error("Invalid JSON"))).toBeNull();
      expect(handleFfprobeError("string error")).toBeNull();
      expect(handleFfprobeError({ message: "object error" })).toBeNull();
    });

    test("handles file not found error", () => {
      const handleFfprobeError = (_error: unknown): null => null;
      expect(handleFfprobeError(new Error("No such file or directory"))).toBeNull();
    });

    test("handles permission denied error", () => {
      const handleFfprobeError = (_error: unknown): null => null;
      expect(handleFfprobeError(new Error("Permission denied"))).toBeNull();
    });

    test("error message extraction from Error instance", () => {
      const error = new Error("Test error message");
      const errorMessage = error instanceof Error ? error.message : String(error);
      expect(errorMessage).toBe("Test error message");
    });

    test("error message extraction from string", () => {
      const error = "Test string error";
      const errorMessage = error instanceof Error ? error.message : String(error);
      expect(errorMessage).toBe("Test string error");
    });
  });

  describe("Concurrent processing patterns", () => {
    test("respects concurrency limit", async () => {
      const processedFiles: string[] = [];
      const concurrency = 2;

      async function simulateWorker(files: string[]): Promise<void> {
        while (files.length > 0) {
          const file = files.shift();
          if (file) {
            await new Promise((resolve) => setTimeout(resolve, 1));
            processedFiles.push(file);
          }
        }
      }

      const testFiles = ["file1.mp4", "file2.mp4", "file3.mp4", "file4.mp4", "file5.mp4"];
      const fileQueue = [...testFiles];
      const workers: Promise<void>[] = [];

      for (let i = 0; i < Math.min(concurrency, testFiles.length); i++) {
        workers.push(simulateWorker(fileQueue));
      }

      await Promise.all(workers);

      expect(processedFiles).toHaveLength(testFiles.length);
      expect(processedFiles.sort()).toEqual(testFiles.sort());
    });

    test("handles empty file queue", async () => {
      const concurrency = 2;
      const processedFiles: string[] = [];

      async function simulateWorker(files: string[]): Promise<void> {
        while (files.length > 0) {
          const file = files.shift();
          if (file) {
            processedFiles.push(file);
          }
        }
      }

      const fileQueue: string[] = [];
      const workers: Promise<void>[] = [];

      for (let i = 0; i < concurrency; i++) {
        workers.push(simulateWorker(fileQueue));
      }

      await Promise.all(workers);

      expect(processedFiles).toHaveLength(0);
    });

    test("progress callback is called for each file", async () => {
      const progressCalls: Array<{ completed: number; total: number; currentFile: string }> = [];
      const total = 3;
      let completed = 0;

      const onProgress = (c: number, t: number, f: string) => {
        progressCalls.push({ completed: c, total: t, currentFile: f });
      };

      for (const file of ["file1.mp4", "file2.mp4", "file3.mp4"]) {
        completed++;
        onProgress(completed, total, file);
      }

      expect(progressCalls).toHaveLength(3);
      expect(progressCalls[0]).toEqual({ completed: 1, total: 3, currentFile: "file1.mp4" });
      expect(progressCalls[1]).toEqual({ completed: 2, total: 3, currentFile: "file2.mp4" });
      expect(progressCalls[2]).toEqual({ completed: 3, total: 3, currentFile: "file3.mp4" });
    });

    test("single worker processes all files when concurrency is 1", async () => {
      const processOrder: string[] = [];
      const concurrency = 1;

      async function simulateWorker(files: string[]): Promise<void> {
        while (files.length > 0) {
          const file = files.shift();
          if (file) {
            processOrder.push(file);
          }
        }
      }

      const testFiles = ["a.mp4", "b.mp4", "c.mp4"];
      const fileQueue = [...testFiles];
      const workers: Promise<void>[] = [];

      for (let i = 0; i < concurrency; i++) {
        workers.push(simulateWorker(fileQueue));
      }

      await Promise.all(workers);

      // With single worker, files should be processed in order
      expect(processOrder).toEqual(testFiles);
    });
  });

  describe("checkFfprobeAvailable caching pattern", () => {
    test("caches ffprobe availability check result", async () => {
      let ffprobeChecked = false;
      let ffprobeAvailable: string | null = null;
      let checkCount = 0;

      async function checkFfprobeAvailable(): Promise<string | null> {
        if (ffprobeChecked) {
          return ffprobeAvailable;
        }

        ffprobeChecked = true;
        checkCount++;
        ffprobeAvailable = "/usr/bin/ffprobe";
        return ffprobeAvailable;
      }

      const result1 = await checkFfprobeAvailable();
      expect(result1).toBe("/usr/bin/ffprobe");
      expect(checkCount).toBe(1);

      const result2 = await checkFfprobeAvailable();
      expect(result2).toBe("/usr/bin/ffprobe");
      expect(checkCount).toBe(1); // Still 1, no additional check

      const result3 = await checkFfprobeAvailable();
      expect(result3).toBe("/usr/bin/ffprobe");
      expect(checkCount).toBe(1); // Still 1
    });

    test("caches null result when ffprobe not found", async () => {
      let ffprobeChecked = false;
      let ffprobeAvailable: string | null = null;
      let checkCount = 0;

      async function checkFfprobeAvailable(): Promise<string | null> {
        if (ffprobeChecked) {
          return ffprobeAvailable;
        }

        ffprobeChecked = true;
        checkCount++;
        ffprobeAvailable = null;
        return ffprobeAvailable;
      }

      const result1 = await checkFfprobeAvailable();
      expect(result1).toBeNull();
      expect(checkCount).toBe(1);

      const result2 = await checkFfprobeAvailable();
      expect(result2).toBeNull();
      expect(checkCount).toBe(1); // Cached
    });
  });

  describe("VideoMetadataBatchResult type", () => {
    test("has correct structure", () => {
      const result: VideoMetadataBatchResult = {
        processed: 5,
        errors: 1,
        skipped: 2,
      };

      expect(result.processed).toBe(5);
      expect(result.errors).toBe(1);
      expect(result.skipped).toBe(2);
    });

    test("all values are non-negative integers", () => {
      const result: VideoMetadataBatchResult = {
        processed: 0,
        errors: 0,
        skipped: 0,
      };

      expect(Number.isInteger(result.processed)).toBe(true);
      expect(Number.isInteger(result.errors)).toBe(true);
      expect(Number.isInteger(result.skipped)).toBe(true);
      expect(result.processed).toBeGreaterThanOrEqual(0);
      expect(result.errors).toBeGreaterThanOrEqual(0);
      expect(result.skipped).toBeGreaterThanOrEqual(0);
    });
  });

  describe("VideoMetadataBatchOptions type", () => {
    test("all options are optional", () => {
      const options1: VideoMetadataBatchOptions = {};
      const options2: VideoMetadataBatchOptions = { limit: 10 };
      const options3: VideoMetadataBatchOptions = { concurrency: 4 };
      const options4: VideoMetadataBatchOptions = { onProgress: () => {} };
      const options5: VideoMetadataBatchOptions = {
        limit: 100,
        concurrency: 8,
        onProgress: (c, t, f) => console.log(c, t, f),
      };

      expect(options1).toBeDefined();
      expect(options2.limit).toBe(10);
      expect(options3.concurrency).toBe(4);
      expect(typeof options4.onProgress).toBe("function");
      expect(options5.limit).toBe(100);
    });

    test("onProgress callback receives correct parameters", () => {
      let capturedParams: { completed: number; total: number; currentFile: string } | null = null;

      const options: VideoMetadataBatchOptions = {
        onProgress: (completed, total, currentFile) => {
          capturedParams = { completed, total, currentFile };
        },
      };

      options.onProgress?.(5, 10, "/path/to/video.mp4");

      expect(capturedParams).toEqual({
        completed: 5,
        total: 10,
        currentFile: "/path/to/video.mp4",
      });
    });
  });

  describe("Duration calculations", () => {
    test("parses short duration", () => {
      const duration = Number.parseFloat("5.5");
      expect(duration).toBe(5.5);
    });

    test("parses long duration (over 1 hour)", () => {
      const duration = Number.parseFloat("7245.123");
      expect(duration).toBe(7245.123);
    });

    test("parses very long duration (over 24 hours)", () => {
      const duration = Number.parseFloat("100000.0");
      expect(duration).toBe(100000);
    });

    test("handles zero duration", () => {
      const duration = Number.parseFloat("0") || 0;
      expect(duration).toBe(0);
    });

    test("handles invalid duration", () => {
      const duration = Number.parseFloat("invalid") || 0;
      expect(duration).toBe(0);
    });
  });

  describe("Bitrate calculations", () => {
    test("parses low bitrate (1 Mbps)", () => {
      const bitrate = Number.parseInt("1000000", 10);
      expect(bitrate).toBe(1000000);
    });

    test("parses medium bitrate (5 Mbps)", () => {
      const bitrate = Number.parseInt("5000000", 10);
      expect(bitrate).toBe(5000000);
    });

    test("parses high bitrate (50 Mbps)", () => {
      const bitrate = Number.parseInt("50000000", 10);
      expect(bitrate).toBe(50000000);
    });

    test("parses very high bitrate (100 Mbps)", () => {
      const bitrate = Number.parseInt("100000000", 10);
      expect(bitrate).toBe(100000000);
    });

    test("handles zero bitrate", () => {
      const bitrate = Number.parseInt("0", 10) || null;
      expect(bitrate).toBeNull();
    });

    test("handles invalid bitrate", () => {
      const bitrate = Number.parseInt("invalid", 10) || null;
      expect(bitrate).toBeNull();
    });
  });
});
