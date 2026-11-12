import { beforeEach, describe, expect, mock, test } from "bun:test";

// Track module-level state for mocking
let mockSharpPhashFn: ((input: string | Uint8Array) => Promise<string>) | null = null;
let mockDistanceFn: ((hash1: string, hash2: string) => number) | null = null;

// Mock the sharp-loader module
mock.module("./sharp-loader", () => ({
  getSharpPhash: async () => mockSharpPhashFn,
}));

// Mock the sharp-phash/distance module
mock.module("sharp-phash/distance", () => ({
  default: (hash1: string, hash2: string) => {
    if (!mockDistanceFn) {
      throw new Error("Distance function not available");
    }
    return mockDistanceFn(hash1, hash2);
  },
}));

// Import after mocking
import { computePerceptualHash, hammingDistance } from "./hash-phash";

describe("hash-phash", () => {
  beforeEach(() => {
    // Reset mocks before each test
    mockSharpPhashFn = null;
    mockDistanceFn = null;
  });

  describe("computePerceptualHash", () => {
    test("throws when sharp-phash not available", async () => {
      mockSharpPhashFn = null;

      await expect(computePerceptualHash("/test/image.jpg")).rejects.toThrow("Sharp-phash module not available");
    });

    test("computes hash for valid image", async () => {
      const expectedHash = "1010101010101010101010101010101010101010101010101010101010101010";
      mockSharpPhashFn = async () => expectedHash;

      const result = await computePerceptualHash("/test/image.jpg");

      expect(result).toBe(expectedHash);
    });

    test("passes file path to sharp-phash function", async () => {
      let receivedInput: string | Uint8Array | null = null;
      mockSharpPhashFn = async (input: string | Uint8Array) => {
        receivedInput = input;
        return "0".repeat(64);
      };

      await computePerceptualHash("/photos/my-image.png");

      expect(receivedInput).toBe("/photos/my-image.png");
    });

    test("accepts Uint8Array input", async () => {
      let receivedInput: string | Uint8Array | null = null;
      const buffer = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
      mockSharpPhashFn = async (input: string | Uint8Array) => {
        receivedInput = input;
        return "0".repeat(64);
      };

      await computePerceptualHash(buffer);

      expect(receivedInput).toBe(buffer);
    });

    test("returns null when sharp-phash throws error", async () => {
      mockSharpPhashFn = async () => {
        throw new Error("Unsupported format");
      };

      const result = await computePerceptualHash("/test/unsupported.webp");

      expect(result).toBeNull();
    });

    test("returns null for corrupted files", async () => {
      mockSharpPhashFn = async () => {
        throw new Error("Input file is corrupt");
      };

      const result = await computePerceptualHash("/test/corrupted.jpg");

      expect(result).toBeNull();
    });

    test("handles empty file path gracefully", async () => {
      mockSharpPhashFn = async () => {
        throw new Error("ENOENT: no such file or directory");
      };

      const result = await computePerceptualHash("");

      expect(result).toBeNull();
    });

    test("handles file not found error", async () => {
      mockSharpPhashFn = async () => {
        throw new Error("ENOENT: no such file or directory, open '/nonexistent.jpg'");
      };

      const result = await computePerceptualHash("/nonexistent.jpg");

      expect(result).toBeNull();
    });
  });

  describe("hammingDistance", () => {
    test("returns 0 for identical hashes", async () => {
      mockDistanceFn = (hash1: string, hash2: string) => {
        let distance = 0;
        for (let i = 0; i < hash1.length; i++) {
          if (hash1[i] !== hash2[i]) distance++;
        }
        return distance;
      };

      const hash = "1010101010101010101010101010101010101010101010101010101010101010";

      const result = await hammingDistance(hash, hash);

      expect(result).toBe(0);
    });

    test("returns correct distance for completely different hashes", async () => {
      mockDistanceFn = (hash1: string, hash2: string) => {
        let distance = 0;
        for (let i = 0; i < hash1.length; i++) {
          if (hash1[i] !== hash2[i]) distance++;
        }
        return distance;
      };

      const hash1 = "0".repeat(64);
      const hash2 = "1".repeat(64);

      const result = await hammingDistance(hash1, hash2);

      expect(result).toBe(64); // Maximum distance
    });

    test("returns correct distance for partially different hashes", async () => {
      mockDistanceFn = (hash1: string, hash2: string) => {
        let distance = 0;
        for (let i = 0; i < hash1.length; i++) {
          if (hash1[i] !== hash2[i]) distance++;
        }
        return distance;
      };

      const hash1 = "1111000011110000111100001111000011110000111100001111000011110000";
      const hash2 = "1111000011110000111100001111000011110000111100001111000000001111";

      const result = await hammingDistance(hash1, hash2);

      expect(result).toBe(8); // 8 bits differ in the last 16 characters
    });

    test("returns calculated distance using the distance module", async () => {
      // When the distance module is available, it should use it
      mockDistanceFn = () => 15;

      const hash1 = "0".repeat(64);
      const hash2 = "1".repeat(64);

      const result = await hammingDistance(hash1, hash2);

      // The mock returns 15 regardless of input
      expect(result).toBe(15);
    });

    test("handles similar images (low distance)", async () => {
      mockDistanceFn = () => 3; // Mock similar images

      const hash1 = "1010101010101010101010101010101010101010101010101010101010101010";
      const hash2 = "1010101010101010101010101010101010101010101010101010101010101111";

      const result = await hammingDistance(hash1, hash2);

      expect(result).toBeLessThanOrEqual(5);
    });

    test("handles different images (high distance)", async () => {
      mockDistanceFn = () => 32; // Mock different images

      const hash1 = "0".repeat(64);
      const hash2 = "1".repeat(32) + "0".repeat(32);

      const result = await hammingDistance(hash1, hash2);

      expect(result).toBeGreaterThan(10);
    });
  });
});
