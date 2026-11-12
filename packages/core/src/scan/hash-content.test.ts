import { beforeEach, describe, expect, mock, test } from "bun:test";

// Mock module state
let mockSharpAvailable = true;
let mockSharpError: Error | null = null;
let mockSharpRawData = Buffer.from("test-pixel-data");

// Create mock sharp function that returns a chainable interface
const createMockSharp = () => {
  const mockInstance = {
    raw: () => mockInstance,
    toBuffer: async ({ resolveWithObject: _resolveWithObject }: { resolveWithObject: boolean }) => {
      if (mockSharpError) {
        throw mockSharpError;
      }
      return { data: mockSharpRawData };
    },
  };

  return mock((_input: string | Uint8Array) => mockInstance);
};

let mockSharpFn = createMockSharp();

// Mock the sharp-loader module
mock.module("./sharp-loader", () => ({
  getSharp: async () => {
    if (!mockSharpAvailable) {
      return null;
    }
    return mockSharpFn;
  },
}));

// Import after mocking
import { computeContentHash } from "./hash-content";

describe("computeContentHash", () => {
  beforeEach(() => {
    // Reset mock state
    mockSharpAvailable = true;
    mockSharpError = null;
    mockSharpRawData = Buffer.from("test-pixel-data");
    mockSharpFn = createMockSharp();
  });

  test("throws when sharp is not available", async () => {
    mockSharpAvailable = false;

    await expect(computeContentHash("/path/to/image.jpg")).rejects.toThrow("Sharp module not available");
  });

  test("computes SHA-256 hash for valid image file", async () => {
    mockSharpRawData = Buffer.from("consistent-pixel-data");

    const result = await computeContentHash("/path/to/image.jpg");

    expect(result).not.toBeNull();
    expect(result).toHaveLength(64); // SHA-256 hex string is 64 characters
    expect(result).toMatch(/^[a-f0-9]{64}$/); // Valid hex string
  });

  test("returns same hash for identical pixel data", async () => {
    const pixelData = Buffer.from("identical-pixel-data-for-hashing");
    mockSharpRawData = pixelData;

    const hash1 = await computeContentHash("/path/to/image1.jpg");

    // Reset mock to use same data for second call
    mockSharpFn = createMockSharp();
    mockSharpRawData = pixelData;

    const hash2 = await computeContentHash("/path/to/image2.jpg");

    expect(hash1).toBe(hash2);
  });

  test("returns different hash for different pixel data", async () => {
    mockSharpRawData = Buffer.from("pixel-data-1");
    const hash1 = await computeContentHash("/path/to/image1.jpg");

    mockSharpFn = createMockSharp();
    mockSharpRawData = Buffer.from("pixel-data-2");
    const hash2 = await computeContentHash("/path/to/image2.jpg");

    expect(hash1).not.toBe(hash2);
  });

  test("returns null for unsupported formats (sharp throws error)", async () => {
    mockSharpError = new Error("Input file is missing");

    const result = await computeContentHash("/path/to/unsupported.xyz");

    expect(result).toBeNull();
  });

  test("handles file read errors gracefully", async () => {
    mockSharpError = new Error("ENOENT: no such file or directory");

    const result = await computeContentHash("/nonexistent/path/image.jpg");

    expect(result).toBeNull();
  });

  test("handles corrupted image files gracefully", async () => {
    mockSharpError = new Error("Input file contains unsupported image format");

    const result = await computeContentHash("/path/to/corrupted.jpg");

    expect(result).toBeNull();
  });

  test("strips metadata before hashing by using raw pixel data", async () => {
    // The fact that we're using .raw() in the implementation
    // means metadata is stripped. We verify the mock's raw() is called.
    const rawCalled = { value: false };
    const mockInstanceWithTracking = {
      raw: () => {
        rawCalled.value = true;
        return mockInstanceWithTracking;
      },
      toBuffer: async () => ({ data: Buffer.from("data") }),
    };

    mockSharpFn = mock(() => mockInstanceWithTracking);

    await computeContentHash("/path/to/image.jpg");

    expect(rawCalled.value).toBe(true);
  });

  test("calls sharp with the provided file path", async () => {
    const testPath = "/test/specific/path/image.png";

    await computeContentHash(testPath);

    expect(mockSharpFn).toHaveBeenCalledWith(testPath);
  });

  test("accepts Uint8Array input", async () => {
    const buffer = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]); // fake JPEG header

    await computeContentHash(buffer);

    expect(mockSharpFn).toHaveBeenCalledWith(buffer);
  });
});
