import { randomBytes } from "node:crypto";

import axios from "axios";
import { createClient } from "@supabase/supabase-js";
import { Router } from "express";

import { asyncHandler } from "../middleware/errorHandler.js";
import { createLogger } from "../utils/logger.js";
import { schemas, validateBody } from "../middleware/validation.js";

const router = Router();
const logger = createLogger("SetupRoutes");

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractAxiosError(error: unknown, fallback: string): { status: number; message: string } {
  if (!axios.isAxiosError(error)) {
    return {
      status: 500,
      message: fallback
    };
  }

  if (!error.response) {
    return {
      status: 502,
      message: `Upstream request failed (${error.code || "network_error"}): ${error.message || fallback}`
    };
  }

  const status = error.response.status || 500;
  const data = error.response?.data;

  if (typeof data === "string" && data.trim()) {
    return { status, message: data };
  }

  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    const message =
      (typeof obj.error === "string" && obj.error) ||
      (typeof obj.message === "string" && obj.message) ||
      (typeof obj.msg === "string" && obj.msg) ||
      error.message ||
      fallback;

    return { status, message };
  }

  return {
    status,
    message: error.message || fallback
  };
}

function resolveProjectRef(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return "";
  }

  const record = payload as Record<string, unknown>;

  if (typeof record.ref === "string" && record.ref.trim()) {
    return record.ref.trim();
  }

  if (typeof record.id === "string" && record.id.trim()) {
    return record.id.trim();
  }

  if (typeof record.project_ref === "string" && record.project_ref.trim()) {
    return record.project_ref.trim();
  }

  return "";
}

async function fetchProjectAnonKey(
  authHeader: string,
  projectRef: string,
  options: { attempts?: number; waitMs?: number } = {}
): Promise<string> {
  const attempts = options.attempts ?? 1;
  const waitMs = options.waitMs ?? 3000;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (attempt > 1) {
      await sleep(waitMs);
    }

    try {
      const keysResponse = await axios.get(`https://api.supabase.com/v1/projects/${projectRef}/api-keys`, {
        headers: {
          Authorization: authHeader
        },
        timeout: 10_000
      });

      const keys = keysResponse.data;
      if (Array.isArray(keys)) {
        const anon = keys.find((item) => item?.name === "anon")?.api_key;
        if (typeof anon === "string" && anon.trim()) {
          return anon;
        }
      }
    } catch {
      // ignore and retry
    }
  }

  return "";
}

router.post(
  "/test-supabase",
  validateBody(schemas.testSupabase),
  asyncHandler(async (req, res) => {
    const { url, anonKey } = req.body;

    const supabase = createClient(url, anonKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });

    const { error } = await supabase.from("user_settings").select("id").limit(1);

    if (error && error.code !== "PGRST116") {
      res.status(400).json({
        valid: false,
        message: error.message
      });
      return;
    }

    res.json({
      valid: true,
      message: "Supabase connection verified"
    });
  })
);

router.get("/organizations", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    res.status(401).json({ error: "Missing Authorization header" });
    return;
  }

  try {
    const response = await axios.get("https://api.supabase.com/v1/organizations", {
      headers: {
        Authorization: authHeader
      },
      timeout: 20_000
    });

    res.json(response.data);
  } catch (error) {
    const extracted = extractAxiosError(error, "Failed to fetch organizations");

    logger.warn("Organization fetch failed", {
      status: extracted.status,
      message: extracted.message
    });

    res.status(extracted.status).json({
      error: extracted.message
    });
  }
});

router.get("/projects/:projectRef/credentials", async (req, res) => {
  const authHeader = req.headers.authorization;
  const projectRef = (req.params.projectRef || "").trim();

  if (!authHeader) {
    res.status(401).json({ error: "Missing Authorization header" });
    return;
  }

  if (!projectRef) {
    res.status(400).json({ error: "Missing projectRef" });
    return;
  }

  try {
    const statusResponse = await axios.get(`https://api.supabase.com/v1/projects/${projectRef}`, {
      headers: {
        Authorization: authHeader
      },
      timeout: 10_000
    });

    const status = typeof statusResponse.data?.status === "string" ? statusResponse.data.status : "unknown";
    const anonKey = await fetchProjectAnonKey(authHeader, projectRef, { attempts: 10, waitMs: 3000 });

    if (!anonKey) {
      res.status(425).json({
        error: "Project exists, but anon API key is not ready yet. Retry shortly.",
        status
      });
      return;
    }

    res.json({
      projectId: projectRef,
      status,
      url: `https://${projectRef}.supabase.co`,
      anonKey
    });
  } catch (error) {
    const extracted = extractAxiosError(error, "Failed to recover project credentials");
    logger.warn("Project credential recovery failed", {
      projectRef,
      status: extracted.status,
      message: extracted.message
    });
    res.status(extracted.status).json({
      error: extracted.message
    });
  }
});

router.post("/auto-provision", validateBody(schemas.autoProvision), async (req, res) => {
  const authHeader = req.headers.authorization;
  const { orgId, projectName: requestedName, region: requestedRegion } = req.body;

  if (!authHeader) {
    res.status(401).json({ error: "Missing Authorization header" });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  // @ts-ignore express typings may not include flushHeaders depending on version
  res.flushHeaders?.();

  let disconnected = false;
  res.on("close", () => {
    disconnected = true;
  });

  const sendEvent = (type: string, data: unknown) => {
    if (disconnected || res.writableEnded) {
      return;
    }
    res.write(`data: ${JSON.stringify({ type, data })}\n\n`);
  };

  try {
    const projectName = requestedName?.trim() || `Folio-${randomBytes(2).toString("hex")}`;
    const region = requestedRegion || "us-east-1";

    const dbPass =
      randomBytes(16)
        .toString("base64")
        .replace(/\+/g, "a")
        .replace(/\//g, "b")
        .replace(/=/g, "c") + "1!Aa";

    sendEvent("info", `Creating project ${projectName} in ${region}...`);

    const createResponse = await axios.post(
      "https://api.supabase.com/v1/projects",
      {
        name: projectName,
        organization_id: orgId,
        region,
        db_pass: dbPass
      },
      {
        headers: {
          Authorization: authHeader
        },
        timeout: 20_000
      }
    );

    const projectRef = resolveProjectRef(createResponse.data);
    if (!projectRef) {
      throw new Error("Project creation returned no project id");
    }

    sendEvent("project_id", projectRef);
    sendEvent("info", `Project created (${projectRef}). Waiting for readiness...`);

    let isReady = false;
    const maxAttempts = 60;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      await sleep(5000);

      try {
        const statusResponse = await axios.get(`https://api.supabase.com/v1/projects/${projectRef}`, {
          headers: {
            Authorization: authHeader
          },
          timeout: 10_000
        });

        const status = statusResponse.data?.status;
        sendEvent("info", `Status: ${status || "unknown"} (${attempt}/${maxAttempts})`);

        if (status === "ACTIVE" || status === "ACTIVE_HEALTHY") {
          isReady = true;
          break;
        }
      } catch {
        sendEvent("info", `Status check retry (${attempt}/${maxAttempts})...`);
      }
    }

    if (!isReady) {
      throw new Error("Project provisioning timed out");
    }

    sendEvent("info", "Retrieving API keys...");

    let anonKey = "";
    for (let attempt = 1; attempt <= 10; attempt += 1) {
      anonKey = await fetchProjectAnonKey(authHeader, projectRef);
      if (anonKey) {
        break;
      }
      sendEvent("info", `API keys not ready (${attempt}/10), retrying...`);
    }

    if (!anonKey) {
      throw new Error("Could not retrieve anon key for project");
    }

    const supabaseUrl = `https://${projectRef}.supabase.co`;

    sendEvent("info", "Waiting for DNS propagation...");
    let dnsReady = false;
    for (let attempt = 1; attempt <= 20; attempt += 1) {
      try {
        const ping = await axios.get(`${supabaseUrl}/rest/v1/`, {
          timeout: 5_000,
          validateStatus: () => true
        });
        if (ping.status < 500) {
          dnsReady = true;
          break;
        }
      } catch {
        // ignore and retry
      }
      if (attempt % 5 === 0) {
        sendEvent("info", "DNS still propagating...");
      }
      await sleep(3000);
    }

    if (!dnsReady) {
      sendEvent("info", "DNS check timed out, continuing anyway.");
    }

    sendEvent("success", {
      url: supabaseUrl,
      anonKey,
      projectId: projectRef,
      dbPass
    });

    sendEvent("done", "success");
  } catch (error) {
    const extracted = extractAxiosError(error, "Auto-provisioning failed");

    logger.error("Auto-provision failed", {
      status: extracted.status,
      message: extracted.message
    });

    sendEvent("error", extracted.message);
    sendEvent("done", "failed");
  } finally {
    if (!res.writableEnded) {
      res.end();
    }
  }
});

export default router;
