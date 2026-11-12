/**
 * Local HTTP file server for serving image/video files to the CEF webview.
 *
 * The views:// protocol used by Electrobun blocks file:// subresource loads
 * (Chromium same-origin policy). This server provides an http://localhost
 * endpoint that the webview can use to load local files.
 *
 * Endpoints:
 *   GET /file?path=...       — Serve a local file (image or video)
 *   GET /thumbnail?path=...&time=N — Serve a JPEG frame from a video at time N (default 1s)
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { getAppDataPath } from "@giggle-photos/core/config/app-paths";
import { getLogger } from "@giggle-photos/core/logging/logger";
import { $ } from "bun";

const log = getLogger("desktop:file-server");

/** MIME types for supported image/video extensions */
const MIME_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  bmp: "image/bmp",
  tiff: "image/tiff",
  tif: "image/tiff",
  svg: "image/svg+xml",
  ico: "image/x-icon",
  heic: "image/heic",
  heif: "image/heif",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  avi: "video/x-msvideo",
  mkv: "video/x-matroska",
};

function getMimeType(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  return MIME_TYPES[ext] ?? "application/octet-stream";
}

// ---------------------------------------------------------------------------
// Thumbnail cache
// ---------------------------------------------------------------------------

let thumbnailCacheDir: string | null = null;

/** In-flight thumbnail generation promises (dedup concurrent requests for same file) */
const inFlightThumbnails = new Map<string, Promise<string | null>>();

function getThumbnailCacheDir(): string {
  if (!thumbnailCacheDir) {
    thumbnailCacheDir = join(getAppDataPath(), "thumbnails");
    if (!existsSync(thumbnailCacheDir)) {
      mkdirSync(thumbnailCacheDir, { recursive: true });
    }
  }
  return thumbnailCacheDir;
}

function thumbnailCacheKey(videoPath: string, time: number): string {
  const hash = createHash("sha256").update(videoPath).digest("hex");
  // Include time in cache key (default 1s has no suffix for backward compat)
  const suffix = time === 1 ? "" : `_t${time.toFixed(2)}`;
  return join(getThumbnailCacheDir(), `${hash}${suffix}.jpg`);
}

/**
 * Extract a JPEG frame from a video at the given time using ffmpeg.
 * Returns the path to the cached JPEG, or null on failure.
 */
async function generateThumbnail(videoPath: string, time = 1): Promise<string | null> {
  const cachePath = thumbnailCacheKey(videoPath, time);

  // Check cache first
  if (existsSync(cachePath)) {
    return cachePath;
  }

  // Dedup key includes time
  const dedupKey = `${videoPath}@${time}`;
  const existing = inFlightThumbnails.get(dedupKey);
  if (existing) return existing;

  const work = (async () => {
    try {
      const timeStr = time.toFixed(3);
      const result = await $`ffmpeg -y -i ${videoPath} -ss ${timeStr} -vframes 1 ${cachePath}`.quiet();
      if (result.exitCode === 0 && existsSync(cachePath)) {
        return cachePath;
      }

      // Fallback: try at 0 seconds (video might be shorter than requested time)
      if (time > 0) {
        const fallback = await $`ffmpeg -y -i ${videoPath} -vframes 1 ${cachePath}`.quiet();
        if (fallback.exitCode === 0 && existsSync(cachePath)) {
          return cachePath;
        }
      }

      log.warn("ffmpeg thumbnail extraction failed", { videoPath, time });
      return null;
    } catch (error) {
      log.warn("ffmpeg not available or failed for thumbnail", { videoPath, time, error });
      return null;
    } finally {
      inFlightThumbnails.delete(dedupKey);
    }
  })();

  inFlightThumbnails.set(dedupKey, work);
  return work;
}

// ---------------------------------------------------------------------------
// Request handlers
// ---------------------------------------------------------------------------

function handleFileRequest(filePath: string): Response {
  const file = Bun.file(filePath);
  const mimeType = getMimeType(filePath);

  return new Response(file, {
    headers: {
      "Content-Type": mimeType,
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=3600",
    },
  });
}

async function handleThumbnailRequest(filePath: string, time = 1): Promise<Response> {
  const result = await generateThumbnail(filePath, time);
  if (!result) {
    return new Response("Thumbnail generation failed", { status: 500 });
  }

  return new Response(Bun.file(result), {
    headers: {
      "Content-Type": "image/jpeg",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=86400",
    },
  });
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

let serverPort: number | null = null;

/**
 * Start the local file server on a random available port.
 * Returns the port number.
 */
export async function startFileServer(): Promise<number> {
  if (serverPort !== null) {
    return serverPort;
  }

  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(req) {
      const url = new URL(req.url);
      const filePath = url.searchParams.get("path");

      if (url.pathname !== "/file" && url.pathname !== "/thumbnail") {
        return new Response("Not found", { status: 404 });
      }

      if (!filePath) {
        return new Response("Missing path parameter", { status: 400 });
      }

      // Only serve absolute paths
      if (!filePath.startsWith("/")) {
        return new Response("Path must be absolute", { status: 400 });
      }

      if (url.pathname === "/thumbnail") {
        const timeParam = url.searchParams.get("time");
        const time = timeParam ? Number.parseFloat(timeParam) : 1;
        return handleThumbnailRequest(filePath, Number.isFinite(time) ? time : 1);
      }

      return handleFileRequest(filePath);
    },
  });

  serverPort = server.port ?? 0;
  log.info("File server started", { port: serverPort });
  return serverPort;
}

/**
 * Get the file server port. Returns null if the server hasn't started.
 */
export function getFileServerPort(): number | null {
  return serverPort;
}
