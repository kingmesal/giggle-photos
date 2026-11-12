/**
 * Lightweight timer utility for collecting per-bucket timing statistics.
 */

export interface TimerStats {
  count: number;
  totalMs: number;
  avgMs: number;
  minMs: number;
  maxMs: number;
}

/**
 * Collects timing measurements into named buckets and computes statistics.
 *
 * @example
 * const timer = new StageTimer();
 * const stop = timer.start("sha256");
 * await computeSha256(file);
 * stop();
 * console.log(timer.getStats("sha256")); // { count: 1, totalMs: 12, avgMs: 12, minMs: 12, maxMs: 12 }
 */
export class StageTimer {
  private buckets = new Map<string, number[]>();

  /** Start a named timer. Returns a stop function that records the elapsed time. */
  start(name: string): () => void {
    const t0 = performance.now();
    return () => {
      this.record(name, performance.now() - t0);
    };
  }

  /** Manually record a duration (e.g. from a child process that reports its own timing). */
  record(name: string, durationMs: number): void {
    let bucket = this.buckets.get(name);
    if (!bucket) {
      bucket = [];
      this.buckets.set(name, bucket);
    }
    bucket.push(durationMs);
  }

  /** Get statistics for a single bucket. Returns null if the bucket has no entries. */
  getStats(name: string): TimerStats | null {
    const bucket = this.buckets.get(name);
    if (!bucket || bucket.length === 0) return null;
    const totalMs = bucket.reduce((sum, v) => sum + v, 0);
    return {
      count: bucket.length,
      totalMs,
      avgMs: totalMs / bucket.length,
      minMs: Math.min(...bucket),
      maxMs: Math.max(...bucket),
    };
  }

  /** Get statistics for all buckets. */
  getAllStats(): Record<string, TimerStats> {
    const result: Record<string, TimerStats> = {};
    for (const [name] of this.buckets) {
      const stats = this.getStats(name);
      if (stats) result[name] = stats;
    }
    return result;
  }

  /** Get the average duration for a bucket, or null if empty. */
  getAverage(name: string): number | null {
    const stats = this.getStats(name);
    return stats ? stats.avgMs : null;
  }

  /** Get the number of recordings in a bucket. */
  getCount(name: string): number {
    return this.buckets.get(name)?.length ?? 0;
  }
}

/**
 * Format a duration in milliseconds to a human-readable string.
 *
 * @example
 * formatDuration(500)    // "< 1s"
 * formatDuration(2300)   // "2.3s"
 * formatDuration(74000)  // "1m 14s"
 * formatDuration(3661000) // "61m 1s"
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return "< 1s";
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) {
    const tenths = Math.floor((ms % 1000) / 100);
    return tenths > 0 ? `${totalSeconds}.${tenths}s` : `${totalSeconds}s`;
  }
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
}
