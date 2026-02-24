import { createClient, SupabaseClient } from "@supabase/supabase-js";

import { config } from "../config/index.js";
import { createLogger } from "../utils/logger.js";

const logger = createLogger("SupabaseService");

let serverClient: SupabaseClient | null = null;
let lastConfigHash = "";

export function isValidUrl(url: string): boolean {
  return url.startsWith("http://") || url.startsWith("https://");
}

function isValidAnonKey(key: string): boolean {
  return key.startsWith("eyJ") || key.startsWith("sb_publishable_");
}

function getConfigHash() {
  return `${config.supabase.url}_${config.supabase.anonKey}`;
}

export function getServerSupabase(forceRefresh = false): SupabaseClient | null {
  const currentHash = getConfigHash();

  if (serverClient && !forceRefresh && currentHash === lastConfigHash) {
    return serverClient;
  }

  const url = config.supabase.url;
  const key = config.supabase.anonKey;

  if (!url || !key || !isValidUrl(url)) {
    return null;
  }

  try {
    serverClient = createClient(url, key, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });
    lastConfigHash = currentHash;
    logger.info("Server Supabase client initialized");
    return serverClient;
  } catch (error) {
    logger.error("Failed to initialize server Supabase client", {
      error: error instanceof Error ? error.message : String(error)
    });
    return null;
  }
}

export function getServiceRoleSupabase(): SupabaseClient | null {
  const url = config.supabase.url;
  const key = config.supabase.serviceRoleKey;

  if (!url || !key || !isValidUrl(url)) {
    return null;
  }

  try {
    return createClient(url, key, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });
  } catch (error) {
    logger.error("Failed to initialize service-role Supabase client", {
      error: error instanceof Error ? error.message : String(error)
    });
    return null;
  }
}

export function getSupabaseConfigFromHeaders(headers: Record<string, unknown>): {
  url: string;
  anonKey: string;
} | null {
  const url = String(headers["x-supabase-url"] || "");
  const anonKey = String(headers["x-supabase-anon-key"] || "");

  if (!url || !anonKey || !isValidUrl(url) || !isValidAnonKey(anonKey)) {
    return null;
  }

  return { url, anonKey };
}

export interface UserSettings {
  id: string;
  user_id: string;
  llm_provider: string | null;
  llm_model: string | null;
  sync_interval_minutes: number;
  created_at: string;
  updated_at: string;
}

export interface ProcessingJob {
  id: string;
  user_id: string;
  status: "queued" | "running" | "completed" | "failed";
  source_type: string;
  payload: Record<string, unknown>;
  runtime_key: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}
