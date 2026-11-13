/** Electrobun preBuild: build the stylesheet and bundle the sharp worker. */
import { buildCss } from "./build-css";

process.stdout.write(`tailwind css built -> ${buildCss()}\n`);
await import("./build-worker");
