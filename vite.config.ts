import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { execSync } from "node:child_process";
import path from "node:path";
import pkg from "./package.json";

function getLatestMigrationTimestamp() {
  try {
    return execSync("node ./scripts/get-latest-migration-timestamp.mjs", {
      encoding: "utf8"
    }).trim();
  } catch {
    return "unknown";
  }
}

export default defineConfig({
  define: {
    "import.meta.env.VITE_APP_VERSION": JSON.stringify(pkg.version),
    "import.meta.env.VITE_LATEST_MIGRATION_TIMESTAMP": JSON.stringify(getLatestMigrationTimestamp())
  },
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3006",
        changeOrigin: true,
        timeout: 600_000,
        proxyTimeout: 600_000
      }
    }
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src")
    }
  }
});
