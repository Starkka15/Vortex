import * as path from "node:path";
import { createConfig, bundle } from "../../scripts/extensions-rolldown.mjs";

const extensionPath = path.resolve(import.meta.dirname);

// Main extension entry point
const entryPoint = path.resolve(extensionPath, "src", "index.ts");
const output = path.resolve(extensionPath, "dist", "index.js");
const config = createConfig(entryPoint, output);
await bundle(config);

// Worker thread (separate bundle, no vortex-api dependency)
const workerEntry = path.resolve(extensionPath, "src", "worker", "patchWorker.ts");
const workerOutput = path.resolve(extensionPath, "dist", "patchWorker.js");
const workerConfig = createConfig(workerEntry, workerOutput);
await bundle(workerConfig);
