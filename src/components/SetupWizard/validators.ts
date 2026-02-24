import { ValidationResult } from "./types";

export function normalizeSupabaseUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return trimmed;
  }
  return `https://${trimmed}.supabase.co`;
}

export function validateUrlFormat(input: string): ValidationResult {
  const trimmed = input.trim();
  if (!trimmed) {
    return { valid: false, message: "URL is required" };
  }

  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    try {
      const url = new URL(trimmed);
      if (url.hostname.endsWith(".supabase.co")) {
        return { valid: true, message: "Valid Supabase URL" };
      }
      return { valid: false, message: "URL must be a supabase.co domain" };
    } catch {
      return { valid: false, message: "Invalid URL format" };
    }
  }

  if (/^[a-z0-9-]+$/.test(trimmed)) {
    return { valid: true, message: "Project ID detected" };
  }

  return { valid: false, message: "Enter a valid URL or project ID" };
}

export function validateKeyFormat(input: string): ValidationResult {
  const trimmed = input.trim();
  if (!trimmed) {
    return { valid: false, message: "API key is required" };
  }

  if (trimmed.startsWith("sb_publishable_")) {
    if (trimmed.length < 25) {
      return { valid: false, message: "Incomplete publishable key" };
    }
    return { valid: true, message: "Valid publishable key" };
  }

  if (trimmed.startsWith("eyJ")) {
    if (trimmed.length < 50) {
      return { valid: false, message: "Incomplete anon key" };
    }
    return { valid: true, message: "Valid anon key" };
  }

  return { valid: false, message: "Invalid API key format" };
}

export function validateAccessToken(token: string): ValidationResult {
  const trimmed = token.trim();

  if (!trimmed) {
    return { valid: false, message: "Access token is required" };
  }

  if (!trimmed.startsWith("sbp_")) {
    return { valid: false, message: "Token must start with sbp_" };
  }

  if (trimmed.length < 20) {
    return { valid: false, message: "Token is too short" };
  }

  return { valid: true, message: "Valid access token" };
}

export function extractProjectId(urlOrId: string): string | null {
  const trimmed = urlOrId.trim();
  if (!trimmed) return null;

  if (!trimmed.includes(".") && !trimmed.includes("/")) {
    return trimmed;
  }

  try {
    const url = new URL(trimmed.startsWith("http") ? trimmed : `https://${trimmed}`);
    return url.hostname.split(".")[0] || null;
  } catch {
    return null;
  }
}
