/**
 * Benchmark the full processing pipeline on the fixed sample (RFD-002 "before"/"after" numbers).
 *
 *   bun packages/core/src/bench/run-bench.ts [sampleDir] --label=before [--concurrency=4] [--out=dir]
 *
 * Runs against a fresh throwaway database, so it never touches the real app data. Records wall
 * time per stage, the pipeline's own per-bucket *Ms averages (StageTimer), CPU time and peak RSS
 * of the main process and of each child process (the sharp worker in particular).
 * Wall time is load-sensitive; compare CPU time when the machine is busy.
 */
import { execSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { cpus, homedir, loadavg, tmpdir } from "node:os";
import { join } from "node:path";
import { ChildSampler } from "./proc-stats";
import { writeOut } from "./sample-images";

const argv = process.argv.slice(2);
const flag = (name: string) => argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
const cacheDir = join(homedir(), ".cache", "giggle-photos");
const sampleDir = argv.find((a) => !a.startsWith("--")) ?? join(cacheDir, "bench-sample");
const label = flag("label") ?? "run";
const concurrency = Number(flag("concurrency") ?? 4);
const outDir = flag("out") ?? join(cacheDir, "bench-results");

// Isolate all app data in a temp dir BEFORE core modules read the environment.
const dataDir = await mkdtemp(join(tmpdir(), "giggle-bench-"));
process.env.APP_DATA_PATH = dataDir;
process.env.DATABASE_PATH = join(dataDir, "app.db");
process.env.LOG_LEVEL ??= "warn";

const { DatabaseProvider } = await import("../db/database-provider");
const { runPipeline } = await import("../scan/processing-pipeline");
const { shutdownSharpProcess } = await import("../scan/sharp-process");
type Progress = Parameters<NonNullable<Parameters<typeof runPipeline>[0]>["onProgress"] & object>[0];

const db = await DatabaseProvider.getInstance();
await db.getScanFolderProvider().insertScanFolder({ path: sampleDir });

const sampler = new ChildSampler();
sampler.start();
const stageWallMs: Record<string, number> = {};
let currentStage = "";
let stageStart = performance.now();
let last: Progress | null = null;
const cpu0 = process.cpuUsage();
const t0 = performance.now();

const result = await runPipeline({
  hashConcurrency: concurrency,
  onProgress: (p) => {
    if (p.stage !== currentStage) {
      const now = performance.now();
      if (currentStage) stageWallMs[currentStage] = (stageWallMs[currentStage] ?? 0) + now - stageStart;
      currentStage = p.stage;
      stageStart = now;
    }
    last = p;
  },
});

const wallMs = performance.now() - t0;
if (currentStage) stageWallMs[currentStage] = (stageWallMs[currentStage] ?? 0) + performance.now() - stageStart;
const children = sampler.stop();
const cpu = process.cpuUsage(cpu0);
shutdownSharpProcess();
db.getClient().close();

const gitRev = (() => {
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf-8" }).trim();
  } catch {
    return "unknown";
  }
})();
const manifest = await readFile(join(sampleDir, "..", "bench-sample.manifest.json"), "utf-8")
  .then((s) => JSON.parse(s) as unknown)
  .catch(() => null);

const report = {
  label,
  date: new Date().toISOString(),
  gitRev,
  machine: {
    platform: process.platform,
    arch: process.arch,
    cpus: cpus().length,
    cpuModel: cpus()[0]?.model ?? "unknown",
    loadavgAtEnd: loadavg(),
    bun: Bun.version,
  },
  options: { concurrency },
  sample: { dir: sampleDir, manifest },
  result,
  wallMs: Math.round(wallMs),
  stageWallMs: Object.fromEntries(Object.entries(stageWallMs).map(([k, v]) => [k, Math.round(v)])),
  stageStats: (last as Progress | null)?.stageStats ?? null,
  main: { cpuMs: Math.round((cpu.user + cpu.system) / 1000), peakRssKb: process.resourceUsage().maxRSS },
  children: children.sort((a, b) => b.cpuMs - a.cpuMs),
};

const outPath = join(outDir, `${label}-${report.date.replace(/[:.]/g, "-")}.json`);
await writeOut(outPath, Buffer.from(JSON.stringify(report, null, 2)));
await rm(dataDir, { recursive: true, force: true });

const worker = report.children.find((c) => c.command.includes("sharp-worker"));
process.stdout.write(
  [
    `${label} @ ${gitRev}: ${result.totalFiles} files, ${result.errors} errors, wall ${(wallMs / 1000).toFixed(1)} s`,
    `stages (wall s): ${Object.entries(report.stageWallMs)
      .map(([k, v]) => `${k}=${(v / 1000).toFixed(1)}`)
      .join(" ")}`,
    `main: cpu ${(report.main.cpuMs / 1000).toFixed(1)} s, peak RSS ${(report.main.peakRssKb / 1024).toFixed(0)} MB`,
    worker
      ? `sharp worker: cpu ${(worker.cpuMs / 1000).toFixed(1)} s, peak RSS ${(worker.peakRssKb / 1024).toFixed(0)} MB`
      : "sharp worker: not sampled",
    `load avg at end: ${report.machine.loadavgAtEnd.map((l) => l.toFixed(1)).join(" ")}`,
    `report: ${outPath}`,
    "",
  ].join("\n"),
);
process.exit(0);
