/**
 * Find a command-line tool (ffmpeg, ffprobe) by name. Apps started from a desktop menu or Finder
 * often get a minimal PATH (macOS: no Homebrew), so after PATH the usual install folders are
 * searched too. Results are cached; `null` means not installed anywhere we know.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";

const UNIX_DIRS = ["/usr/bin", "/usr/local/bin", "/opt/homebrew/bin", "/opt/local/bin", "/snap/bin", "/bin"];
const WINDOWS_DIRS = [
  "C:\\ffmpeg\\bin",
  "C:\\Program Files\\ffmpeg\\bin",
  join(process.env.LOCALAPPDATA ?? "", "Microsoft", "WinGet", "Links"),
  join(process.env.USERPROFILE ?? "", "scoop", "shims"),
  "C:\\ProgramData\\chocolatey\\bin",
];

const cache = new Map<string, string | null>();

/** Absolute path of `name`, or null. `platform` and `exists` are injectable for tests. */
export function findTool(
  name: string,
  options: {
    platform?: NodeJS.Platform;
    exists?: (path: string) => boolean;
    which?: (n: string) => string | null;
  } = {},
): string | null {
  const platform = options.platform ?? process.platform;
  const exists = options.exists ?? existsSync;
  const which = options.which ?? ((n: string) => Bun.which(n));
  const key = `${platform}:${name}`;
  if (!options.exists && cache.has(key)) return cache.get(key) ?? null;
  const exe = platform === "win32" ? `${name}.exe` : name;
  const found =
    which(name) ??
    (platform === "win32" ? WINDOWS_DIRS : UNIX_DIRS).map((d) => join(d, exe)).find((p) => exists(p)) ??
    null;
  if (!options.exists) cache.set(key, found);
  return found;
}

/** Forget cached lookups (after the person installs a tool, or in tests). */
export function resetToolCache(): void {
  cache.clear();
}
