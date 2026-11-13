/**
 * Native modules for packaged builds (used by the postBuild hook, scripts/postbuild.ts).
 *
 * `sharp` and `onnxruntime-node` are external to the bundles (they load native binaries), so a
 * packaged app needs them in `Resources/app/bun/node_modules`. postBuild runs while the app tree is
 * still uncompressed (postWrap is already too late). Each package and its dependencies are copied
 * flat and dereferenced (Bun's isolated installs symlink into node_modules/.bun). Only this host's
 * binaries are kept: builds are host-only, one runner per target.
 *
 * Then both modules are loaded from an isolated copy; a module that does not load fails the build.
 */
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

// exiftool-vendored runs the bundled ExifTool (Perl script, or exe on Windows) found next to it.
const ROOTS = ["sharp", "onnxruntime-node", "exiftool-vendored"] as const;
const appRoot = join(import.meta.dir, "..");
const resolveFrom = join(appRoot, "..", "..", "packages", "core");

/** Find `.../Resources/app/bun` (the folder holding sharp-worker.js) under the build directory. */
export function findAppBunDir(buildDir: string, depth = 6): string | null {
  const candidate = join(buildDir, "Resources", "app", "bun");
  if (existsSync(join(candidate, "sharp-worker.js"))) return candidate;
  if (depth === 0 || !existsSync(buildDir)) return null;
  for (const entry of readdirSync(buildDir)) {
    const path = join(buildDir, entry);
    if (entry === "node_modules" || !statSync(path).isDirectory()) continue;
    const found = findAppBunDir(path, depth - 1);
    if (found) return found;
  }
  return null;
}

function packageDir(name: string, fromDir: string): string | null {
  try {
    return dirname(realpathSync(Bun.resolveSync(`${name}/package.json`, fromDir)));
  } catch {
    return null;
  }
}

/** Keep onnxruntime-node binaries for this platform/arch only (bin/napi-v*\/<os>/<arch>/...). */
export function keepOnnxPath(path: string, platform = process.platform, arch = process.arch): boolean {
  const rest = path.split(/[\\/]bin[\\/]napi-v\d+[\\/]/)[1];
  if (!rest) return true;
  const [os, a] = rest.split(/[\\/]/);
  return os === platform && (a === undefined || a === arch);
}

/** Copy the runtime dependency closure of ROOTS into `<appBunDir>/node_modules`. Returns package names. */
export function copyNativeModules(appBunDir: string): string[] {
  const out = join(appBunDir, "node_modules");
  rmSync(out, { recursive: true, force: true });
  const seen = new Set<string>();
  const visit = (name: string, fromDir: string, optional: boolean) => {
    if (seen.has(name)) return;
    const dir = packageDir(name, fromDir);
    if (!dir) {
      if (optional) return; // other platforms' optional binaries are not installed here
      throw new Error(`postBuild: cannot resolve ${name} from ${fromDir}`);
    }
    seen.add(name);
    cpSync(dir, join(out, ...name.split("/")), {
      recursive: true,
      dereference: true,
      filter: name === "onnxruntime-node" ? (src) => keepOnnxPath(src) : undefined,
    });
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf-8")) as {
      dependencies?: Record<string, string>;
      optionalDependencies?: Record<string, string>;
    };
    for (const dep of Object.keys(pkg.dependencies ?? {})) visit(dep, dir, false);
    for (const dep of Object.keys(pkg.optionalDependencies ?? {})) visit(dep, dir, true);
  };
  for (const root of ROOTS) visit(root, resolveFrom, false);
  return [...seen].sort();
}

/**
 * Load both modules with this Bun from a copy of the app folder outside the repo (inside it, the
 * repo's own node_modules would satisfy require); throws with the loader's output on failure.
 */
export function verifyNativeModules(appBunDir: string): void {
  const isolated = mkdtempSync(join(tmpdir(), "giggle-postbuild-"));
  try {
    cpSync(join(appBunDir, "node_modules"), join(isolated, "node_modules"), { recursive: true });
    probeNativeModules(isolated);
  } finally {
    rmSync(isolated, { recursive: true, force: true });
  }
}

function probeNativeModules(dir: string): void {
  const probe =
    "const s=require('sharp');const o=require('onnxruntime-node');" +
    "if(typeof s!=='function'||typeof o.InferenceSession?.create!=='function')throw new Error('bad exports');" +
    "const {ExifTool}=require('exiftool-vendored');const et=new ExifTool({maxProcs:1});" +
    "et.version().then(v=>{console.log('sharp', s.versions.vips, 'onnxruntime ok', 'exiftool', v);return et.end()})" +
    ".catch(e=>{console.error(e);process.exit(1)})";
  const run = Bun.spawnSync([process.execPath, "-e", probe], { cwd: dir, stdout: "pipe", stderr: "pipe" });
  if (run.exitCode !== 0) {
    throw new Error(`postBuild: the copied native modules do not load\n${run.stderr.toString()}`);
  }
  process.stdout.write(`postBuild: ${run.stdout.toString().trim()}\n`);
}
