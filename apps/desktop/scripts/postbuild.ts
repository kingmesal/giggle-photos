/**
 * Electrobun postBuild hook: ship sharp + onnxruntime-node inside the app (see native-modules.ts).
 * Hutch runs hooks through a generated wrapper that imports this file, so `import.meta.main` is
 * false here: the work runs at top level.
 */
import { sep } from "node:path";
import { copyNativeModules, findAppBunDir, verifyNativeModules } from "./native-modules";

const buildDir = process.env.ELECTROBUN_BUILD_DIR;
if (!buildDir) throw new Error("postBuild: ELECTROBUN_BUILD_DIR is not set");
const appBunDir = findAppBunDir(buildDir);
if (!appBunDir) throw new Error(`postBuild: no Resources/app/bun with sharp-worker.js under ${buildDir}`);
const copied = copyNativeModules(appBunDir);
process.stdout.write(`postBuild: copied ${copied.length} packages into ${appBunDir}${sep}node_modules\n`);
verifyNativeModules(appBunDir);
