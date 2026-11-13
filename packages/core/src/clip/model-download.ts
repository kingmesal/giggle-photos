/**
 * First-run download and verification of the CLIP model (RFD-002 §C).
 *
 * Each file streams to `<name>.partial`, resumes with an HTTP Range request (a server that ignores
 * Range restarts cleanly), is verified against its pinned SHA-256, then atomically renamed into place.
 * A failed hash deletes the partial and retries; repeated failure ends in an `error` status the UI can
 * offer a retry for. A `<name>.verified` marker (sha, size, mtime) avoids re-hashing 352 MB on every
 * launch. Offline installs can import a manually downloaded file, verified against the same hash.
 */
import { copyFile, mkdir, open, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type ClipModelManifest, type ModelFile, modelFileUrl } from "./model-manifest";

export type ClipModelStatus =
  | { state: "missing" }
  | { state: "downloading"; file: string; receivedBytes: number; totalBytes: number }
  | { state: "verifying"; file: string }
  | { state: "ready"; dir: string }
  | { state: "error"; message: string };

export interface ModelDownloadOptions {
  manifest: ClipModelManifest;
  /** Directory holding this model's files. */
  dir: string;
  fetchImpl?: typeof fetch;
  onStatus?: (status: ClipModelStatus) => void;
  signal?: AbortSignal;
  /** Attempts per file before giving up (default 3). */
  maxAttempts?: number;
}

export class ModelVerificationError extends Error {}

const sizeOf = async (path: string): Promise<number | null> => {
  try {
    return (await stat(path)).size;
  } catch {
    return null;
  }
};

/** Read a stream chunk by chunk (explicit reader: DOM typings lack async iteration). */
async function forEachChunk(
  stream: ReadableStream<Uint8Array>,
  onChunk: (chunk: Uint8Array) => unknown | Promise<unknown>,
): Promise<void> {
  const reader = stream.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      await onChunk(value);
    }
  } finally {
    reader.releaseLock();
  }
}

/** Streaming SHA-256 of a file (never loads 352 MB at once). */
export async function sha256OfFile(path: string): Promise<string> {
  const hasher = new Bun.CryptoHasher("sha256");
  await forEachChunk(Bun.file(path).stream(), (chunk) => hasher.update(chunk));
  return hasher.digest("hex");
}

const markerContent = async (path: string, file: ModelFile) =>
  `${file.sha256} ${file.bytes} ${(await stat(path)).mtimeMs}`;

/** True when `dir/file` exists with the expected hash (trusting a fresh marker). Removes a corrupt file. */
export async function isFileVerified(dir: string, file: ModelFile): Promise<boolean> {
  const path = join(dir, file.name);
  if ((await sizeOf(path)) !== file.bytes) return false;
  const marker = join(dir, `${file.name}.verified`);
  const expected = await markerContent(path, file);
  if ((await Bun.file(marker).exists()) && (await Bun.file(marker).text()) === expected) return true;
  if ((await sha256OfFile(path)) !== file.sha256) {
    await rm(path, { force: true });
    return false;
  }
  await writeFile(marker, expected);
  return true;
}

/** Ready when every required file is present and verified. */
export async function isModelReady(manifest: ClipModelManifest, dir: string): Promise<boolean> {
  for (const file of manifest.files.filter((f) => f.required)) {
    if (!(await isFileVerified(dir, file))) return false;
  }
  return true;
}

async function downloadToPartial(url: string, partial: string, file: ModelFile, options: ModelDownloadOptions) {
  const fetchImpl = options.fetchImpl ?? fetch;
  let start = (await sizeOf(partial)) ?? 0;
  if (start > file.bytes) {
    await rm(partial, { force: true });
    start = 0;
  }
  if (start === file.bytes) return;
  const response = await fetchImpl(url, {
    headers: start > 0 ? { Range: `bytes=${start}-` } : {},
    signal: options.signal,
    redirect: "follow",
  });
  if (response.status !== 200 && response.status !== 206) throw new Error(`HTTP ${response.status} for ${url}`);
  if (response.status === 200) start = 0; // server ignored Range: restart
  if (!response.body) throw new Error(`Empty response for ${url}`);

  const handle = await open(partial, start === 0 ? "w" : "a");
  let received = start;
  try {
    await forEachChunk(response.body, async (chunk) => {
      await handle.write(chunk);
      received += chunk.byteLength;
      options.onStatus?.({ state: "downloading", file: file.name, receivedBytes: received, totalBytes: file.bytes });
    });
  } finally {
    await handle.close();
  }
}

async function fetchFile(file: ModelFile, options: ModelDownloadOptions): Promise<void> {
  const { manifest, dir } = options;
  const partial = join(dir, `${file.name}.partial`);
  const maxAttempts = options.maxAttempts ?? 3;
  let lastError = "";
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await downloadToPartial(modelFileUrl(manifest, file), partial, file, options);
      options.onStatus?.({ state: "verifying", file: file.name });
      const hash = await sha256OfFile(partial);
      if (hash === file.sha256 && (await sizeOf(partial)) === file.bytes) {
        await rename(partial, join(dir, file.name));
        await writeFile(join(dir, `${file.name}.verified`), await markerContent(join(dir, file.name), file));
        return;
      }
      lastError = `SHA-256 mismatch for ${file.name} (got ${hash.slice(0, 12)}…)`;
      await rm(partial, { force: true });
    } catch (error) {
      if (options.signal?.aborted) throw error;
      lastError = error instanceof Error ? error.message : String(error);
    }
  }
  throw new ModelVerificationError(`${file.name}: ${lastError} after ${maxAttempts} attempts`);
}

/**
 * Make sure the model is downloaded and verified. Resolves with the directory when ready;
 * rejects (after reporting an `error` status) when a required file cannot be obtained.
 */
export async function ensureClipModel(options: ModelDownloadOptions): Promise<string> {
  const { manifest, dir } = options;
  await mkdir(dir, { recursive: true });
  for (const file of manifest.files) {
    if (await isFileVerified(dir, file)) continue;
    try {
      await fetchFile(file, options);
    } catch (error) {
      if (!file.required && !options.signal?.aborted) continue; // best-effort file
      const message = error instanceof Error ? error.message : String(error);
      options.onStatus?.({ state: "error", message });
      throw error;
    }
  }
  options.onStatus?.({ state: "ready", dir });
  return dir;
}

/** Import a manually downloaded ONNX file (offline installs), verified against the pinned hash. */
export async function importModelFile(manifest: ClipModelManifest, dir: string, sourcePath: string): Promise<void> {
  const target = manifest.files.find((f) => f.required);
  if (!target) throw new Error(`Manifest ${manifest.id} has no required file`);
  const hash = await sha256OfFile(sourcePath);
  if (hash !== target.sha256) {
    throw new ModelVerificationError(`This is not the expected model file (SHA-256 ${hash.slice(0, 12)}…)`);
  }
  await mkdir(dir, { recursive: true });
  const partial = join(dir, `${target.name}.partial`);
  await copyFile(sourcePath, partial);
  await rename(partial, join(dir, target.name));
  await writeFile(join(dir, `${target.name}.verified`), await markerContent(join(dir, target.name), target));
}
