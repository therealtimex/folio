#!/usr/bin/env node

import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const migrationsDir = join(__dirname, "..", "supabase", "migrations");

try {
  const files = readdirSync(migrationsDir);
  const timestamps = files
    .filter((file) => file.endsWith(".sql"))
    .filter((file) => !file.toLowerCase().includes("test")) // exclude test migrations
    .map((file) => {
      const match = file.match(/^(\d{14})_/);
      return match ? match[1] : null;
    })
    .filter(Boolean)
    .sort()
    .reverse();

  if (timestamps.length === 0) {
    console.log("20240101000000");
    process.exit(0);
  }

  console.log(timestamps[0]);
} catch (error) {
  console.error("Error reading migrations:", error instanceof Error ? error.message : String(error));
  process.exit(1);
}
