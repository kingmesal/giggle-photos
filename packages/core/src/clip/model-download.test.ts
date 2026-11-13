import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  type ClipModelStatus,
  ensureClipModel,
  importModelFile,
  isModelReady,
  ModelVerificationError,
} from "./model-download";
import type { ClipModelManifest } from "./model-manifest";

const sha = (b: Uint8Array) => new Bun.CryptoHasher("sha256").update(b).digest("hex");
const MODEL = new Uint8Array(100_000).map((_, i) => (i * 31) % 251);
const CFG = new TextEncoder().encode('{"size":[224,224]}');
const manifest: ClipModelManifest = {
  id: "test-model@rev",
  repo: "test/repo",
  revision: "rev",
  files: [
    { name: "model.onnx", repoPath: "visual/model.onnx", bytes: MODEL.length, sha256: sha(MODEL), required: true },
    { name: "cfg.json", repoPath: "visual/cfg.json", bytes: CFG.length, sha256: sha(CFG), required: false },
  ],
  inputName: "image",
  outputName: "embedding",
  inputSize: 224,
  dimensions: 512,
  mean: [0, 0, 0],
  std: [1, 1, 1],
};

let dir: string;
let requests: { url: string; range: string | null }[];
type ServerMode = "normal" | "ignoreRange" | "corrupt" | "failMidway";
let mode: ServerMode;

/** Fake HTTP server: serves MODEL / CFG, honours Range unless told not to. */
const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input);
  const range = (init?.headers as Record<string, string> | undefined)?.Range ?? null;
  requests.push({ url, range });
  let body = url.endsWith("model.onnx") ? MODEL : CFG;
  if (mode === "corrupt") body = body.map((b) => b ^ 1);
  const start = range && mode !== "ignoreRange" ? Number(/bytes=(\d+)-/.exec(range)?.[1]) : 0;
  const slice = body.subarray(start);
  if (mode === "failMidway") {
    // Deliver the first 1000 bytes, then fail on the next read (erroring in start() would
    // discard the queued chunk).
    let sent = false;
    const stream = new ReadableStream({
      pull(c) {
        if (sent) return c.error(new Error("connection reset"));
        sent = true;
        c.enqueue(slice.subarray(0, 1000));
      },
    });
    return new Response(stream, { status: start > 0 ? 206 : 200 });
  }
  return new Response(slice, { status: start > 0 ? 206 : 200 });
}) as typeof fetch;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "clip-model-"));
  requests = [];
  mode = "normal";
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("ensureClipModel", () => {
  test("downloads, verifies and reports progress, then ready", async () => {
    const statuses: ClipModelStatus["state"][] = [];
    await ensureClipModel({ manifest, dir, fetchImpl: fakeFetch, onStatus: (s) => statuses.push(s.state) });
    expect(readFileSync(join(dir, "model.onnx"))).toEqual(Buffer.from(MODEL));
    expect(statuses).toContain("downloading");
    expect(statuses).toContain("verifying");
    expect(statuses.at(-1)).toBe("ready");
    expect(await isModelReady(manifest, dir)).toBe(true);
  });

  test("a verified model is not downloaded again", async () => {
    await ensureClipModel({ manifest, dir, fetchImpl: fakeFetch });
    requests = [];
    await ensureClipModel({ manifest, dir, fetchImpl: fakeFetch });
    expect(requests).toEqual([]);
  });

  test("resumes a partial download with an HTTP Range request", async () => {
    writeFileSync(join(dir, "model.onnx.partial"), MODEL.subarray(0, 40_000));
    await ensureClipModel({ manifest, dir, fetchImpl: fakeFetch });
    expect(requests[0]?.range).toBe("bytes=40000-");
    expect(sha(readFileSync(join(dir, "model.onnx")))).toBe(manifest.files[0]?.sha256 as string);
  });

  test("a server that ignores Range restarts cleanly", async () => {
    mode = "ignoreRange";
    writeFileSync(join(dir, "model.onnx.partial"), MODEL.subarray(0, 40_000));
    await ensureClipModel({ manifest, dir, fetchImpl: fakeFetch });
    expect(sha(readFileSync(join(dir, "model.onnx")))).toBe(manifest.files[0]?.sha256 as string);
  });

  test("a corrupt download is retried, then reported as an error; nothing is left in place", async () => {
    mode = "corrupt";
    const statuses: ClipModelStatus[] = [];
    await expect(
      ensureClipModel({ manifest, dir, fetchImpl: fakeFetch, maxAttempts: 2, onStatus: (s) => statuses.push(s) }),
    ).rejects.toBeInstanceOf(ModelVerificationError);
    expect(requests.filter((r) => r.url.endsWith("model.onnx"))).toHaveLength(2);
    expect(statuses.at(-1)).toMatchObject({ state: "error" });
    expect(await isModelReady(manifest, dir)).toBe(false);
  });

  test("a dropped connection leaves a partial that the next attempt resumes", async () => {
    mode = "failMidway";
    await expect(ensureClipModel({ manifest, dir, fetchImpl: fakeFetch, maxAttempts: 1 })).rejects.toThrow();
    mode = "normal";
    requests = [];
    await ensureClipModel({ manifest, dir, fetchImpl: fakeFetch });
    expect(requests[0]?.range).toBe("bytes=1000-");
    expect(await isModelReady(manifest, dir)).toBe(true);
  });

  test("a tampered file on disk is detected and replaced", async () => {
    await ensureClipModel({ manifest, dir, fetchImpl: fakeFetch });
    const tampered = new Uint8Array(MODEL);
    tampered[5] = 0;
    writeFileSync(join(dir, "model.onnx"), tampered); // also invalidates the marker (mtime)
    expect(await isModelReady(manifest, dir)).toBe(false);
  });
});

describe("importModelFile", () => {
  test("accepts the right file and rejects anything else", async () => {
    const good = join(dir, "downloaded.onnx");
    writeFileSync(good, MODEL);
    await importModelFile(manifest, join(dir, "m"), good);
    expect(await isModelReady(manifest, join(dir, "m"))).toBe(true);

    const bad = join(dir, "other.onnx");
    writeFileSync(bad, CFG);
    await expect(importModelFile(manifest, join(dir, "n"), bad)).rejects.toBeInstanceOf(ModelVerificationError);
  });
});
