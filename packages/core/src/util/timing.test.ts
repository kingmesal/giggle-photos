import { describe, expect, test } from "bun:test";
import { formatDuration, StageTimer } from "./timing";

describe("StageTimer", () => {
  test("start/stop records duration", () => {
    const timer = new StageTimer();
    const stop = timer.start("test");
    // Simulate some work
    const start = performance.now();
    while (performance.now() - start < 5) {
      /* busy wait ~5ms */
    }
    stop();

    const stats = timer.getStats("test");
    expect(stats).not.toBeNull();
    expect(stats?.count).toBe(1);
    expect(stats?.totalMs).toBeGreaterThan(0);
    expect(stats?.avgMs).toBe(stats?.totalMs);
    expect(stats?.minMs).toBe(stats?.totalMs);
    expect(stats?.maxMs).toBe(stats?.totalMs);
  });

  test("record() manually records duration", () => {
    const timer = new StageTimer();
    timer.record("manual", 10);
    timer.record("manual", 20);
    timer.record("manual", 30);

    const stats = timer.getStats("manual");
    expect(stats).not.toBeNull();
    expect(stats?.count).toBe(3);
    expect(stats?.totalMs).toBe(60);
    expect(stats?.avgMs).toBe(20);
    expect(stats?.minMs).toBe(10);
    expect(stats?.maxMs).toBe(30);
  });

  test("getStats returns null for unknown bucket", () => {
    const timer = new StageTimer();
    expect(timer.getStats("unknown")).toBeNull();
  });

  test("getAverage returns average or null", () => {
    const timer = new StageTimer();
    expect(timer.getAverage("empty")).toBeNull();

    timer.record("test", 10);
    timer.record("test", 30);
    expect(timer.getAverage("test")).toBe(20);
  });

  test("getCount returns 0 for unknown bucket", () => {
    const timer = new StageTimer();
    expect(timer.getCount("unknown")).toBe(0);
  });

  test("getCount returns correct count", () => {
    const timer = new StageTimer();
    timer.record("a", 5);
    timer.record("a", 10);
    expect(timer.getCount("a")).toBe(2);
  });

  test("getAllStats returns stats for all buckets", () => {
    const timer = new StageTimer();
    timer.record("a", 10);
    timer.record("b", 20);
    timer.record("b", 40);

    const all = timer.getAllStats();
    expect(Object.keys(all)).toHaveLength(2);
    expect(all.a?.count).toBe(1);
    expect(all.a?.avgMs).toBe(10);
    expect(all.b?.count).toBe(2);
    expect(all.b?.avgMs).toBe(30);
  });

  test("multiple buckets are independent", () => {
    const timer = new StageTimer();
    timer.record("sha256", 5);
    timer.record("phash", 100);

    expect(timer.getAverage("sha256")).toBe(5);
    expect(timer.getAverage("phash")).toBe(100);
  });
});

describe("formatDuration", () => {
  test("sub-second shows < 1s", () => {
    expect(formatDuration(0)).toBe("< 1s");
    expect(formatDuration(500)).toBe("< 1s");
    expect(formatDuration(999)).toBe("< 1s");
  });

  test("seconds with tenths", () => {
    expect(formatDuration(2300)).toBe("2.3s");
    expect(formatDuration(1100)).toBe("1.1s");
  });

  test("whole seconds without tenths", () => {
    expect(formatDuration(5000)).toBe("5s");
    expect(formatDuration(5050)).toBe("5s"); // rounds down tenths
  });

  test("minutes and seconds", () => {
    expect(formatDuration(74000)).toBe("1m 14s");
    expect(formatDuration(60000)).toBe("1m");
    expect(formatDuration(120000)).toBe("2m");
    expect(formatDuration(125000)).toBe("2m 5s");
  });
});
