#!/usr/bin/env node

import { spawn } from "node:child_process";

const child = spawn("bash", ["./scripts/migrate.sh"], {
  stdio: "inherit",
  env: process.env
});

child.on("close", (code) => {
  process.exit(code || 0);
});
