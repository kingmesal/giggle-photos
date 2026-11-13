// ⚠️ FRAGILE: See _FRAGILE.md — permanently deletes or trashes files.
/** Trash / permanent delete of one file (moved unchanged from applyDecisions.ts). */
import { unlink } from "node:fs/promises";
import { getTrashAvailability } from "../config/user-config";
import { getLogger } from "../logging/logger";

const log = getLogger("core:actions");

/**
 * Attempts to move a file to the system trash using the best available command.
 * Uses `getTrashAvailability()` to determine which command to use:
 *   Linux:   `gio trash <file>` or `trash <file>`
 *   macOS:   `trash <file>` or `gio trash <file>`
 *   Windows: PowerShell + Microsoft.VisualBasic.FileIO → Recycle Bin
 *
 * @returns true if moved to trash, false if no trash command available or it failed
 */
async function moveToTrash(filePath: string): Promise<boolean> {
  const { available, command } = getTrashAvailability();
  if (!available || !command) return false;

  try {
    const { spawn } = await import("node:child_process");
    let bin: string;
    let args: string[];

    if (command === "powershell") {
      // Windows: use PowerShell to send to Recycle Bin via VisualBasic API
      const escaped = filePath.replace(/'/g, "''");
      bin = "powershell";
      args = [
        "-NoProfile",
        "-Command",
        `Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile('${escaped}', 'OnlyErrorDialogs', 'SendToRecycleBin')`,
      ];
    } else if (command === "gio trash") {
      bin = "gio";
      args = ["trash", filePath];
    } else {
      bin = "trash";
      args = [filePath];
    }

    const proc = spawn(bin, args, { stdio: "ignore" });

    return new Promise((resolve) => {
      proc.on("error", () => resolve(false));
      proc.on("close", (code) => resolve(code === 0));
    });
  } catch {
    return false;
  }
}

/**
 * Deletes a single file, either to trash or permanently.
 * Logs the operation with timestamp.
 */
export async function deleteFile(
  filePath: string,
  useTrash: boolean,
  dryRun: boolean,
): Promise<{ success: boolean; error?: string }> {
  if (dryRun) {
    log.info("[DRY RUN] Would delete file", { path: filePath, useTrash });
    return { success: true };
  }

  try {
    if (useTrash) {
      const movedToTrash = await moveToTrash(filePath);
      if (movedToTrash) {
        log.info("File moved to trash", {
          path: filePath,
          timestamp: new Date().toISOString(),
        });
        return { success: true };
      }
      // Fall back to permanent deletion
      log.warn("Trash not available, falling back to permanent deletion", {
        path: filePath,
      });
    }

    await unlink(filePath);
    log.info("File permanently deleted", {
      path: filePath,
      timestamp: new Date().toISOString(),
    });
    return { success: true };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    log.error("Failed to delete file", {
      path: filePath,
      error: errorMessage,
      timestamp: new Date().toISOString(),
    });
    return { success: false, error: errorMessage };
  }
}
