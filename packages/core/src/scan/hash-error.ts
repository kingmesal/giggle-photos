/**
 * Domain error for hashing/analysis failures. `category` is what the pipeline counts in a
 * stage's `errorBreakdown`, so the UI can show *why* files failed instead of hiding them.
 */
export type HashErrorCategory =
  | "file_not_found"
  | "permission_denied"
  | "empty_file"
  | "corrupt_or_truncated"
  | "unsupported_format"
  | "invalid_hash"
  | "worker_crash"
  | "timeout"
  | "unknown";

export class HashError extends Error {
  readonly category: HashErrorCategory;
  /** Lower-case file extension without the dot, when relevant (e.g. "heic"). */
  readonly format?: string;

  constructor(category: HashErrorCategory, message: string, format?: string) {
    super(message);
    this.name = "HashError";
    this.category = category;
    this.format = format;
  }

  /** Breakdown key: unsupported formats are counted per format, e.g. "unsupported_format:heic". */
  get breakdownKey(): string {
    return this.category === "unsupported_format" && this.format ? `unsupported_format:${this.format}` : this.category;
  }
}
