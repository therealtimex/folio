import { spawn } from "node:child_process";
import { join } from "node:path";

import { Router } from "express";

import { config } from "../config/index.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { schemas, validateBody } from "../middleware/validation.js";
import { createLogger } from "../utils/logger.js";

const router = Router();
const logger = createLogger("MigrateRoutes");

router.post(
  "/",
  validateBody(schemas.migrate),
  asyncHandler(async (req, res) => {
    const { projectRef, accessToken, anonKey } = req.body;

    logger.info("Starting migration", { projectRef });

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    // @ts-ignore express typings may not include flushHeaders depending on version
    res.flushHeaders?.();

    const sendEvent = (type: string, data: string) => {
      if (res.writableEnded) {
        return;
      }
      res.write(`data: ${JSON.stringify({ type, data })}\n\n`);
    };

    const scriptPath = join(config.scriptsDir, "migrate.sh");

    const child = spawn("bash", [scriptPath], {
      env: {
        ...process.env,
        SUPABASE_PROJECT_ID: projectRef,
        SUPABASE_ACCESS_TOKEN: accessToken,
        SUPABASE_ANON_KEY: anonKey || "",
        SKIP_FUNCTIONS: process.env.SKIP_FUNCTIONS || "0"
      },
      cwd: config.rootDir
    });

    let clientDisconnected = false;
    const stopChild = () => {
      clientDisconnected = true;
      if (!child.killed) {
        child.kill("SIGTERM");
      }
    };

    res.on("close", stopChild);
    req.on("aborted", stopChild);

    child.stdout.on("data", (chunk) => {
      const lines = String(chunk)
        .split("\n")
        .filter((line) => line.trim().length > 0);
      for (const line of lines) {
        sendEvent("stdout", line);
      }
    });

    child.stderr.on("data", (chunk) => {
      const lines = String(chunk)
        .split("\n")
        .filter((line) => line.trim().length > 0);
      for (const line of lines) {
        sendEvent("stderr", line);
      }
    });

    child.on("error", (error) => {
      if (clientDisconnected) {
        logger.info("Migration process ended after client disconnect", { projectRef });
        return;
      }
      sendEvent("error", `Failed to run migration: ${error.message}`);
      sendEvent("done", "failed");
      if (!res.writableEnded) {
        res.end();
      }
    });

    child.on("close", (code, signal) => {
      if (clientDisconnected) {
        logger.info("Migration process stopped after client disconnect", { projectRef, code, signal });
        return;
      }

      if (code === 0) {
        sendEvent("info", "Migration completed successfully.");
        sendEvent("done", "success");
      } else {
        const codeLabel = code === null ? "null" : String(code);
        const signalSuffix = signal ? ` (signal: ${signal})` : "";
        sendEvent("error", `Migration failed with code ${codeLabel}${signalSuffix}`);
        sendEvent("done", "failed");
      }

      if (!res.writableEnded) {
        res.end();
      }
    });
  })
);

export default router;
