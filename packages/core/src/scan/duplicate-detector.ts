import { DatabaseProvider } from "../db/database-provider";
import { getLogger } from "../logging/logger";

const log = getLogger("core:duplicate-detector");

import { hammingDistance } from "./hash-phash";

/**
 * Options for duplicate detection.
 */
export interface DetectionOptions {
  /** Hamming distance threshold for perceptual hash matching. Default 5. */
  phashThreshold?: number;
  /** Progress callback invoked for each stage of detection. */
  onProgress?: (stage: string, current: number, total: number) => void;
}

/**
 * Result of duplicate detection.
 *
 * With the query-based logical-group architecture, the detector no longer
 * creates pre-computed groups.  Its only job is to populate the `phashMatches`
 * table with pairwise hamming distances so the review-query layer can derive
 * logical groups at query time.
 */
export interface DetectionResult {
  /** Number of new pHash match pairs stored. */
  phashPairsComputed: number;
  /** Total pairwise comparisons performed. */
  totalComparisons: number;
}

/**
 * Compute pairwise perceptual-hash distances and store qualifying pairs in
 * the `phashMatches` table.
 *
 * SHA-256 and content-hash duplicate groups are no longer pre-computed here;
 * they are derived at query time from shared hash values in `mediaFiles`.
 *
 * @param options - Optional detection configuration
 * @returns Detection result with pair counts
 */
export async function detectDuplicates(options?: DetectionOptions): Promise<DetectionResult> {
  const { phashThreshold = 5, onProgress } = options ?? {};

  const dbProvider = await DatabaseProvider.getInstance();
  const db = dbProvider.getClient().getDb();
  const phashMatchProvider = dbProvider.getPhashMatchProvider();

  let phashPairsComputed = 0;

  // Get all image files with perceptual hashes
  const imagesWithPhash = await db
    .selectFrom("mediaFiles")
    .select(["id", "perceptualHash", "scanFolderId"])
    .where("perceptualHash", "is not", null)
    .where("fileType", "=", "image")
    .orderBy("id", "asc")
    .execute();

  const phashTotal = imagesWithPhash.length;
  log.info(`Found ${phashTotal} images with perceptual hashes`);

  if (phashTotal < 2) {
    log.info("Not enough images for pHash comparison");
    return { phashPairsComputed: 0, totalComparisons: 0 };
  }

  // Load existing pair keys to skip already-computed pairs
  const existingPairKeys = await phashMatchProvider.getAllPairKeys();

  // O(n²) pairwise comparison — every qualifying pair is recorded
  let comparisons = 0;
  const totalComparisons = (phashTotal * (phashTotal - 1)) / 2;
  const BATCH_SIZE = 100;
  let batch: { mediaFileId1: number; mediaFileId2: number; distance: number }[] = [];

  for (let i = 0; i < imagesWithPhash.length; i++) {
    const file1 = imagesWithPhash[i];
    if (!file1) continue;

    const file1Id = file1.id as number;
    const file1Phash = file1.perceptualHash as string;

    for (let j = i + 1; j < imagesWithPhash.length; j++) {
      const file2 = imagesWithPhash[j];
      if (!file2) continue;

      const file2Id = file2.id as number;
      const file2Phash = file2.perceptualHash as string;
      comparisons++;

      // Progress update every 1000 comparisons
      if (onProgress && comparisons % 1000 === 0) {
        onProgress("phash_compute", comparisons, totalComparisons);
      }

      // Normalize pair key (file1Id < file2Id guaranteed by loop ordering)
      const pairKey = `${file1Id}:${file2Id}`;

      // Skip if already computed
      if (existingPairKeys.has(pairKey)) {
        continue;
      }

      // Calculate hamming distance
      const dist = await hammingDistance(file1Phash, file2Phash);

      // Skip if module not available or distance exceeds threshold
      if (dist < 0 || dist > phashThreshold) {
        continue;
      }

      // Store the qualifying pair
      batch.push({ mediaFileId1: file1Id, mediaFileId2: file2Id, distance: dist });
      phashPairsComputed++;

      // Flush batch when full
      if (batch.length >= BATCH_SIZE) {
        await phashMatchProvider.insertPhashMatches(batch);
        batch = [];
      }
    }
  }

  // Flush remaining batch
  if (batch.length > 0) {
    await phashMatchProvider.insertPhashMatches(batch);
  }

  // Recompute pre-computed group membership table
  if (phashPairsComputed > 0) {
    const phashGroupProvider = dbProvider.getPhashGroupProvider();
    await phashGroupProvider.recomputeGroups(phashThreshold);
  }

  log.info(`pHash detection complete: ${phashPairsComputed} pairs stored (${comparisons} comparisons)`);

  return { phashPairsComputed, totalComparisons: comparisons };
}
