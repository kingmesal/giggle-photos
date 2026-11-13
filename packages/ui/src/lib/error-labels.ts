/** Human labels for pipeline errorBreakdown keys (see core scan/hash-error.ts). */
const LABELS: Record<string, string> = {
  file_not_found: "File not found",
  permission_denied: "Permission denied",
  empty_file: "Empty file",
  corrupt_or_truncated: "Corrupt or truncated",
  unsupported_format: "Unsupported format",
  invalid_hash: "Invalid hash",
  worker_crash: "Analysis worker crashed",
  timeout: "Timed out",
  unknown: "Other error",
};

/** "unsupported_format:heic" → "Unsupported format (HEIC)"; unknown keys fall back to spaced text. */
export function errorCategoryLabel(key: string): string {
  const [category = key, detail] = key.split(":", 2);
  const label = LABELS[category] ?? category.replace(/_/g, " ");
  return detail ? `${label} (${detail.toUpperCase()})` : label;
}
