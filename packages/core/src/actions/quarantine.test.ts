import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { MANIFEST_NAME, quarantineFile, quarantinePath, restoreQuarantine } from "./quarantine";

let base: string;
let library: string;
let quarantine: string;
const put = (rel: string, content = rel) => {
  const path = join(library, rel);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content);
  return path;
};

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "quarantine-"));
  library = join(base, "library");
  quarantine = join(base, "quarantine");
});
afterEach(() => rmSync(base, { recursive: true, force: true }));

describe("quarantine", () => {
  test("mirrors the path below the scan folder, outside the library", () => {
    expect(quarantinePath("/q", "/lib", "/lib/Takeout/Google Photos/Photos from 2023/IMG_1.jpg")).toBe(
      "/q/Takeout/Google Photos/Photos from 2023/IMG_1.jpg",
    );
  });

  test("refuses a file outside its scan folder", () => {
    expect(() => quarantinePath("/q", "/lib", "/elsewhere/IMG_1.jpg")).toThrow(/not inside its scan folder/);
    expect(() => quarantinePath("/q", "/lib", "/lib")).toThrow();
  });

  test("moves the file and records it in the manifest", async () => {
    const src = put("Takeout/Google Photos/Photos from 2023/IMG_1.jpg", "pixels");
    const to = await quarantineFile(quarantine, library, src, "media");
    expect(existsSync(src)).toBe(false);
    expect(readFileSync(to, "utf-8")).toBe("pixels");
    const entry = JSON.parse(readFileSync(join(quarantine, MANIFEST_NAME), "utf-8").trim());
    expect(entry).toMatchObject({ from: src, to, kind: "media" });
  });

  test("never overwrites something already in quarantine", async () => {
    const src = put("a/IMG_1.jpg", "new");
    mkdirSync(join(quarantine, "a"), { recursive: true });
    writeFileSync(join(quarantine, "a", "IMG_1.jpg"), "old");
    await expect(quarantineFile(quarantine, library, src, "media")).rejects.toThrow(/Already in quarantine/);
    expect(existsSync(src)).toBe(true);
    expect(readFileSync(join(quarantine, "a", "IMG_1.jpg"), "utf-8")).toBe("old");
  });

  test("restore puts files back and leaves occupied originals alone", async () => {
    const a = put("x/A.jpg", "A");
    const b = put("x/B.jpg.json", "B");
    await quarantineFile(quarantine, library, a, "media");
    await quarantineFile(quarantine, library, b, "sidecar");
    writeFileSync(b, "someone put a new file here");
    const result = await restoreQuarantine(quarantine);
    expect(result.restored).toBe(1);
    expect(readFileSync(a, "utf-8")).toBe("A");
    expect(result.problems[0]).toMatch(/original path is occupied/);
    expect(readFileSync(b, "utf-8")).toBe("someone put a new file here");
  });

  test("restore with no manifest is a no-op", async () => {
    expect(await restoreQuarantine(join(base, "none"))).toEqual({ restored: 0, problems: [] });
  });
});
