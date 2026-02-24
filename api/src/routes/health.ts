import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createClient } from "@supabase/supabase-js";
import { Router } from "express";

import { config } from "../config/index.js";
import { SDKService } from "../services/SDKService.js";
import { getServerSupabase, getSupabaseConfigFromHeaders } from "../services/supabase.js";

const router = Router();

let version = "0.0.0";
try {
  const pkgPath = join(config.packageRoot, "package.json");
  version = JSON.parse(readFileSync(pkgPath, "utf8")).version;
} catch {
  // fallback stays at default
}

router.get("/", async (req, res) => {
  let supabase = getServerSupabase();

  if (!supabase) {
    const headerConfig = getSupabaseConfigFromHeaders(req.headers as Record<string, unknown>);
    if (headerConfig) {
      supabase = createClient(headerConfig.url, headerConfig.anonKey, {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      });
    }
  }

  let databaseStatus = "not_configured";

  if (supabase) {
    try {
      const { error } = await supabase.from("user_settings").select("id").limit(1);
      databaseStatus = error ? "error" : "connected";
    } catch {
      databaseStatus = "error";
    }
  }

  const sdkAvailable = await SDKService.isAvailable();

  res.json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    version,
    environment: config.nodeEnv,
    services: {
      database: databaseStatus,
      realtimeXSdk: sdkAvailable ? "available" : "unavailable"
    }
  });
});

export default router;
