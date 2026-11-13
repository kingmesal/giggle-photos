/**
 * Release check: the built app must contain the native modules (sharp + an onnxruntime binding).
 * Looks in apps/desktop/build for an uncompressed `Resources/app/bun/node_modules`, or for the
 * compressed inner app archive (`Resources/*.tar.zst`, as Electrobun's self-extracting wrapper
 * stores it), and lists its entries. Exits 1 with what is missing.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const REQUIRED: [string, RegExp][] = [
  ["sharp", /app\/bun\/node_modules\/sharp\/package\.json$/],
  ["sharp native binary", /app\/bun\/node_modules\/@img\/sharp-[^/]+\/(lib|package\.json)/],
  [
    "onnxruntime binding",
    /app\/bun\/node_modules\/onnxruntime-node\/bin\/napi-v\d+\/[^/]+\/[^/]+\/onnxruntime_binding\.node$/,
  ],
];

/** Entry names in a (ustar / GNU long-name) tar. */
export function tarEntries(tar: Uint8Array): string[] {
  const names: string[] = [];
  const text = (from: number, len: number) =>
    new TextDecoder().decode(tar.subarray(from, from + len)).replace(/\0.*$/s, "");
  let longName: string | null = null;
  for (let off = 0; off + 512 <= tar.length; ) {
    const name = text(off, 100);
    if (!name) break; // end-of-archive blocks
    const size = Number.parseInt(text(off + 124, 12).trim() || "0", 8);
    const type = String.fromCharCode(tar[off + 156] as number);
    const prefix = text(off + 345, 155);
    const body = off + 512;
    if (type === "L") longName = text(body, size);
    else if (type !== "x" && type !== "g") {
      names.push(longName ?? (prefix ? `${prefix}/${name}` : name));
      longName = null;
    }
    off = body + Math.ceil(size / 512) * 512;
  }
  return names;
}

function walk(dir: string, depth: number, found: string[]): void {
  if (depth < 0 || !existsSync(dir)) return;
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (!statSync(path).isDirectory()) {
      if (entry.endsWith(".tar.zst") && dir.endsWith("Resources")) found.push(path);
      continue;
    }
    if (entry === "node_modules") continue;
    walk(path, depth - 1, found);
  }
}

/** Every file path the packaged app contains (from the uncompressed tree or the inner archives). */
export function packagedPaths(buildDir: string): string[] {
  const archives: string[] = [];
  walk(buildDir, 8, archives);
  const paths: string[] = [];
  for (const archive of archives) {
    paths.push(...tarEntries(Bun.zstdDecompressSync(readFileSync(archive))));
  }
  const listTree = (dir: string, rel: string) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) listTree(path, `${rel}/${entry}`);
      else paths.push(`${rel}/${entry}`);
    }
  };
  const findApp = (dir: string, depth: number) => {
    if (depth < 0) return;
    const nm = join(dir, "Resources", "app", "bun", "node_modules");
    if (existsSync(nm)) listTree(nm, "app/bun/node_modules");
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (entry !== "node_modules" && statSync(path).isDirectory()) findApp(path, depth - 1);
    }
  };
  findApp(buildDir, 6);
  return paths.map((p) => p.replace(/\\/g, "/"));
}

export function missingFrom(paths: string[]): string[] {
  return REQUIRED.filter(([, re]) => !paths.some((p) => re.test(p))).map(([label]) => label);
}

/** Local files the main view's index.html loads (script src, stylesheet href). */
export function viewReferences(html: string): string[] {
  const refs = [...html.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)="([^"]+)"/g)].map((m) => m[1] as string);
  return refs.filter((r) => !/^[a-z]+:\/\//i.test(r)).map((r) => r.replace(/^\.\//, ""));
}

/** References in index.html that are not in the packaged views/mainview folder. */
export function missingViewFiles(html: string, paths: string[]): string[] {
  return viewReferences(html).filter((ref) => !paths.some((p) => p.endsWith(`app/views/mainview/${ref}`)));
}

if (import.meta.main) {
  const buildDir = join(import.meta.dir, "..", "build");
  const paths = packagedPaths(buildDir);
  const html = readFileSync(join(import.meta.dir, "..", "src", "views", "index.html"), "utf-8");
  const missing = [
    ...missingFrom(paths),
    ...missingViewFiles(html, paths).map((f) => `views/mainview/${f} (loaded by index.html)`),
  ];
  if (missing.length > 0) {
    process.stderr.write(`Package check failed (${paths.length} paths scanned): missing ${missing.join(", ")}\n`);
    process.exit(1);
  }
  process.stdout.write(`Package check passed: native modules present (${paths.length} paths scanned)\n`);
}
