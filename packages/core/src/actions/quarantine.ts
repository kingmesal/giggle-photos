// ⚠️ FRAGILE: See _FRAGILE.md — moves files out of the user's library.
/**
 * Quarantine instead of deleting (RFD-003 §F): a removed file moves to
 * `<quarantineRoot>/<path relative to its scan folder>`, outside the Takeout tree, so the Takeout
 * layout immich-go reads stays intact and any mistake can be undone. Every move is appended to
 * `<quarantineRoot>/quarantine-manifest.jsonl`; `restoreQuarantine` moves files back.
 */
import { appendFile, copyFile, mkdir, readFile, rename, stat, unlink } from "node:fs/promises";
import { dirname, isAbsolute, join, relative } from "node:path";
import { getAppDataPath } from "../config/app-paths";
import type { AppSettings } from "../config/user-config";

export const MANIFEST_NAME = "quarantine-manifest.jsonl";

/** Quarantine folder from settings, or null when quarantine is turned off. */
export function resolveQuarantineRoot(
  settings: Pick<AppSettings, "quarantineEnabled" | "quarantinePath">,
): string | null {
  if (!settings.quarantineEnabled) return null;
  return settings.quarantinePath.trim() || join(getAppDataPath(), "quarantine");
}

export interface QuarantineEntry {
  at: string;
  from: string;
  to: string;
  kind: "media" | "sidecar";
}

const exists = async (path: string) =>
  stat(path).then(
    () => true,
    () => false,
  );

/** Destination for `source` inside the quarantine; refuses paths outside the scan folder. */
export function quarantinePath(quarantineRoot: string, scanFolderPath: string, source: string): string {
  const rel = relative(scanFolderPath, source);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(`${source} is not inside its scan folder ${scanFolderPath}`);
  }
  return join(quarantineRoot, rel);
}

/** Move one file, never overwriting. Falls back to copy + verify + unlink across filesystems. */
async function moveFile(from: string, to: string): Promise<void> {
  if (await exists(to)) throw new Error(`Already in quarantine: ${to}`);
  await mkdir(dirname(to), { recursive: true });
  try {
    await rename(from, to);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
    await copyFile(from, to);
    const [a, b] = await Promise.all([stat(from), stat(to)]);
    if (a.size !== b.size) {
      await unlink(to);
      throw new Error(`Copy to quarantine was incomplete for ${from}`);
    }
    await unlink(from);
  }
}

/** Move a file into quarantine and record it in the manifest. Returns the destination. */
export async function quarantineFile(
  quarantineRoot: string,
  scanFolderPath: string,
  source: string,
  kind: QuarantineEntry["kind"],
): Promise<string> {
  const to = quarantinePath(quarantineRoot, scanFolderPath, source);
  await moveFile(source, to);
  const entry: QuarantineEntry = { at: new Date().toISOString(), from: source, to, kind };
  await appendFile(join(quarantineRoot, MANIFEST_NAME), `${JSON.stringify(entry)}\n`);
  return to;
}

/**
 * Move quarantined files back to where they came from (newest first). Entries whose destination is
 * gone or whose original path is occupied again are reported, not overwritten.
 */
export async function restoreQuarantine(quarantineRoot: string): Promise<{ restored: number; problems: string[] }> {
  const text = await readFile(join(quarantineRoot, MANIFEST_NAME), "utf-8").catch(() => "");
  const entries = text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as QuarantineEntry)
    .reverse();
  const problems: string[] = [];
  let restored = 0;
  for (const e of entries) {
    if (!(await exists(e.to))) continue; // already restored or removed by hand
    if (await exists(e.from)) {
      problems.push(`Not restored (original path is occupied): ${e.from}`);
      continue;
    }
    try {
      await moveFile(e.to, e.from);
      restored++;
    } catch (error) {
      problems.push(`${e.from}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { restored, problems };
}
