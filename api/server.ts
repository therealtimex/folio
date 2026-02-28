import cors from "cors";
import express from "express";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { config, validateConfig } from "./src/config/index.js";
import { errorHandler } from "./src/middleware/errorHandler.js";
import { apiRateLimit } from "./src/middleware/rateLimit.js";
import routes from "./src/routes/index.js";
import { SDKService } from "./src/services/SDKService.js";
import { createLogger } from "./src/utils/logger.js";

const logger = createLogger("Server");
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const configValidation = validateConfig();
if (!configValidation.valid) {
  logger.warn("Configuration warnings", { errors: configValidation.errors });
}

SDKService.initialize();

const app = express();

app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  if (config.isProduction) {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  next();
});

app.use(
  cors({
    origin: config.isProduction ? config.security.corsOrigins : true,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Supabase-Url", "X-Supabase-Anon-Key"]
  })
);

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    const duration = Date.now() - start;
    logger.debug(`${req.method} ${req.path}`, { status: res.statusCode, durationMs: duration });
  });
  next();
});

app.use("/api", apiRateLimit);
app.use("/api", routes);

function getDistPath() {
  if (
    process.env.ELECTRON_STATIC_PATH &&
    existsSync(path.join(process.env.ELECTRON_STATIC_PATH, "index.html"))
  ) {
    return process.env.ELECTRON_STATIC_PATH;
  }

  const fromRoot = path.join(config.rootDir || process.cwd(), "dist");
  if (existsSync(path.join(fromRoot, "index.html"))) {
    return fromRoot;
  }

  let current = __dirname;
  for (let i = 0; i < 4; i += 1) {
    const candidate = path.join(current, "dist");
    if (existsSync(path.join(candidate, "index.html"))) {
      return candidate;
    }
    current = path.dirname(current);
  }

  return fromRoot;
}

const distUiPath = getDistPath();
if (existsSync(path.join(distUiPath, "index.html"))) {
  logger.info("Serving static UI", { distUiPath });
  app.use(express.static(distUiPath));

  app.get(/.*/, (req, res, next) => {
    if (req.path.startsWith("/api")) {
      return next();
    }

    res.sendFile(path.join(distUiPath, "index.html"), (error) => {
      if (error) {
        res.status(404).json({
          success: false,
          error: {
            code: "NOT_FOUND",
            message: "Frontend not built or route not found"
          }
        });
      }
    });
  });
} else {
  logger.warn("No dist/index.html found. API will run without bundled UI.", { distUiPath });
}

app.use(errorHandler);

const server = app.listen(config.port, () => {
  logger.info(`Folio API started. UI accessible at http://localhost:${config.port}`, {
    port: config.port,
    environment: config.nodeEnv,
    packageRoot: config.packageRoot
  });
});

function shutdown(signal: string) {
  logger.info(`Shutting down (${signal})`);
  server.close(() => {
    process.exit(0);
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
