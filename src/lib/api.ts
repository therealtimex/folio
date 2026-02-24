import { getApiConfig } from "./api-config";
import type { ApiResponse, ProcessingJob, UserSettings } from "./types";

interface ApiOptions extends RequestInit {
  auth?: boolean;
  token?: string | null;
}

class HybridApiClient {
  private edgeFunctionsUrl: string;
  private expressApiUrl: string;
  private anonKey: string;

  constructor() {
    const config = getApiConfig();
    this.edgeFunctionsUrl = config.edgeFunctionsUrl;
    this.expressApiUrl = config.expressApiUrl;
    this.anonKey = config.anonKey;
  }

  private async request<T>(
    baseUrl: string,
    endpoint: string,
    options: ApiOptions = {}
  ): Promise<ApiResponse<T>> {
    const { auth = false, token, ...fetchOptions } = options;

    const headers: HeadersInit = {
      "Content-Type": "application/json",
      ...(fetchOptions.headers || {})
    };

    if (auth && token) {
      (headers as Record<string, string>).Authorization = `Bearer ${token}`;
    }

    try {
      const response = await fetch(`${baseUrl}${endpoint}`, {
        ...fetchOptions,
        headers
      });

      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        return {
          error: {
            code: payload?.error?.code || "API_ERROR",
            message: payload?.error?.message || payload?.error || `Request failed (${response.status})`
          }
        };
      }

      return { data: payload as T };
    } catch (error) {
      return {
        error: {
          code: "NETWORK_ERROR",
          message: error instanceof Error ? error.message : "Network error"
        }
      };
    }
  }

  private edgeRequest<T>(endpoint: string, options: ApiOptions = {}) {
    const headers: HeadersInit = {
      ...(options.headers || {}),
      apikey: this.anonKey
    };

    return this.request<T>(this.edgeFunctionsUrl, endpoint, {
      ...options,
      headers
    });
  }

  private expressRequest<T>(endpoint: string, options: ApiOptions = {}) {
    const config = getApiConfig();
    const headers: HeadersInit = {
      ...(options.headers || {}),
      "X-Supabase-Url": config.edgeFunctionsUrl.replace("/functions/v1", ""),
      "X-Supabase-Anon-Key": config.anonKey
    };

    return this.request<T>(this.expressApiUrl, endpoint, {
      ...options,
      headers
    });
  }

  getHealth() {
    return this.expressRequest<{
      status: string;
      timestamp: string;
      version: string;
      environment: string;
      services: Record<string, string>;
    }>("/api/health", { method: "GET" });
  }

  testSupabase(url: string, anonKey: string) {
    return this.expressRequest<{ valid: boolean; message?: string }>("/api/setup/test-supabase", {
      method: "POST",
      body: JSON.stringify({ url, anonKey })
    });
  }

  dispatchProcessingJob(payload: Record<string, unknown>, token?: string | null) {
    return this.expressRequest<{ success: boolean; job: ProcessingJob }>("/api/processing/dispatch", {
      method: "POST",
      auth: Boolean(token),
      token,
      body: JSON.stringify({ source_type: "manual", payload })
    });
  }

  getSettings(token?: string | null) {
    return this.edgeRequest<{ settings: UserSettings | null }>("/api-v1-settings", {
      method: "GET",
      auth: Boolean(token),
      token
    });
  }

  setup(payload: Record<string, unknown>) {
    return this.edgeRequest<{ data: { id: string; email: string } }>("/setup", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  }
}

export const api = new HybridApiClient();
