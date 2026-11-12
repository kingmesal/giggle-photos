import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

// Mock types for the sub-modules
interface MockScanResult {
  totalFiles: number;
  newFiles: number;
  skipped: number;
}

interface MockMetadataBatchResult {
  processed: number;
  errors: number;
  skipped: number;
}

interface MockHashBatchResult {
  processed: number;
  errors: number;
  skipped: number;
  algorithmStats: {
    sha256: { computed: number; skipped: number; errors: number };
    contentHash: { computed: number; skipped: number; errors: number };
    perceptualHash: { computed: number; skipped: number; errors: number };
  };
}

interface MockDetectionResult {
  phashPairsComputed: number;
  totalComparisons: number;
}

// Mock implementations
let mockScanFolder: ReturnType<typeof mock>;
let mockProcessImageMetadataBatch: ReturnType<typeof mock>;
let mockProcessVideoMetadataBatch: ReturnType<typeof mock>;
let mockProcessHashBatch: ReturnType<typeof mock>;
let mockDetectDuplicates: ReturnType<typeof mock>;
let mockGetInstance: ReturnType<typeof mock>;

// Mock database state
let mockFolders: Array<{
  id: number;
  path: string;
  status: string;
  imageCount: number;
  videoCount: number;
  scanSubdirectories: boolean;
  totalSize: number;
  createdAt: Date;
  updatedAt: Date;
}>;
let mockTotalFileCount: number;
let mockFilesNeedingHashing: Array<{ id: number; path: string }>;
let mockStatusCounts: { pending: number; metadata: number; hashed: number; processed: number; error: number };
// Mock database providers
const mockScanFolderProvider = {
  getAllScanFolders: mock(() => Promise.resolve(mockFolders)),
};

const mockMediaFileProvider = {
  getTotalCount: mock(() => Promise.resolve(mockTotalFileCount)),
  getFilesNeedingHashing: mock((_limit?: number) => Promise.resolve(mockFilesNeedingHashing)),
  getCountByStatus: mock(() => Promise.resolve(mockStatusCounts)),
  updateMediaFile: mock(() => Promise.resolve()),
};

// Create a chainable mock query builder
const createQueryBuilder = (tableName: string) => {
  const builder: Record<string, unknown> = {};

  builder.select = (_cols: unknown) => builder;
  builder.selectAll = (_table?: string) => builder;
  builder.where = (_col: string | ((_eb: unknown) => unknown), _op?: string, _val?: unknown) => builder;
  builder.groupBy = (_col: string) => builder;
  builder.having = (_eb: unknown, _op?: string, _val?: unknown) => builder;
  builder.orderBy = (_col: string, _dir?: string) => builder;
  builder.limit = (_n: number) => builder;
  builder.leftJoin = (_table: string, _col1: string, _col2: string) => builder;

  builder.executeTakeFirst = () => {
    if (tableName === "mediaFiles") {
      // For the folder file count query, return count based on mockFilesPerFolder
      return Promise.resolve({ count: 0 });
    }
    return Promise.resolve(undefined);
  };

  builder.execute = () => {
    return Promise.resolve([]);
  };

  return builder;
};

// Create a chainable mock update builder for updateTable
const createUpdateBuilder = () => {
  const builder: Record<string, unknown> = {};
  builder.set = (_values: unknown) => builder;
  builder.where = (_col: string, _op?: string, _val?: unknown) => builder;
  builder.execute = () => Promise.resolve([]);
  return builder;
};

const mockDbClient = {
  getDb: () => ({
    selectFrom: (tableName: string) => createQueryBuilder(tableName),
    updateTable: (_tableName: string) => createUpdateBuilder(),
  }),
};

const mockDatabaseProvider = {
  getScanFolderProvider: () => mockScanFolderProvider,
  getMediaFileProvider: () => mockMediaFileProvider,
  getClient: () => mockDbClient,
};

// Setup mocks before importing the module
mockGetInstance = mock(() => Promise.resolve(mockDatabaseProvider));

// We need to mock the modules before importing processing-pipeline
// Using Bun's mock.module approach
mock.module("../db/database-provider", () => ({
  DatabaseProvider: {
    getInstance: mockGetInstance,
  },
}));

mockScanFolder = mock(
  (
    _folderId: number,
    _onProgress?: (current: number, total: number, path: string) => void,
  ): Promise<MockScanResult> => {
    return Promise.resolve({ totalFiles: 10, newFiles: 10, skipped: 0 });
  },
);

mock.module("./file-scanner", () => ({
  scanFolder: mockScanFolder,
}));

mockProcessImageMetadataBatch = mock(
  (_options?: { onProgress?: (completed: number, total: number) => void }): Promise<MockMetadataBatchResult> => {
    return Promise.resolve({ processed: 5, errors: 0, skipped: 0 });
  },
);

mock.module("./metadata-image", () => ({
  processImageMetadataBatch: mockProcessImageMetadataBatch,
}));

mockProcessVideoMetadataBatch = mock(
  (_options?: { onProgress?: (completed: number, total: number) => void }): Promise<MockMetadataBatchResult> => {
    return Promise.resolve({ processed: 2, errors: 0, skipped: 0 });
  },
);

mock.module("./metadata-video", () => ({
  processVideoMetadataBatch: mockProcessVideoMetadataBatch,
}));

mockProcessHashBatch = mock(
  (_options?: {
    concurrency?: number;
    onProgress?: (completed: number, total: number) => void;
  }): Promise<MockHashBatchResult> => {
    return Promise.resolve({
      processed: 10,
      errors: 0,
      skipped: 0,
      algorithmStats: {
        sha256: { computed: 10, skipped: 0, errors: 0 },
        contentHash: { computed: 5, skipped: 0, errors: 0 },
        perceptualHash: { computed: 5, skipped: 0, errors: 0 },
      },
    });
  },
);

mock.module("./hash-unified", () => ({
  processHashBatch: mockProcessHashBatch,
}));

mockDetectDuplicates = mock(
  (_options?: {
    phashThreshold?: number;
    onProgress?: (stage: string, current: number, total: number) => void;
  }): Promise<MockDetectionResult> => {
    return Promise.resolve({
      phashPairsComputed: 4,
      totalComparisons: 45,
    });
  },
);

mock.module("./duplicate-detector", () => ({
  detectDuplicates: mockDetectDuplicates,
}));

// Mock the logger
mock.module("../logging/logger", () => ({
  getLogger: () => ({
    info: () => {},
    debug: () => {},
    warn: () => {},
    error: () => {},
  }),
}));

// Now import the module under test
const { runPipeline, getPipelineState } = await import("./processing-pipeline");

describe("processing-pipeline", () => {
  beforeEach(() => {
    // Reset mock state
    mockFolders = [];
    mockTotalFileCount = 0;
    mockFilesNeedingHashing = [];
    mockStatusCounts = { pending: 0, metadata: 0, hashed: 0, processed: 0, error: 0 };

    // Reset all mock call counts
    mockScanFolder.mockClear();
    mockProcessImageMetadataBatch.mockClear();
    mockProcessVideoMetadataBatch.mockClear();
    mockProcessHashBatch.mockClear();
    mockDetectDuplicates.mockClear();
    mockScanFolderProvider.getAllScanFolders.mockClear();
    mockMediaFileProvider.getTotalCount.mockClear();
    mockMediaFileProvider.getFilesNeedingHashing.mockClear();
    mockMediaFileProvider.getCountByStatus.mockClear();
  });

  afterEach(() => {
    // Clean up after each test
  });

  describe("runPipeline", () => {
    describe("scanning stage", () => {
      test("executes scanning stage for folders with status 'added'", async () => {
        mockFolders = [
          {
            id: 1,
            path: "/photos",
            status: "added",
            imageCount: 0,
            videoCount: 0,
            scanSubdirectories: true,
            totalSize: 0,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ];
        mockTotalFileCount = 10;

        await runPipeline();

        expect(mockScanFolder).toHaveBeenCalledTimes(1);
        expect(mockScanFolder.mock.calls[0]?.[0]).toBe(1);
      });

      test("executes scanning stage for folders with status 'error'", async () => {
        mockFolders = [
          {
            id: 2,
            path: "/videos",
            status: "error",
            imageCount: 0,
            videoCount: 0,
            scanSubdirectories: true,
            totalSize: 0,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ];
        mockTotalFileCount = 5;

        await runPipeline();

        expect(mockScanFolder).toHaveBeenCalledTimes(1);
        expect(mockScanFolder.mock.calls[0]?.[0]).toBe(2);
      });

      test("skips scanning for folders with status 'ready' and no expected files", async () => {
        mockFolders = [
          {
            id: 3,
            path: "/documents",
            status: "ready",
            imageCount: 0,
            videoCount: 0,
            scanSubdirectories: true,
            totalSize: 0,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ];
        mockTotalFileCount = 0;

        await runPipeline();

        expect(mockScanFolder).not.toHaveBeenCalled();
      });

      test("skips scanning for folders with status 'scanning'", async () => {
        mockFolders = [
          {
            id: 4,
            path: "/pictures",
            status: "scanning",
            imageCount: 0,
            videoCount: 0,
            scanSubdirectories: true,
            totalSize: 0,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ];
        mockTotalFileCount = 0;

        await runPipeline();

        expect(mockScanFolder).not.toHaveBeenCalled();
      });

      test("scans multiple folders with 'added' or 'error' status, skips ready with files", async () => {
        mockFolders = [
          {
            id: 1,
            path: "/photos",
            status: "added",
            imageCount: 0,
            videoCount: 0,
            scanSubdirectories: true,
            totalSize: 0,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          {
            id: 2,
            path: "/videos",
            status: "error",
            imageCount: 0,
            videoCount: 0,
            scanSubdirectories: true,
            totalSize: 0,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          {
            id: 3,
            path: "/documents",
            status: "ready",
            imageCount: 0,
            videoCount: 0,
            scanSubdirectories: true,
            totalSize: 0,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ];
        mockTotalFileCount = 20;

        await runPipeline();

        expect(mockScanFolder).toHaveBeenCalledTimes(2);
      });
    });

    describe("metadata extraction stage", () => {
      test("executes image and video metadata extraction in parallel", async () => {
        mockFolders = [
          {
            id: 1,
            path: "/photos",
            status: "ready",
            imageCount: 10,
            videoCount: 5,
            scanSubdirectories: true,
            totalSize: 1000,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ];
        mockTotalFileCount = 15;

        await runPipeline();

        expect(mockProcessImageMetadataBatch).toHaveBeenCalledTimes(1);
        expect(mockProcessVideoMetadataBatch).toHaveBeenCalledTimes(1);
      });

      test("accumulates errors from metadata extraction", async () => {
        mockFolders = [
          {
            id: 1,
            path: "/photos",
            status: "ready",
            imageCount: 10,
            videoCount: 5,
            scanSubdirectories: true,
            totalSize: 1000,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ];
        mockTotalFileCount = 15;

        mockProcessImageMetadataBatch.mockImplementation(() =>
          Promise.resolve({ processed: 8, errors: 2, skipped: 0 }),
        );
        mockProcessVideoMetadataBatch.mockImplementation(() =>
          Promise.resolve({ processed: 4, errors: 1, skipped: 0 }),
        );

        const result = await runPipeline();

        // Errors accumulate: 2 from images + 1 from videos + 0 from hashing
        expect(result.errors).toBeGreaterThanOrEqual(3);
      });
    });

    describe("hashing stage", () => {
      test("executes unified hash batch processor", async () => {
        mockFolders = [
          {
            id: 1,
            path: "/photos",
            status: "ready",
            imageCount: 10,
            videoCount: 0,
            scanSubdirectories: true,
            totalSize: 1000,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ];
        mockTotalFileCount = 10;

        await runPipeline();

        expect(mockProcessHashBatch).toHaveBeenCalledTimes(1);
      });

      test("passes hashConcurrency option to unified hash batch processor", async () => {
        mockFolders = [
          {
            id: 1,
            path: "/photos",
            status: "ready",
            imageCount: 10,
            videoCount: 0,
            scanSubdirectories: true,
            totalSize: 1000,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ];
        mockTotalFileCount = 10;

        await runPipeline({ hashConcurrency: 8 });

        const hashCall = mockProcessHashBatch.mock.calls[0];
        expect(hashCall?.[0]?.concurrency).toBe(8);
      });

      test("uses default hashConcurrency of 4 when not specified", async () => {
        mockFolders = [
          {
            id: 1,
            path: "/photos",
            status: "ready",
            imageCount: 10,
            videoCount: 0,
            scanSubdirectories: true,
            totalSize: 1000,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ];
        mockTotalFileCount = 10;

        await runPipeline();

        const hashCall = mockProcessHashBatch.mock.calls[0];
        expect(hashCall?.[0]?.concurrency).toBe(4);
      });

      test("accumulates errors from hash batch processor", async () => {
        mockFolders = [
          {
            id: 1,
            path: "/photos",
            status: "ready",
            imageCount: 10,
            videoCount: 0,
            scanSubdirectories: true,
            totalSize: 1000,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ];
        mockTotalFileCount = 10;

        mockProcessHashBatch.mockImplementation(() =>
          Promise.resolve({
            processed: 4,
            errors: 6,
            skipped: 0,
            algorithmStats: {
              sha256: { computed: 8, skipped: 0, errors: 2 },
              contentHash: { computed: 7, skipped: 0, errors: 3 },
              perceptualHash: { computed: 9, skipped: 0, errors: 1 },
            },
          }),
        );

        const result = await runPipeline();

        // Errors from hashing: 6 (from hashResult.errors)
        expect(result.errors).toBeGreaterThanOrEqual(6);
      });
    });

    describe("duplicate detection stage", () => {
      test("executes duplicate detection after hashing", async () => {
        mockFolders = [
          {
            id: 1,
            path: "/photos",
            status: "ready",
            imageCount: 10,
            videoCount: 0,
            scanSubdirectories: true,
            totalSize: 1000,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ];
        mockTotalFileCount = 10;

        await runPipeline();

        expect(mockDetectDuplicates).toHaveBeenCalledTimes(1);
      });

      test("passes phashThreshold option to duplicate detector", async () => {
        mockFolders = [
          {
            id: 1,
            path: "/photos",
            status: "ready",
            imageCount: 10,
            videoCount: 0,
            scanSubdirectories: true,
            totalSize: 1000,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ];
        mockTotalFileCount = 10;

        await runPipeline({ phashThreshold: 10 });

        const detectCall = mockDetectDuplicates.mock.calls[0];
        expect(detectCall?.[0]?.phashThreshold).toBe(10);
      });

      test("uses default phashThreshold of 5 when not specified", async () => {
        mockFolders = [
          {
            id: 1,
            path: "/photos",
            status: "ready",
            imageCount: 10,
            videoCount: 0,
            scanSubdirectories: true,
            totalSize: 1000,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ];
        mockTotalFileCount = 10;

        await runPipeline();

        const detectCall = mockDetectDuplicates.mock.calls[0];
        expect(detectCall?.[0]?.phashThreshold).toBe(5);
      });
    });

    describe("progress callback", () => {
      test("calls progress callback at scanning stage", async () => {
        mockFolders = [
          {
            id: 1,
            path: "/photos",
            status: "added",
            imageCount: 0,
            videoCount: 0,
            scanSubdirectories: true,
            totalSize: 0,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ];
        mockTotalFileCount = 10;

        const progressUpdates: Array<{ stage: string }> = [];
        await runPipeline({
          onProgress: (progress) => {
            progressUpdates.push({ stage: progress.stage });
          },
        });

        const stages = [...new Set(progressUpdates.map((p) => p.stage))];
        expect(stages).toContain("scanning");
      });

      test("calls progress callback at metadata stage", async () => {
        mockFolders = [
          {
            id: 1,
            path: "/photos",
            status: "ready",
            imageCount: 10,
            videoCount: 0,
            scanSubdirectories: true,
            totalSize: 1000,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ];
        mockTotalFileCount = 10;

        const progressUpdates: Array<{ stage: string }> = [];
        await runPipeline({
          onProgress: (progress) => {
            progressUpdates.push({ stage: progress.stage });
          },
        });

        const stages = [...new Set(progressUpdates.map((p) => p.stage))];
        expect(stages).toContain("metadata");
      });

      test("calls progress callback at hashing stage", async () => {
        mockFolders = [
          {
            id: 1,
            path: "/photos",
            status: "ready",
            imageCount: 10,
            videoCount: 0,
            scanSubdirectories: true,
            totalSize: 1000,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ];
        mockTotalFileCount = 10;

        const progressUpdates: Array<{ stage: string }> = [];
        await runPipeline({
          onProgress: (progress) => {
            progressUpdates.push({ stage: progress.stage });
          },
        });

        const stages = [...new Set(progressUpdates.map((p) => p.stage))];
        expect(stages).toContain("hashing");
      });

      test("calls progress callback at detecting stage", async () => {
        mockFolders = [
          {
            id: 1,
            path: "/photos",
            status: "ready",
            imageCount: 10,
            videoCount: 0,
            scanSubdirectories: true,
            totalSize: 1000,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ];
        mockTotalFileCount = 10;

        const progressUpdates: Array<{ stage: string }> = [];
        await runPipeline({
          onProgress: (progress) => {
            progressUpdates.push({ stage: progress.stage });
          },
        });

        const stages = [...new Set(progressUpdates.map((p) => p.stage))];
        expect(stages).toContain("detecting");
      });

      test("calls progress callback at complete stage", async () => {
        mockFolders = [
          {
            id: 1,
            path: "/photos",
            status: "ready",
            imageCount: 10,
            videoCount: 0,
            scanSubdirectories: true,
            totalSize: 1000,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ];
        mockTotalFileCount = 10;

        const progressUpdates: Array<{ stage: string }> = [];
        await runPipeline({
          onProgress: (progress) => {
            progressUpdates.push({ stage: progress.stage });
          },
        });

        const stages = [...new Set(progressUpdates.map((p) => p.stage))];
        expect(stages).toContain("complete");
      });

      test("progress callback receives duplicatesFound count", async () => {
        mockFolders = [
          {
            id: 1,
            path: "/photos",
            status: "ready",
            imageCount: 10,
            videoCount: 0,
            scanSubdirectories: true,
            totalSize: 1000,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ];
        mockTotalFileCount = 10;

        mockDetectDuplicates.mockImplementation(() =>
          Promise.resolve({
            phashPairsComputed: 12,
            totalComparisons: 45,
          }),
        );

        let finalProgress: { duplicatesFound: number } | null = null;
        await runPipeline({
          onProgress: (progress) => {
            finalProgress = { duplicatesFound: progress.duplicatesFound };
          },
        });

        expect(finalProgress?.duplicatesFound).toBe(12);
      });
    });

    describe("cancellation support", () => {
      test("throws error when AbortSignal is aborted during scanning", async () => {
        mockFolders = [
          {
            id: 1,
            path: "/photos",
            status: "added",
            imageCount: 0,
            videoCount: 0,
            scanSubdirectories: true,
            totalSize: 0,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          {
            id: 2,
            path: "/videos",
            status: "added",
            imageCount: 0,
            videoCount: 0,
            scanSubdirectories: true,
            totalSize: 0,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ];
        mockTotalFileCount = 10;

        const abortController = new AbortController();

        // Abort after first folder scan
        mockScanFolder.mockImplementation(async () => {
          abortController.abort();
          return { totalFiles: 5, newFiles: 5, skipped: 0 };
        });

        await expect(runPipeline({ signal: abortController.signal })).rejects.toThrow("Pipeline cancelled");
      });

      test("does not proceed to metadata stage when cancelled during scanning", async () => {
        mockFolders = [
          {
            id: 1,
            path: "/photos",
            status: "added",
            imageCount: 0,
            videoCount: 0,
            scanSubdirectories: true,
            totalSize: 0,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ];
        mockTotalFileCount = 10;

        const abortController = new AbortController();

        mockScanFolder.mockImplementation(async () => {
          abortController.abort();
          return { totalFiles: 5, newFiles: 5, skipped: 0 };
        });

        try {
          await runPipeline({ signal: abortController.signal });
        } catch {
          // Expected
        }

        expect(mockProcessImageMetadataBatch).not.toHaveBeenCalled();
        expect(mockProcessVideoMetadataBatch).not.toHaveBeenCalled();
      });

      test("respects pre-aborted signal", async () => {
        mockFolders = [
          {
            id: 1,
            path: "/photos",
            status: "added",
            imageCount: 0,
            videoCount: 0,
            scanSubdirectories: true,
            totalSize: 0,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ];
        mockTotalFileCount = 10;

        const abortController = new AbortController();
        abortController.abort();

        await expect(runPipeline({ signal: abortController.signal })).rejects.toThrow("Pipeline cancelled");
        expect(mockScanFolder).not.toHaveBeenCalled();
      });
    });

    describe("empty folders handling", () => {
      test("handles empty folders gracefully with no files", async () => {
        mockFolders = [
          {
            id: 1,
            path: "/empty",
            status: "added",
            imageCount: 0,
            videoCount: 0,
            scanSubdirectories: true,
            totalSize: 0,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ];
        mockTotalFileCount = 0;

        const result = await runPipeline();

        expect(result.totalFiles).toBe(0);
        expect(result.phashPairsComputed).toBe(0);
        expect(result.totalComparisons).toBe(0);
        expect(result.errors).toBe(0);
      });

      test("skips metadata, hashing, and detection when no files", async () => {
        mockFolders = [
          {
            id: 1,
            path: "/empty",
            status: "added",
            imageCount: 0,
            videoCount: 0,
            scanSubdirectories: true,
            totalSize: 0,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ];
        mockTotalFileCount = 0;

        await runPipeline();

        expect(mockProcessImageMetadataBatch).not.toHaveBeenCalled();
        expect(mockProcessVideoMetadataBatch).not.toHaveBeenCalled();
        expect(mockProcessHashBatch).not.toHaveBeenCalled();
        expect(mockDetectDuplicates).not.toHaveBeenCalled();
      });

      test("reports 'complete' stage when no files to process", async () => {
        mockFolders = [
          {
            id: 1,
            path: "/empty",
            status: "added",
            imageCount: 0,
            videoCount: 0,
            scanSubdirectories: true,
            totalSize: 0,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ];
        mockTotalFileCount = 0;

        let finalStage: string | null = null;
        await runPipeline({
          onProgress: (progress) => {
            finalStage = progress.stage;
          },
        });

        expect(finalStage).toBe("complete");
      });
    });

    describe("error accumulation", () => {
      test("accumulates errors across all stages", async () => {
        mockFolders = [
          {
            id: 1,
            path: "/photos",
            status: "ready",
            imageCount: 10,
            videoCount: 5,
            scanSubdirectories: true,
            totalSize: 1000,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ];
        mockTotalFileCount = 15;

        // Set up errors in each stage
        mockProcessImageMetadataBatch.mockImplementation(() =>
          Promise.resolve({ processed: 8, errors: 2, skipped: 0 }),
        );
        mockProcessVideoMetadataBatch.mockImplementation(() =>
          Promise.resolve({ processed: 4, errors: 1, skipped: 0 }),
        );
        mockProcessHashBatch.mockImplementation(() =>
          Promise.resolve({
            processed: 9,
            errors: 6,
            skipped: 0,
            algorithmStats: {
              sha256: { computed: 12, skipped: 0, errors: 3 },
              contentHash: { computed: 6, skipped: 2, errors: 2 },
              perceptualHash: { computed: 7, skipped: 2, errors: 1 },
            },
          }),
        );

        const result = await runPipeline();

        // Total errors: 2 (image) + 1 (video) + 6 (hashing) = 9
        expect(result.errors).toBe(9);
      });
    });

    describe("result counts", () => {
      test("returns correct totalFiles count", async () => {
        mockFolders = [
          {
            id: 1,
            path: "/photos",
            status: "ready",
            imageCount: 10,
            videoCount: 5,
            scanSubdirectories: true,
            totalSize: 1000,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ];
        mockTotalFileCount = 15;

        const result = await runPipeline();

        expect(result.totalFiles).toBe(15);
      });

      test("returns correct phashPairsComputed count", async () => {
        mockFolders = [
          {
            id: 1,
            path: "/photos",
            status: "ready",
            imageCount: 10,
            videoCount: 0,
            scanSubdirectories: true,
            totalSize: 1000,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ];
        mockTotalFileCount = 10;

        mockDetectDuplicates.mockImplementation(() =>
          Promise.resolve({
            phashPairsComputed: 6,
            totalComparisons: 45,
          }),
        );

        const result = await runPipeline();

        expect(result.phashPairsComputed).toBe(6);
      });

      test("returns correct totalComparisons count", async () => {
        mockFolders = [
          {
            id: 1,
            path: "/photos",
            status: "ready",
            imageCount: 10,
            videoCount: 0,
            scanSubdirectories: true,
            totalSize: 1000,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ];
        mockTotalFileCount = 10;

        mockDetectDuplicates.mockImplementation(() =>
          Promise.resolve({
            phashPairsComputed: 10,
            totalComparisons: 100,
          }),
        );

        const result = await runPipeline();

        expect(result.totalComparisons).toBe(100);
      });

      test("returns duration in milliseconds", async () => {
        mockFolders = [
          {
            id: 1,
            path: "/photos",
            status: "ready",
            imageCount: 10,
            videoCount: 0,
            scanSubdirectories: true,
            totalSize: 1000,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ];
        mockTotalFileCount = 10;

        const result = await runPipeline();

        expect(typeof result.duration).toBe("number");
        expect(result.duration).toBeGreaterThanOrEqual(0);
      });
    });

    describe("error handling", () => {
      test("updates progress to error stage on failure", async () => {
        mockFolders = [
          {
            id: 1,
            path: "/photos",
            status: "added",
            imageCount: 0,
            videoCount: 0,
            scanSubdirectories: true,
            totalSize: 0,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ];
        mockTotalFileCount = 10;

        const errorMessage = "Scan failed unexpectedly";
        mockScanFolder.mockImplementation(() => Promise.reject(new Error(errorMessage)));

        let errorStage: string | null = null;
        let errorOperation: string | null = null;

        try {
          await runPipeline({
            onProgress: (progress) => {
              if (progress.stage === "error") {
                errorStage = progress.stage;
                errorOperation = progress.currentOperation;
              }
            },
          });
        } catch {
          // Expected
        }

        expect(errorStage).toBe("error");
        expect(errorOperation).toBe(errorMessage);
      });

      test("re-throws the error after updating progress", async () => {
        mockFolders = [
          {
            id: 1,
            path: "/photos",
            status: "added",
            imageCount: 0,
            videoCount: 0,
            scanSubdirectories: true,
            totalSize: 0,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ];
        mockTotalFileCount = 10;

        const errorMessage = "Database connection lost";
        mockScanFolder.mockImplementation(() => Promise.reject(new Error(errorMessage)));

        await expect(runPipeline()).rejects.toThrow(errorMessage);
      });
    });
  });

  describe("getPipelineState", () => {
    describe("hasFolders", () => {
      test("returns true when folders exist", async () => {
        mockFolders = [
          {
            id: 1,
            path: "/photos",
            status: "ready",
            imageCount: 10,
            videoCount: 0,
            scanSubdirectories: true,
            totalSize: 1000,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ];

        const state = await getPipelineState();

        expect(state.hasFolders).toBe(true);
      });

      test("returns false when no folders exist", async () => {
        mockFolders = [];

        const state = await getPipelineState();

        expect(state.hasFolders).toBe(false);
      });
    });

    describe("hasUnscannedFolders", () => {
      test("returns true when folders have status 'added'", async () => {
        mockFolders = [
          {
            id: 1,
            path: "/photos",
            status: "added",
            imageCount: 0,
            videoCount: 0,
            scanSubdirectories: true,
            totalSize: 0,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ];

        const state = await getPipelineState();

        expect(state.hasUnscannedFolders).toBe(true);
      });

      test("returns true when folders have status 'error'", async () => {
        mockFolders = [
          {
            id: 2,
            path: "/videos",
            status: "error",
            imageCount: 0,
            videoCount: 0,
            scanSubdirectories: true,
            totalSize: 0,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ];

        const state = await getPipelineState();

        expect(state.hasUnscannedFolders).toBe(true);
      });

      test("returns false when all folders have status 'ready' with no expected files", async () => {
        mockFolders = [
          {
            id: 1,
            path: "/photos",
            status: "ready",
            imageCount: 0,
            videoCount: 0,
            scanSubdirectories: true,
            totalSize: 0,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ];

        const state = await getPipelineState();

        expect(state.hasUnscannedFolders).toBe(false);
      });

      test("returns false when all folders are scanning", async () => {
        mockFolders = [
          {
            id: 1,
            path: "/photos",
            status: "scanning",
            imageCount: 0,
            videoCount: 0,
            scanSubdirectories: true,
            totalSize: 0,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ];

        const state = await getPipelineState();

        expect(state.hasUnscannedFolders).toBe(false);
      });
    });

    describe("hasUnhashedFiles", () => {
      test("returns true when files need hashing", async () => {
        mockFolders = [
          {
            id: 1,
            path: "/photos",
            status: "ready",
            imageCount: 10,
            videoCount: 0,
            scanSubdirectories: true,
            totalSize: 1000,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ];
        mockFilesNeedingHashing = [{ id: 1, path: "/photos/img1.jpg" }];

        const state = await getPipelineState();

        expect(state.hasUnhashedFiles).toBe(true);
      });

      test("returns false when no files need hashing", async () => {
        mockFolders = [
          {
            id: 1,
            path: "/photos",
            status: "ready",
            imageCount: 10,
            videoCount: 0,
            scanSubdirectories: true,
            totalSize: 1000,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ];
        mockFilesNeedingHashing = [];

        const state = await getPipelineState();

        expect(state.hasUnhashedFiles).toBe(false);
      });
    });

    describe("hasUndetectedDuplicates", () => {
      test("returns true when hashed files exist (not yet processed)", async () => {
        mockFolders = [
          {
            id: 1,
            path: "/photos",
            status: "ready",
            imageCount: 10,
            videoCount: 0,
            scanSubdirectories: true,
            totalSize: 1000,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ];
        mockStatusCounts = { pending: 0, metadata: 0, hashed: 10, processed: 0, error: 0 };
        mockFilesNeedingHashing = [];

        const state = await getPipelineState();

        expect(state.hasUndetectedDuplicates).toBe(true);
      });

      test("returns true when there are files still needing hashing", async () => {
        mockFolders = [
          {
            id: 1,
            path: "/photos",
            status: "ready",
            imageCount: 10,
            videoCount: 0,
            scanSubdirectories: true,
            totalSize: 1000,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ];
        mockStatusCounts = { pending: 0, metadata: 0, hashed: 0, processed: 8, error: 0 };
        mockFilesNeedingHashing = [{ id: 9, path: "/photos/img9.jpg" }];

        const state = await getPipelineState();

        expect(state.hasUndetectedDuplicates).toBe(true);
      });

      test("returns false when all files are processed and no unhashed files", async () => {
        mockFolders = [
          {
            id: 1,
            path: "/photos",
            status: "ready",
            imageCount: 10,
            videoCount: 0,
            scanSubdirectories: true,
            totalSize: 1000,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ];
        mockStatusCounts = { pending: 0, metadata: 0, hashed: 0, processed: 10, error: 0 };
        mockFilesNeedingHashing = [];

        const state = await getPipelineState();

        expect(state.hasUndetectedDuplicates).toBe(false);
      });
    });

    describe("pipeline completeness", () => {
      test("indicates pipeline is complete when all work is done", async () => {
        mockFolders = [
          {
            id: 1,
            path: "/photos",
            status: "ready",
            imageCount: 0,
            videoCount: 0,
            scanSubdirectories: true,
            totalSize: 0,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ];
        mockStatusCounts = { pending: 0, metadata: 0, hashed: 0, processed: 0, error: 0 };
        mockFilesNeedingHashing = [];

        const state = await getPipelineState();

        expect(state.hasUnscannedFolders).toBe(false);
        expect(state.hasUnhashedFiles).toBe(false);
        expect(state.hasUndetectedDuplicates).toBe(false);
      });

      test("indicates work remains when folders need scanning", async () => {
        mockFolders = [
          {
            id: 1,
            path: "/photos",
            status: "added",
            imageCount: 0,
            videoCount: 0,
            scanSubdirectories: true,
            totalSize: 0,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ];
        mockStatusCounts = { pending: 0, metadata: 0, hashed: 0, processed: 0, error: 0 };
        mockFilesNeedingHashing = [];

        const state = await getPipelineState();

        expect(state.hasUnscannedFolders).toBe(true);
      });

      test("indicates work remains when files need hashing", async () => {
        mockFolders = [
          {
            id: 1,
            path: "/photos",
            status: "ready",
            imageCount: 10,
            videoCount: 0,
            scanSubdirectories: true,
            totalSize: 1000,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ];
        mockStatusCounts = { pending: 5, metadata: 0, hashed: 5, processed: 0, error: 0 };
        mockFilesNeedingHashing = [{ id: 1, path: "/photos/img1.jpg" }];

        const state = await getPipelineState();

        expect(state.hasUnhashedFiles).toBe(true);
      });
    });
  });
});
