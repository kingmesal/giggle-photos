import { describe, expect, test } from "bun:test";
import { findTool } from "./find-tool";

describe("findTool", () => {
  test("PATH first", () => {
    expect(findTool("ffprobe", { which: () => "/custom/ffprobe", exists: () => false })).toBe("/custom/ffprobe");
  });

  test("a minimal PATH (desktop launch, macOS Finder) still finds Homebrew or /usr/bin installs", () => {
    const has = (p: string) => p === "/opt/homebrew/bin/ffmpeg";
    expect(findTool("ffmpeg", { platform: "darwin", which: () => null, exists: has })).toBe("/opt/homebrew/bin/ffmpeg");
    expect(findTool("ffprobe", { platform: "linux", which: () => null, exists: (p) => p === "/usr/bin/ffprobe" })).toBe(
      "/usr/bin/ffprobe",
    );
  });

  test("Windows looks for .exe in the usual install folders", () => {
    const found = findTool("ffmpeg", {
      platform: "win32",
      which: () => null,
      exists: (p) => p.endsWith("ffmpeg.exe") && p.includes("Program Files"),
    });
    expect(found).toContain("Program Files");
  });

  test("not installed anywhere → null", () => {
    expect(findTool("ffmpeg", { platform: "linux", which: () => null, exists: () => false })).toBeNull();
  });

  test("the real machine: finds ffmpeg when installed", () => {
    if (Bun.which("ffmpeg")) expect(findTool("ffmpeg")).toBe(Bun.which("ffmpeg"));
  });
});
