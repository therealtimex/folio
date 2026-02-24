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
  plugins: [
    react(),
    tailwindcss(),
    {
      name: "api-migrate",
      configureServer(server) {
        server.middlewares.use("/api/migrate", async (req, res, next) => {
          if (req.method !== "POST") return next();

          try {
            // Parse request body
            const buffers = [];
            for await (const chunk of req) {
              buffers.push(chunk);
            }

            let body: any = {};
            try {
              body = JSON.parse(Buffer.concat(buffers).toString());
            } catch {
              res.writeHead(400, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ error: "Invalid JSON in request body" }));
              return;
            }

            const { projectRef, accessToken } = body;

            if (!projectRef) {
              res.writeHead(400, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ error: "projectRef is required" }));
              return;
            }

            // Set up streaming response (SSE style for logs)
            res.writeHead(200, {
              "Content-Type": "text/event-stream",
              "Cache-Control": "no-cache",
              "Connection": "keep-alive"
            });

            const sendEvent = (type: string, data: string) => {
              res.write(`data: ${JSON.stringify({ type, data })}\n\n`);
            };

            sendEvent("info", "🚀 Starting migration (Development Mode)...");

            const { spawn } = await import("node:child_process");
            const scriptPath = path.join(process.cwd(), "scripts", "migrate.sh");

            const migrationProcess = spawn("bash", [scriptPath], {
              env: {
                ...process.env,
                SUPABASE_PROJECT_ID: projectRef,
                SUPABASE_ACCESS_TOKEN: accessToken
              },
              cwd: process.cwd(),
              stdio: ["ignore", "pipe", "pipe"]
            });

            migrationProcess.stdout.on("data", (data) => {
              const lines = data.toString().split("\n");
              lines.forEach((line: string) => {
                if (line.trim()) sendEvent("stdout", line);
              });
            });

            migrationProcess.stderr.on("data", (data) => {
              const lines = data.toString().split("\n");
              lines.forEach((line: string) => {
                if (line.trim()) sendEvent("stderr", line);
              });
            });

            migrationProcess.on("close", (code) => {
              if (code === 0) {
                sendEvent("info", "✅ Migration completed successfully!");
                sendEvent("done", "success");
              } else {
                sendEvent("error", `❌ Migration failed with exit code: ${code}`);
                sendEvent("done", "failed");
              }
              res.end();
            });

            migrationProcess.on("error", (error) => {
              sendEvent("error", `❌ Failed to start migration: ${error.message}`);
              sendEvent("done", "failed");
              res.end();
            });

            req.on("close", () => {
              if (!migrationProcess.killed) {
                migrationProcess.kill();
              }
            });
          } catch (error) {
            console.error("[Migration API] Error:", error);
            if (!res.headersSent) {
              res.writeHead(500, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ error: "Internal server error" }));
            }
          }
        });
      }
    }
  ],
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
