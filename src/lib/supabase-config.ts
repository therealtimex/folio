import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { SupabaseConfig } from "./types";

const STORAGE_KEY = "folio_supabase_config";

function isValidConfig(config: unknown): config is SupabaseConfig {
  if (!config || typeof config !== "object") {
    return false;
  }

  const maybe = config as { url?: unknown; anonKey?: unknown };
  return (
    typeof maybe.url === "string" &&
    typeof maybe.anonKey === "string" &&
    maybe.url.startsWith("http") &&
    maybe.anonKey.length > 20 &&
    !maybe.url.includes("placeholder.supabase.co")
  );
}

export function getSupabaseConfig(): SupabaseConfig | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (isValidConfig(parsed)) {
        return parsed;
      }
    }
  } catch {
    // no-op
  }

  const envConfig = {
    url: import.meta.env.VITE_SUPABASE_URL,
    anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY
  };

  return isValidConfig(envConfig) ? envConfig : null;
}

export function saveSupabaseConfig(config: SupabaseConfig): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

export function clearSupabaseConfig(): void {
  localStorage.removeItem(STORAGE_KEY);
}

export async function validateSupabaseConnection(
  url: string,
  anonKey: string
): Promise<{ valid: boolean; error?: string }> {
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    return { valid: false, error: "Invalid URL format" };
  }

  const isJwtKey = anonKey.startsWith("eyJ");
  const isPublishableKey = anonKey.startsWith("sb_publishable_");

  if (!isJwtKey && !isPublishableKey) {
    return { valid: false, error: "Invalid anon key format" };
  }

  if (isPublishableKey) {
    return { valid: true };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort("Validation timeout"), 12_000);

  try {
    const response = await fetch(`${url}/rest/v1/`, {
      method: "GET",
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`
      },
      signal: controller.signal
    });

    if (!response.ok) {
      clearTimeout(timeoutId);
      return { valid: false, error: `Connection failed (${response.status})` };
    }

    clearTimeout(timeoutId);
    return { valid: true };
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof DOMException && error.name === "AbortError") {
      return {
        valid: false,
        error: "Connection validation timed out (12s). Check project URL/key and network."
      };
    }
    return {
      valid: false,
      error: error instanceof Error ? error.message : "Connection failed"
    };
  }
}

export function getConfigSource(): "ui" | "env" | "none" {
  if (localStorage.getItem(STORAGE_KEY)) {
    return "ui";
  }

  if (import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY) {
    return "env";
  }

  return "none";
}

let supabaseInstance: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient | null {
  const config = getSupabaseConfig();
  if (!config) {
    supabaseInstance = null;
    return null;
  }

  if (!supabaseInstance) {
    supabaseInstance = createClient(config.url, config.anonKey, {
      auth: {
        autoRefreshToken: true,
        persistSession: true
      }
    });
  }

  return supabaseInstance;
}
