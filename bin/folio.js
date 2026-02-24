#!/usr/bin/env node

import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const args = process.argv.slice(2);

let port = "5176";
const portIndex = args.indexOf("--port");
if (portIndex !== -1 && args[portIndex + 1]) {
  port = args[portIndex + 1];
}

const noUi = args.includes("--no-ui");

console.log("🚀 Folio starting...");
console.log(`📡 Port: ${port}`);
if (noUi) console.log("🖥️  Mode: No-UI");

const distServerPath = join(__dirname, "..", "dist", "api", "server.js");
const sourceServerPath = join(__dirname, "..", "api", "server.ts");
const distPath = join(__dirname, "..", "dist");

let execPath = process.execPath;
let execArgs = [];

if (existsSync(distServerPath)) {
  execArgs = [distServerPath, ...args];
} else if (existsSync(sourceServerPath)) {
  execPath = "npx";
  execArgs = ["tsx", sourceServerPath, ...args];
  console.log("🧪 Compiled server not found. Falling back to source (tsx).");
  if (!existsSync(join(distPath, "index.html")) && !noUi) {
    console.log("⚠️  dist/index.html not found. UI will not be served in single-port mode until you run `npm run build`.");
  }
} else {
  console.error("❌ Could not find Folio server entry point.");
  process.exit(1);
}

const child = spawn(execPath, execArgs, {
  stdio: "inherit",
  env: {
    ...process.env,
    PORT: port,
    ELECTRON_STATIC_PATH: distPath
  }
});

child.on("error", (error) => {
  console.error("❌ Failed to start Folio:", error.message);
  process.exit(1);
});

child.on("close", (code) => {
  process.exit(code || 0);
});

process.on("SIGINT", () => child.kill("SIGINT"));
process.on("SIGTERM", () => child.kill("SIGTERM"));
