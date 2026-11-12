import { afterEach, describe, expect, test } from "bun:test";
import { APP_NAME, getAppDataDir, getAppDataPath, getDefaultDatabasePath } from "./app-paths";

describe("App Paths", () => {
  const originalPlatform = process.platform;
  const originalEnv = { ...process.env };

  afterEach(() => {
    // Restore original platform and env
    Object.defineProperty(process, "platform", {
      value: originalPlatform,
      writable: true,
    });
    process.env = { ...originalEnv };
  });

  test("APP_NAME is set correctly", () => {
    expect(APP_NAME).toBe("giggle-photos");
  });

  test("getAppDataDir returns Windows path on win32", () => {
    Object.defineProperty(process, "platform", { value: "win32", writable: true });
    process.env.LOCALAPPDATA = "C:\\Users\\Test\\AppData\\Local";
    const path = getAppDataDir();
    expect(path).toBe("C:\\Users\\Test\\AppData\\Local");
  });

  test("getAppDataDir returns macOS path on darwin", () => {
    Object.defineProperty(process, "platform", { value: "darwin", writable: true });
    const path = getAppDataDir();
    expect(path).toContain("Library");
    expect(path).toContain("Application Support");
  });

  test("getAppDataDir returns Linux path on linux", () => {
    Object.defineProperty(process, "platform", { value: "linux", writable: true });
    delete process.env.XDG_DATA_HOME;
    const path = getAppDataDir();
    expect(path).toContain(".local");
    expect(path).toContain("share");
  });

  test("getAppDataPath includes app name", () => {
    const path = getAppDataPath();
    expect(path).toContain(APP_NAME);
  });

  test("getDefaultDatabasePath includes app.db", () => {
    const path = getDefaultDatabasePath();
    expect(path).toContain(APP_NAME);
    expect(path).toContain("app.db");
  });
});
