import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "bun:test";
import { missingFrom, tarEntries } from "./check-package";
import { findAppBunDir, keepOnnxPath } from "./native-modules";

const dir = mkdtempSync(join(tmpdir(), "packaging-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("postBuild helpers", () => {
  test("keeps only this platform's onnxruntime binaries", () => {
    const base = "/x/onnxruntime-node/bin/napi-v6";
    expect(keepOnnxPath(`${base}/linux/arm64/onnxruntime_binding.node`, "linux", "arm64")).toBe(true);
    expect(keepOnnxPath(`${base}/linux`, "linux", "arm64")).toBe(true);
    expect(keepOnnxPath(`${base}/linux/x64/onnxruntime_binding.node`, "linux", "arm64")).toBe(false);
    expect(keepOnnxPath(`${base}/darwin/arm64/libonnxruntime.dylib`, "linux", "arm64")).toBe(false);
    expect(keepOnnxPath("/x/onnxruntime-node/dist/index.js", "linux", "arm64")).toBe(true);
  });

  test("finds Resources/app/bun (with the worker) at any depth, e.g. inside a macOS .app", () => {
    const bun = join(dir, "stable-macos-arm64", "Giggle Photos.app", "Contents", "Resources", "app", "bun");
    mkdirSync(bun, { recursive: true });
    writeFileSync(join(bun, "sharp-worker.js"), "");
    expect(findAppBunDir(join(dir, "stable-macos-arm64"))).toBe(bun);
    expect(findAppBunDir(join(dir, "nothing-here-yet"))).toBeNull();
  });
});

/** A minimal ustar archive with the given (empty) file names; one GNU long name when > 100 chars. */
function tar(names: string[]): Uint8Array {
  const blocks: Uint8Array[] = [];
  const header = (name: string, type: string, size: number) => {
    const h = new Uint8Array(512);
    h.set(new TextEncoder().encode(name.slice(0, 99)), 0);
    h.set(new TextEncoder().encode(`${size.toString(8).padStart(11, "0")}\0`), 124);
    h[156] = type.charCodeAt(0);
    return h;
  };
  for (const name of names) {
    if (name.length > 100) {
      const body = new Uint8Array(Math.ceil((name.length + 1) / 512) * 512);
      body.set(new TextEncoder().encode(name));
      blocks.push(header("././@LongLink", "L", name.length + 1), body);
    }
    blocks.push(header(name, "0", 0));
  }
  blocks.push(new Uint8Array(1024));
  const out = new Uint8Array(blocks.reduce((n, b) => n + b.length, 0));
  let off = 0;
  for (const b of blocks) {
    out.set(b, off);
    off += b.length;
  }
  return out;
}

describe("package check", () => {
  const complete = [
    "app/bun/index.js",
    "app/bun/node_modules/sharp/package.json",
    "app/bun/node_modules/@img/sharp-linux-arm64/lib/sharp-linux-arm64.node",
    `app/bun/node_modules/onnxruntime-node/bin/napi-v6/linux/arm64/${"x".repeat(0)}onnxruntime_binding.node`,
  ];

  test("reads tar entry names, including GNU long names", () => {
    const long = `app/bun/node_modules/${"deep/".repeat(25)}file.js`;
    expect(tarEntries(tar([...complete, long]))).toEqual([...complete, long]);
  });

  test("reports exactly what is missing", () => {
    expect(missingFrom(complete)).toEqual([]);
    expect(missingFrom(["app/bun/index.js"])).toEqual(["sharp", "sharp native binary", "onnxruntime binding"]);
    expect(missingFrom(complete.filter((p) => !p.includes("onnxruntime")))).toEqual(["onnxruntime binding"]);
  });
});
