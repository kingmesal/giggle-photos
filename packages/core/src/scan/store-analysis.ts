/**
 * Persist one image's single-pass analysis (RFD-002): metadata row, hashes, status — or a
 * categorized error. Failures are counted, never silently skipped. ⚠️ FRAGILE: See _FRAGILE.md
 */
import type { MediaFile, UpdateMediaFile } from "../zod/media-file";
import type { AnalysisResponse } from "./analysis-protocol";
import { HashError } from "./hash-error";
import { extractImageMetadata } from "./metadata-image";

export interface AlgorithmStats {
  computed: number;
  skipped: number;
  errors: number;
}

export interface HashStats {
  processed: number;
  errors: number;
  skipped: number;
  algorithmStats: { sha256: AlgorithmStats; contentHash: AlgorithmStats; perceptualHash: AlgorithmStats };
  errorBreakdown: Record<string, number>;
  /** CLIP embeddings stored / failed in this batch (0/0 when the model was not loaded). */
  clip: { embedded: number; errors: number };
}

/** Where embeddings go (ClipProvider + the model id they belong to). */
export interface EmbeddingSink {
  modelId: string;
  upsertEmbeddings(
    rows: { mediaFileId: number; modelId: string; embedding: Float32Array<ArrayBuffer> }[],
  ): Promise<void>;
}

export function createHashStats(): HashStats {
  const zero = (): AlgorithmStats => ({ computed: 0, skipped: 0, errors: 0 });
  return {
    processed: 0,
    errors: 0,
    skipped: 0,
    algorithmStats: { sha256: zero(), contentHash: zero(), perceptualHash: zero() },
    errorBreakdown: {},
    clip: { embedded: 0, errors: 0 },
  };
}

/** Store a CLIP embedding from a worker response, counting failures. Never throws for a bad vector. */
export async function storeEmbedding(
  mediaFileId: number,
  response: Pick<AnalysisResponse, "clipEmbedding" | "clipError">,
  sink: EmbeddingSink | undefined,
  stats: HashStats,
): Promise<void> {
  if (!sink) return;
  if (response.clipEmbedding) {
    await sink.upsertEmbeddings([
      { mediaFileId, modelId: sink.modelId, embedding: Float32Array.from(response.clipEmbedding) },
    ]);
    stats.clip.embedded++;
  } else if (response.clipError) {
    stats.clip.errors++;
  }
}

/** Count a failed file under its breakdown key (e.g. "unsupported_format:heic"). */
export function countError(stats: HashStats, error: HashError): void {
  stats.errors++;
  stats.errorBreakdown[error.breakdownKey] = (stats.errorBreakdown[error.breakdownKey] ?? 0) + 1;
}

interface MediaFileWriter {
  updateMediaFile(data: UpdateMediaFile): Promise<void>;
}

/**
 * Store an image's analysis. SHA-256 is stored whenever the bytes were read (so byte-identical
 * broken files still group as exact duplicates); metadata is recorded with whatever is known.
 * Returns the HashError when the file failed, so the caller can log it.
 */
export async function storeImageAnalysis(
  file: Pick<MediaFile, "id" | "path">,
  response: AnalysisResponse,
  mediaFiles: MediaFileWriter,
  stats: HashStats,
  embeddings?: EmbeddingSink,
): Promise<HashError | null> {
  const { sha256, contentHash, perceptualHash, failure } = response;
  if (sha256) stats.algorithmStats.sha256.computed++;
  else stats.algorithmStats.sha256.errors++;

  if (sha256) {
    await extractImageMetadata(file.id, file.path, { exif: response.exif, decoded: response.decoded });
  }

  if (failure || !contentHash || !perceptualHash) {
    const error = failure
      ? new HashError(failure.category, failure.message, failure.format)
      : new HashError("unknown", "Worker returned no hashes");
    stats.algorithmStats.contentHash.errors++;
    stats.algorithmStats.perceptualHash.errors++;
    countError(stats, error);
    await mediaFiles.updateMediaFile({
      id: file.id,
      ...(sha256 ? { sha256Hash: sha256 } : {}),
      status: "error",
      errorMessage: `${error.breakdownKey}: ${error.message}`,
    });
    return error;
  }

  stats.algorithmStats.contentHash.computed++;
  stats.algorithmStats.perceptualHash.computed++;
  await storeEmbedding(file.id, response, embeddings, stats);
  await mediaFiles.updateMediaFile({
    id: file.id,
    sha256Hash: sha256,
    contentHash,
    perceptualHash,
    status: "hashed",
  });
  stats.processed++;
  return null;
}
