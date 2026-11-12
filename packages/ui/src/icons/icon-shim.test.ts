import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { ICON_MAP, MODIFIER_MAP, resolveIconClass } from "./icon-shim";

const SRC_DIR = join(import.meta.dir, "..");
/** Classes that look like icons but are styling hooks with no glyph. */
const NON_ICON_CLASSES = new Set(["fa-icon-secondary"]);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") ? [path] : [];
  });
}

/** Every complete `fa-*` class literal in the UI source (template prefixes like `fa-chevron-` excluded). */
function usedIconClasses(): Set<string> {
  const used = new Set<string>();
  for (const file of sourceFiles(SRC_DIR)) {
    if (file.endsWith("icon-shim.ts")) continue;
    for (const match of readFileSync(file, "utf-8").matchAll(/\bfa-[a-z0-9-]*[a-z0-9]\b(?!-)/g)) {
      used.add(match[0]);
    }
  }
  return used;
}

describe("icon-shim", () => {
  test("every Font Awesome icon class used in the UI maps to a Lucide icon", () => {
    const unmapped = [...usedIconClasses()].filter(
      (name) => !(name in ICON_MAP) && !(name in MODIFIER_MAP) && !NON_ICON_CLASSES.has(name),
    );
    expect(unmapped).toEqual([]);
  });

  test("dynamic chevron classes (fa-chevron-<direction>) are mapped", () => {
    for (const dir of ["up", "down", "left", "right"]) {
      expect(ICON_MAP[`fa-chevron-${dir}`]).toBeDefined();
    }
  });

  test("every mapped icon is a defined Lucide icon node", () => {
    for (const [name, node] of Object.entries(ICON_MAP)) {
      expect(Array.isArray(node), name).toBe(true);
      expect(node.length, name).toBeGreaterThan(0);
    }
  });

  test("resolveIconClass finds the icon class among style classes", () => {
    expect(resolveIconClass(["fadr", "fa-trash", "mr-2"])).toBe("fa-trash");
    expect(resolveIconClass(["fadr", "fa-spinner", "fa-spin"])).toBe("fa-spinner");
    expect(resolveIconClass(["fadr", "text-xl"])).toBeNull();
  });
});
