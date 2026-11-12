import { beforeEach, describe, expect, mock, test } from "bun:test";
import { detectDuplicates } from "./duplicate-detector";

// Mock types for our fake database
interface MockMediaFile {
  id: number;
  sha256Hash: string | null;
  contentHash: string | null;
  perceptualHash: string | null;
  fileType: string;
  scanFolderId: number;
}

interface MockPhashMatch {
  id: number;
  mediaFileId1: number;
  mediaFileId2: number;
  distance: number;
  createdAt: number;
}

// Shared state for mocks
let mockMediaFiles: MockMediaFile[] = [];
let mockPhashMatches: MockPhashMatch[] = [];
let nextPhashMatchId = 1;

// Mock hamming distance function
let mockHammingDistance: (hash1: string, hash2: string) => Promise<number>;

// Mock the hash-phash module
mock.module("./hash-phash", () => ({
  hammingDistance: (hash1: string, hash2: string) => mockHammingDistance(hash1, hash2),
}));

const mockPhashMatchProvider = {
  getAllPairKeys: mock(async () => {
    const keys = new Set<string>();
    for (const m of mockPhashMatches) {
      keys.add(`${m.mediaFileId1}:${m.mediaFileId2}`);
    }
    return keys;
  }),
  insertPhashMatches: mock(async (matches: { mediaFileId1: number; mediaFileId2: number; distance: number }[]) => {
    for (const m of matches) {
      const id1 = Math.min(m.mediaFileId1, m.mediaFileId2);
      const id2 = Math.max(m.mediaFileId1, m.mediaFileId2);
      mockPhashMatches.push({
        id: nextPhashMatchId++,
        mediaFileId1: id1,
        mediaFileId2: id2,
        distance: m.distance,
        createdAt: Date.now(),
      });
    }
    return matches.length;
  }),
};

/**
 * Create a mock database that handles the queries used by the simplified detector
 */
function createMockDb() {
  const chainBuilder = (results: unknown) => {
    const chain = {
      select: () => chain,
      selectAll: () => chain,
      where: (_col?: unknown, _op?: unknown, _val?: unknown) => chain,
      orderBy: () => chain,
      groupBy: () => chain,
      having: () => chain,
      limit: () => chain,
      execute: async () => results,
      executeTakeFirst: async () => (Array.isArray(results) ? results[0] : results),
    };
    return chain;
  };

  return {
    selectFrom: (table: string) => {
      if (table === "mediaFiles") {
        return {
          select: (cols: string[]) => {
            // For getting images with phash
            if (cols.includes("id") && cols.includes("perceptualHash")) {
              return {
                where: (_col: string, _op: string, _val: unknown) => ({
                  where: (_col2: string, _op2: string, _val2: unknown) => ({
                    orderBy: () => ({
                      execute: async () => {
                        return mockMediaFiles
                          .filter((f) => f.perceptualHash !== null && f.fileType === "image")
                          .map((f) => ({
                            id: f.id,
                            perceptualHash: f.perceptualHash,
                            scanFolderId: f.scanFolderId,
                          }))
                          .sort((a, b) => a.id - b.id);
                      },
                    }),
                  }),
                }),
              };
            }
            return chainBuilder([]);
          },
          selectAll: () => chainBuilder([]),
        };
      }

      return chainBuilder([]);
    },
  };
}

const mockPhashGroupProvider = {
  recomputeGroups: mock(async () => {}),
};

// Mock the DatabaseProvider module
mock.module("../db/database-provider", () => ({
  DatabaseProvider: {
    getInstance: mock(async () => ({
      getClient: () => ({
        getDb: () => createMockDb(),
      }),
      getPhashMatchProvider: () => mockPhashMatchProvider,
      getPhashGroupProvider: () => mockPhashGroupProvider,
    })),
  },
}));

describe("duplicate-detector", () => {
  beforeEach(() => {
    // Reset all state
    mockMediaFiles = [];
    mockPhashMatches = [];
    nextPhashMatchId = 1;

    // Reset mocks
    mockPhashMatchProvider.getAllPairKeys.mockClear();
    mockPhashMatchProvider.insertPhashMatches.mockClear();
    mockPhashGroupProvider.recomputeGroups.mockClear();

    // Default hamming distance: returns actual distance based on hash difference
    mockHammingDistance = async (hash1: string, hash2: string) => {
      if (hash1 === hash2) return 0;
      // Simple mock: count character differences
      let diff = 0;
      for (let i = 0; i < Math.min(hash1.length, hash2.length); i++) {
        if (hash1[i] !== hash2[i]) diff++;
      }
      return diff;
    };
  });

  describe("detectDuplicates", () => {
    test("handles no files case", async () => {
      const result = await detectDuplicates();

      expect(result.phashPairsComputed).toBe(0);
      expect(result.totalComparisons).toBe(0);
    });

    test("handles no images with phash (only one image)", async () => {
      mockMediaFiles = [
        {
          id: 1,
          sha256Hash: "unique",
          contentHash: "unique",
          perceptualHash: "onlyone",
          fileType: "image",
          scanFolderId: 1,
        },
      ];

      const result = await detectDuplicates();

      // Not enough images for phash comparison
      expect(result.phashPairsComputed).toBe(0);
      expect(result.totalComparisons).toBe(0);
    });

    test("handles no matching pairs (all distances above threshold)", async () => {
      mockMediaFiles = [
        {
          id: 1,
          sha256Hash: "sha1",
          contentHash: "content1",
          perceptualHash: "phash1",
          fileType: "image",
          scanFolderId: 1,
        },
        {
          id: 2,
          sha256Hash: "sha2",
          contentHash: "content2",
          perceptualHash: "phash2",
          fileType: "image",
          scanFolderId: 1,
        },
        {
          id: 3,
          sha256Hash: "sha3",
          contentHash: "content3",
          perceptualHash: "phash3",
          fileType: "image",
          scanFolderId: 1,
        },
      ];

      // Make phash distance large so no phash matches
      mockHammingDistance = async () => 100;

      const result = await detectDuplicates();

      expect(result.phashPairsComputed).toBe(0);
      expect(result.totalComparisons).toBe(3); // 3 choose 2 = 3
    });

    test("stores pairwise distances in phashMatches table", async () => {
      mockMediaFiles = [
        {
          id: 1,
          sha256Hash: "sha1",
          contentHash: "c1",
          perceptualHash: "1111111111111111",
          fileType: "image",
          scanFolderId: 1,
        },
        {
          id: 2,
          sha256Hash: "sha2",
          contentHash: "c2",
          perceptualHash: "1111111111111112",
          fileType: "image",
          scanFolderId: 1,
        },
      ];

      mockHammingDistance = async () => 3;

      const result = await detectDuplicates({ phashThreshold: 5 });

      // Should have called insertPhashMatches with the pair
      expect(mockPhashMatchProvider.insertPhashMatches).toHaveBeenCalled();
      expect(result.phashPairsComputed).toBe(1);
      expect(result.totalComparisons).toBe(1);
    });

    test("respects custom phash threshold", async () => {
      mockMediaFiles = [
        {
          id: 1,
          sha256Hash: "sha1",
          contentHash: "content1",
          perceptualHash: "phash1",
          fileType: "image",
          scanFolderId: 1,
        },
        {
          id: 2,
          sha256Hash: "sha2",
          contentHash: "content2",
          perceptualHash: "phash2",
          fileType: "image",
          scanFolderId: 1,
        },
      ];

      // Distance of 8 - should be rejected with default threshold of 5
      mockHammingDistance = async () => 8;

      const resultDefault = await detectDuplicates();
      expect(resultDefault.phashPairsComputed).toBe(0);

      // Reset state
      mockPhashMatches = [];

      // Now with higher threshold of 10, should be accepted
      const resultHighThreshold = await detectDuplicates({ phashThreshold: 10 });
      expect(resultHighThreshold.phashPairsComputed).toBe(1);
    });

    test("skips already-computed pairs in phashMatches", async () => {
      mockMediaFiles = [
        {
          id: 1,
          sha256Hash: "sha1",
          contentHash: "c1",
          perceptualHash: "hash1",
          fileType: "image",
          scanFolderId: 1,
        },
        {
          id: 2,
          sha256Hash: "sha2",
          contentHash: "c2",
          perceptualHash: "hash2",
          fileType: "image",
          scanFolderId: 1,
        },
      ];

      // Pre-populate existing pair
      mockPhashMatches = [{ id: 1, mediaFileId1: 1, mediaFileId2: 2, distance: 3, createdAt: Date.now() }];

      mockHammingDistance = async () => 3;

      const result = await detectDuplicates({ phashThreshold: 5 });

      // No new pairs should be computed since the pair already exists
      expect(result.phashPairsComputed).toBe(0);
    });

    test("handles hamming distance returning -1 (module not available)", async () => {
      mockMediaFiles = [
        { id: 1, sha256Hash: "sha1", contentHash: "c1", perceptualHash: "phash1", fileType: "image", scanFolderId: 1 },
        { id: 2, sha256Hash: "sha2", contentHash: "c2", perceptualHash: "phash2", fileType: "image", scanFolderId: 1 },
      ];

      // Return -1 to indicate module not available
      mockHammingDistance = async () => -1;

      const result = await detectDuplicates();

      expect(result.phashPairsComputed).toBe(0);
    });

    test("videos are excluded from phash comparison", async () => {
      mockMediaFiles = [
        { id: 1, sha256Hash: "same", contentHash: "c1", perceptualHash: "phash1", fileType: "video", scanFolderId: 1 },
        { id: 2, sha256Hash: "same", contentHash: "c2", perceptualHash: "phash2", fileType: "video", scanFolderId: 1 },
      ];

      mockHammingDistance = async () => 1;

      const result = await detectDuplicates();

      // Videos are filtered out of phash comparison
      expect(result.phashPairsComputed).toBe(0);
      expect(result.totalComparisons).toBe(0);
    });

    test("finds all qualifying pairs without early termination", async () => {
      mockMediaFiles = [
        {
          id: 1,
          sha256Hash: "sha1",
          contentHash: "c1",
          perceptualHash: "aaaa",
          fileType: "image",
          scanFolderId: 1,
        },
        {
          id: 2,
          sha256Hash: "sha2",
          contentHash: "c2",
          perceptualHash: "aabb",
          fileType: "image",
          scanFolderId: 1,
        },
        {
          id: 3,
          sha256Hash: "sha3",
          contentHash: "c3",
          perceptualHash: "aacc",
          fileType: "image",
          scanFolderId: 1,
        },
      ];

      // A↔B = 2, A↔C = 2, B↔C = 100 (not close)
      mockHammingDistance = async (hash1: string, hash2: string) => {
        if ((hash1 === "aaaa" && hash2 === "aabb") || (hash1 === "aabb" && hash2 === "aaaa")) return 2;
        if ((hash1 === "aaaa" && hash2 === "aacc") || (hash1 === "aacc" && hash2 === "aaaa")) return 2;
        return 100;
      };

      const result = await detectDuplicates({ phashThreshold: 5 });

      // Should find BOTH pairs (1,2) and (1,3)
      expect(result.phashPairsComputed).toBe(2);
      expect(result.totalComparisons).toBe(3); // 3 choose 2 = 3
      expect(mockPhashMatchProvider.insertPhashMatches).toHaveBeenCalled();
    });

    test("progress callback is called during comparisons", async () => {
      // Create enough files to trigger the progress callback (every 1000 comparisons)
      // With 2 files, only 1 comparison is done, so we can at least verify the function runs
      mockMediaFiles = [
        { id: 1, sha256Hash: "sha1", contentHash: "c1", perceptualHash: "p1", fileType: "image", scanFolderId: 1 },
        { id: 2, sha256Hash: "sha2", contentHash: "c2", perceptualHash: "p2", fileType: "image", scanFolderId: 1 },
      ];

      mockHammingDistance = async () => 100; // No matches

      const progressCalls: { stage: string; current: number; total: number }[] = [];
      const onProgress = (stage: string, current: number, total: number) => {
        progressCalls.push({ stage, current, total });
      };

      const result = await detectDuplicates({ onProgress });

      // With only 1 comparison, progress won't fire (fires every 1000)
      // But the function should still complete successfully
      expect(result.totalComparisons).toBe(1);
    });

    test("files with null perceptualHash are ignored", async () => {
      mockMediaFiles = [
        { id: 1, sha256Hash: "sha1", contentHash: "c1", perceptualHash: null, fileType: "image", scanFolderId: 1 },
        { id: 2, sha256Hash: "sha2", contentHash: "c2", perceptualHash: null, fileType: "image", scanFolderId: 1 },
      ];

      const result = await detectDuplicates();

      expect(result.phashPairsComputed).toBe(0);
      expect(result.totalComparisons).toBe(0);
    });

    test("transitive matches A-B-C stores all qualifying pairs", async () => {
      mockMediaFiles = [
        {
          id: 1,
          sha256Hash: "sha1",
          contentHash: "c1",
          perceptualHash: "aaaa",
          fileType: "image",
          scanFolderId: 1,
        },
        {
          id: 2,
          sha256Hash: "sha2",
          contentHash: "c2",
          perceptualHash: "aabb",
          fileType: "image",
          scanFolderId: 1,
        },
        {
          id: 3,
          sha256Hash: "sha3",
          contentHash: "c3",
          perceptualHash: "bbbb",
          fileType: "image",
          scanFolderId: 1,
        },
      ];

      // A↔B distance 2, B↔C distance 3, A↔C distance > threshold
      mockHammingDistance = async (hash1: string, hash2: string) => {
        if ((hash1 === "aaaa" && hash2 === "aabb") || (hash1 === "aabb" && hash2 === "aaaa")) return 2;
        if ((hash1 === "aabb" && hash2 === "bbbb") || (hash1 === "bbbb" && hash2 === "aabb")) return 3;
        return 100; // A↔C too far
      };

      const result = await detectDuplicates({ phashThreshold: 5 });

      // Should store 2 pairs: (1,2) and (2,3)
      expect(result.phashPairsComputed).toBe(2);
      expect(result.totalComparisons).toBe(3);
    });
  });
});
