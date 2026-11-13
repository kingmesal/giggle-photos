/**
 * Child-process resource sampling for the benchmark (peak RSS, CPU time).
 * Linux reads /proc (exact peak via VmHWM); macOS falls back to `ps` polling (peak of samples).
 * Windows is not supported (returns no samples).
 */

import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";

export type ProcSample = { pid: number; command: string; peakRssKb: number; cpuMs: number };

const CLOCK_TICKS_PER_SEC = 100; // USER_HZ on Linux

/** PIDs whose parent is `ppid`. */
export function childPids(ppid: number): number[] {
  if (process.platform === "linux") {
    const pids: number[] = [];
    for (const entry of readdirSync("/proc")) {
      if (!/^\d+$/.test(entry)) continue;
      try {
        const stat = readFileSync(`/proc/${entry}/stat`, "utf-8");
        // Fields after the ")" that closes the command name: state ppid ...
        const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
        if (Number(fields[1]) === ppid) pids.push(Number(entry));
      } catch {
        // Process exited between readdir and read.
      }
    }
    return pids;
  }
  if (process.platform === "darwin") {
    const out = spawnSync("pgrep", ["-P", String(ppid)], { encoding: "utf-8" }).stdout ?? "";
    return out.split("\n").filter(Boolean).map(Number);
  }
  return [];
}

/** One sample of a process, or null if it has exited / platform unsupported. */
export function sampleProcess(pid: number): ProcSample | null {
  try {
    if (process.platform === "linux") {
      const status = readFileSync(`/proc/${pid}/status`, "utf-8");
      const hwm = Number(/VmHWM:\s+(\d+)/.exec(status)?.[1] ?? 0);
      const stat = readFileSync(`/proc/${pid}/stat`, "utf-8");
      const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
      // utime and stime are fields 14 and 15 overall (indexes 11 and 12 after the comm field).
      const ticks = Number(fields[11]) + Number(fields[12]);
      const command = readFileSync(`/proc/${pid}/cmdline`, "utf-8").split("\0").filter(Boolean).slice(-1)[0] ?? "";
      return { pid, command, peakRssKb: hwm, cpuMs: (ticks / CLOCK_TICKS_PER_SEC) * 1000 };
    }
    if (process.platform === "darwin") {
      const out = spawnSync("ps", ["-o", "rss=,time=,command=", "-p", String(pid)], {
        encoding: "utf-8",
      }).stdout?.trim();
      if (!out) return null;
      const [rss, time, ...cmd] = out.split(/\s+/);
      const [min, sec] = (time ?? "0:0").split(":").map(Number);
      const command = cmd.slice(-1)[0] ?? "";
      return { pid, command, peakRssKb: Number(rss), cpuMs: ((min ?? 0) * 60 + (sec ?? 0)) * 1000 };
    }
  } catch {
    // Process exited.
  }
  return null;
}

/**
 * Polls children of this process, keeping the latest sample per PID with the peak RSS seen.
 * Short-lived children (ffprobe/ffmpeg) are only partly captured; the long-lived sharp worker fully.
 */
export class ChildSampler {
  private samples = new Map<number, ProcSample>();
  private timer: ReturnType<typeof setInterval> | null = null;

  start(intervalMs = 200): void {
    this.timer = setInterval(() => this.poll(), intervalMs);
  }

  poll(): void {
    for (const pid of childPids(process.pid)) {
      const sample = sampleProcess(pid);
      if (!sample) continue;
      const prev = this.samples.get(pid);
      // An exited (zombie) child reports an empty command and zero memory: keep what we saw alive.
      this.samples.set(pid, {
        pid,
        command: sample.command || prev?.command || "",
        peakRssKb: Math.max(sample.peakRssKb, prev?.peakRssKb ?? 0),
        cpuMs: Math.max(sample.cpuMs, prev?.cpuMs ?? 0),
      });
    }
  }

  stop(): ProcSample[] {
    if (this.timer) clearInterval(this.timer);
    this.poll();
    return [...this.samples.values()];
  }
}
