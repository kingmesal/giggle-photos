/**
 * The effect gate cannot silently stop working: run the real rule over the fixture with the real
 * biome.jsonc scoping and expect exactly the documented findings (RFD-004).
 */

import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, test } from "bun:test";

const REPO = resolve(import.meta.dir, "../../..");
const BIOME = join(REPO, "packages/ui/node_modules/.bin/biome");

function findings(relativePath: string): { message: string }[] {
  const dir = mkdtempSync(join(tmpdir(), "lint-gate-"));
  try {
    mkdirSync(join(dir, "plugins"));
    copyFileSync(join(REPO, "biome.jsonc"), join(dir, "biome.jsonc"));
    copyFileSync(join(REPO, "plugins/no-raw-use-effect.grit"), join(dir, "plugins/no-raw-use-effect.grit"));
    const target = join(dir, relativePath);
    mkdirSync(join(target, ".."), { recursive: true });
    copyFileSync(join(REPO, "lint-fixtures/no-raw-use-effect.tsx"), target);
    const run = spawnSync(
      BIOME, // VCS off: the scratch copy is not a git repository (biome.jsonc enables VCS ignore files).
      ["lint", "--vcs-enabled=false", "--reporter=json", "--max-diagnostics=100", relativePath],
      {
        cwd: dir,
        encoding: "utf8",
      },
    );
    const report = JSON.parse(run.stdout) as { diagnostics: { category: string; message: string }[] };
    return report.diagnostics.filter((d) => d.category === "plugin").map((d) => ({ message: d.message }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("no-raw-use-effect gate", () => {
  test("flags exactly the 7 raw effects in the fixture inside packages/ui/src", () => {
    const found = findings("packages/ui/src/fixture.tsx");
    expect(found).toHaveLength(7);
    expect(found[0]?.message).toMatch(/^A raw effect\./);
  });

  test("an excluded external-sync hook file is not flagged", () => {
    expect(findings("packages/ui/src/external/use-read.ts")).toHaveLength(0);
  });

  test("test files are not flagged", () => {
    expect(findings("packages/ui/src/fixture.test.tsx")).toHaveLength(0);
  });
});
