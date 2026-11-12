import { type UserConfig, updateWindowSize } from "@giggle-photos/core/config/user-config";
import { DatabaseProvider } from "@giggle-photos/core/db/database-provider";
import { getLogger } from "@giggle-photos/core/logging/logger";
import { shutdownUI } from "@giggle-photos/ui";
import Electrobun, { BrowserWindow } from "electrobun/main";

const log = getLogger("desktop:window");

/**
 * Create the main application window. Does not specify renderer; Electrobun uses default from bundleCEF config.
 */
// biome-ignore lint/suspicious/noExplicitAny: RPC type is defined by Electrobun
export function createMainWindow(userConfig: UserConfig, rpc?: any): BrowserWindow {
  return new BrowserWindow({
    title: "Giggle Photos",
    url: "views://mainview/index.html",
    frame: {
      width: userConfig.window.width,
      height: userConfig.window.height,
      x: userConfig.window.x,
      y: userConfig.window.y,
    },
    rpc,
  });
}

export type WindowBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

/** Get current window bounds (for polling fallback when resized/moved events don't fire). */
export function getCurrentWindowBounds(win: BrowserWindow): WindowBounds | null {
  try {
    // Try frame property first (getter), then getFrame() method
    const frame = win.frame ?? win.getFrame?.();
    if (
      frame &&
      typeof frame.x === "number" &&
      typeof frame.y === "number" &&
      typeof frame.width === "number" &&
      typeof frame.height === "number"
    ) {
      return frame;
    }
    log.trace("getFrame returned invalid data", { frame });
  } catch (error) {
    log.trace("Error getting window frame", { error });
  }
  return null;
}

/**
 * Set up window lifecycle: bounds persistence, resize/move/focus/close handlers,
 * bounds polling fallback, and process signal shutdown.
 */
export function setupWindowLifecycle(win: BrowserWindow): void {
  log.info("Setting up window lifecycle (bounds, events, shutdown handlers)");
  let saveTimeout: ReturnType<typeof setTimeout> | null = null;
  let isShuttingDown = false;

  // Track last known bounds for debouncing
  let lastBounds: WindowBounds = { x: 0, y: 0, width: 0, height: 0 };

  function saveWindowBoundsNow(width: number, height: number, x: number, y: number): void {
    log.debug("saveWindowBoundsNow called", { width, height, x, y });
    if (width > 0 && height > 0) {
      updateWindowSize(width, height, x, y);
      lastBounds = { x, y, width, height };
    }
  }

  function debouncedSave(width: number, height: number, x: number, y: number): void {
    log.debug("debouncedSave called", { width, height, x, y });
    // Update last known bounds
    lastBounds = { x, y, width, height };

    if (saveTimeout) {
      clearTimeout(saveTimeout);
    }
    saveTimeout = setTimeout(() => {
      log.debug("Debounce timer fired, saving", lastBounds);
      saveWindowBoundsNow(lastBounds.width, lastBounds.height, lastBounds.x, lastBounds.y);
    }, 500);
  }

  async function handleShutdown(): Promise<void> {
    if (isShuttingDown) {
      return;
    }
    isShuttingDown = true;
    log.info("Shutting down application...");

    try {
      await shutdownUI();
      // Close DB so no open handles keep the process alive (Bun/Electrobun can stay resident otherwise).
      try {
        const provider = await DatabaseProvider.getInstance();
        provider.getClient().close();
      } catch {
        // Ignore if not initialized or already closed.
      }
      log.info("Application shut down executed.");
    } catch (error) {
      log.error("Error during shutdown", error);
    }
  }

  win.on("resized", (event: unknown) => {
    // Log window resize events for debugging
    log.debug("Window resized event", event);
    log.debug("Window frame property", win.frame);

    // Extract size from event (inner dimensions)
    const e = event as { inner?: { width: number; height: number } };
    const width = e.inner?.width;
    const height = e.inner?.height;

    // Get position from window.frame
    const frame = win.frame;
    const x = frame?.x ?? lastBounds.x;
    const y = frame?.y ?? lastBounds.y;

    log.debug("Resize: using size from event, position from frame", { width, height, x, y });

    if (width && height) {
      debouncedSave(width, height, x, y);
    }
  });

  win.on("moved", (event: unknown) => {
    log.debug("Window moved event", event);
    const e = event as { x?: number; y?: number };

    // Get position from event or window.frame
    const frame = win.frame;
    const x = e.x ?? frame?.x ?? lastBounds.x;
    const y = e.y ?? frame?.y ?? lastBounds.y;

    // Keep last known size
    const width = frame?.width ?? lastBounds.width;
    const height = frame?.height ?? lastBounds.height;

    log.debug("Move: position from event/frame, size from frame", { width, height, x, y });

    if (width > 0 && height > 0) {
      debouncedSave(width, height, x, y);
    }
  });

  win.on("focus", (event: unknown) => {
    log.debug("Window focused", event);
    // Don't save on focus - it fires too often and may have stale data
  });

  win.on("ready-to-show", () => {
    log.debug("Window ready to show");
  });

  /** Set by setupWindowLifecycle; used by signal handlers and close to request app quit. */
  const quitHandler: () => void = () => {
    handleShutdown().catch((error) => {
      log.error("Error in shutdown handler", error);
    });
  };

  win.on("close", () => {
    log.info("Window close event received, we shutdown database before-quit.");
  });

  Electrobun.events.on("before-quit", () => {
    log.info("Application before-quit event received");
    quitHandler();
  });

  process.on("SIGINT", () => {
    log.info("SIGINT received, shutting down...");
    quitHandler();
  });

  process.on("SIGTERM", () => {
    log.info("SIGTERM received, shutting down...");
    quitHandler();
  });

  process.on("SIGHUP", () => {
    log.info("SIGHUP received, shutting down...");
    quitHandler();
  });

  log.info("Window event handlers registered (resized, moved, focus, ready-to-show, close, before-quit)");
}
