import { getApiConfig } from "./api-config";
import type { ApiResponse, ProcessingJob, UserSettings, EmailAccount, Rule, Stats, Profile } from "./types";

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

  updateSettings(settings: Partial<UserSettings>, token?: string | null) {
    return this.edgeRequest<{ success: boolean; settings: UserSettings }>("/api-v1-settings", {
      method: "PATCH",
      auth: Boolean(token),
      token,
      body: JSON.stringify(settings)
    });
  }

  getAccounts(token?: string | null) {
    return this.expressRequest<{ accounts: EmailAccount[] }>("/api/accounts", {
      method: "GET",
      auth: Boolean(token),
      token
    });
  }

  disconnectAccount(accountId: string, token?: string | null) {
    return this.expressRequest<{ success: boolean }>("/api/accounts/disconnect", {
      method: "POST",
      auth: Boolean(token),
      token,
      body: JSON.stringify({ accountId })
    });
  }

  getRules(token?: string | null) {
    return this.expressRequest<{ rules: Rule[] }>("/api/rules", {
      method: "GET",
      auth: Boolean(token),
      token
    });
  }

  createRule(rule: any, token?: string | null) {
    return this.expressRequest<{ success: boolean; rule: Rule }>("/api/rules", {
      method: "POST",
      auth: Boolean(token),
      token,
      body: JSON.stringify(rule)
    });
  }

  updateRule(ruleId: string, updates: any, token?: string | null) {
    return this.expressRequest<{ success: boolean; rule: Rule }>(`/api/rules/${ruleId}`, {
      method: "PATCH",
      auth: Boolean(token),
      token,
      body: JSON.stringify(updates)
    });
  }

  deleteRule(ruleId: string, token?: string | null) {
    return this.expressRequest<{ success: boolean }>(`/api/rules/${ruleId}`, {
      method: "DELETE",
      auth: Boolean(token),
      token
    });
  }

  toggleRule(ruleId: string, token?: string | null) {
    return this.expressRequest<{ success: boolean; rule: Rule }>(`/api/rules/${ruleId}/toggle`, {
      method: "POST",
      auth: Boolean(token),
      token
    });
  }

  getStats(token?: string | null) {
    return this.expressRequest<{ stats: Stats }>("/api/stats", {
      method: "GET",
      auth: Boolean(token),
      token
    });
  }

  getProfile(token?: string | null) {
    return this.edgeRequest<Profile>("/api-v1-profile", {
      method: "GET",
      auth: Boolean(token),
      token
    });
  }

  updateProfile(updates: any, token?: string | null) {
    return this.edgeRequest<Profile>("/api-v1-profile", {
      method: "PATCH",
      auth: Boolean(token),
      token,
      body: JSON.stringify(updates)
    });
  }

  getChatProviders(token?: string | null) {
    return this.expressRequest<{ providers: any[] }>("/api/sdk/providers/chat", {
      method: "GET",
      auth: Boolean(token),
      token
    });
  }

  getEmbedProviders(token?: string | null) {
    return this.expressRequest<{ providers: any[] }>("/api/sdk/providers/embed", {
      method: "GET",
      auth: Boolean(token),
      token
    });
  }

  testLlm(config: any, token?: string | null) {
    return this.expressRequest<{ success: boolean; message: string }>("/api/sdk/test-llm", {
      method: "POST",
      auth: Boolean(token),
      token,
      body: JSON.stringify(config)
    });
  }

  getGmailAuthUrl(clientId: string, clientSecret: string, token?: string | null) {
    return this.expressRequest<{ authUrl: string }>("/api/accounts/gmail/auth-url", {
      method: "POST",
      auth: Boolean(token),
      token,
      body: JSON.stringify({ clientId, clientSecret })
    });
  }

  connectGmail(authCode: string, clientId: string, clientSecret: string, token?: string | null) {
    return this.expressRequest<{ success: boolean; account: EmailAccount }>("/api/accounts/gmail/connect", {
      method: "POST",
      auth: Boolean(token),
      token,
      body: JSON.stringify({ authCode, clientId, clientSecret })
    });
  }

  startMicrosoftDeviceFlow(clientId: string, tenantId: string, token?: string | null) {
    return this.expressRequest<{ deviceCode: any }>("/api/accounts/microsoft/device-flow", {
      method: "POST",
      auth: Boolean(token),
      token,
      body: JSON.stringify({ clientId, tenantId })
    });
  }

  pollMicrosoftDeviceCode(deviceCode: any, clientId: string, tenantId: string, token?: string | null) {
    return this.expressRequest<{ success: boolean; account: EmailAccount }>("/api/accounts/microsoft/poll", {
      method: "POST",
      auth: Boolean(token),
      token,
      body: JSON.stringify({ deviceCode, clientId, tenantId })
    });
  }

  connectImap(config: any, token?: string | null) {
    return this.expressRequest<{ success: boolean; account: EmailAccount }>("/api/accounts/imap/connect", {
      method: "POST",
      auth: Boolean(token),
      token,
      body: JSON.stringify(config)
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
