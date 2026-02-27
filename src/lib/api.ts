import { getApiConfig } from "./api-config";
import type { ApiResponse, ProcessingJob, UserSettings, EmailAccount, Rule, Stats, Profile, BaselineConfig, BaselineField } from "./types";

interface ApiOptions extends RequestInit {
  auth?: boolean;
  token?: string | null;
}

export interface ChatSource {
  id: string;
  ingestion_id: string;
  content: string;
  similarity: number;
}

export interface ChatMessage {
  id: string;
  session_id?: string;
  user_id?: string;
  role: "user" | "assistant" | "system";
  content: string;
  context_sources?: ChatSource[];
  created_at: string;
}

export interface ChatSession {
  id: string;
  title: string;
  created_at?: string;
  updated_at: string;
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

  get<T>(endpoint: string, options: ApiOptions = {}) {
    return this.expressRequest<T>(endpoint, { method: "GET", ...options, auth: true });
  }

  post<T>(endpoint: string, data?: unknown, options: ApiOptions = {}) {
    return this.expressRequest<T>(endpoint, {
      method: "POST",
      body: data ? JSON.stringify(data) : undefined,
      ...options,
      auth: true
    });
  }

  getChatSessions(token?: string | null) {
    return this.expressRequest<{ success: boolean; sessions: ChatSession[] }>("/api/chat/sessions", {
      method: "GET",
      auth: Boolean(token),
      token
    });
  }

  createChatSession(token?: string | null) {
    return this.expressRequest<{ success: boolean; session: ChatSession }>("/api/chat/sessions", {
      method: "POST",
      auth: Boolean(token),
      token
    });
  }

  getChatMessages(sessionId: string, token?: string | null) {
    return this.expressRequest<{ success: boolean; messages: ChatMessage[] }>(`/api/chat/sessions/${sessionId}/messages`, {
      method: "GET",
      auth: Boolean(token),
      token
    });
  }

  sendChatMessage(payload: { sessionId: string; content: string }, token?: string | null) {
    return this.expressRequest<{ success: boolean; message: ChatMessage }>("/api/chat/message", {
      method: "POST",
      auth: Boolean(token),
      token,
      body: JSON.stringify(payload)
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
    return this.expressRequest<{ settings: UserSettings | null }>("/api/settings", {
      method: "GET",
      auth: Boolean(token),
      token
    });
  }

  updateSettings(settings: Partial<UserSettings>, token?: string | null) {
    return this.expressRequest<{ success: boolean; settings: UserSettings }>("/api/settings", {
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

  getGoogleDriveAuthUrl(clientId: string, token?: string | null) {
    return this.expressRequest<{ authUrl: string }>("/api/accounts/google-drive/auth-url", {
      method: "POST",
      auth: Boolean(token),
      token,
      body: JSON.stringify({ clientId })
    });
  }

  connectGoogleDrive(authCode: string, clientId: string, clientSecret: string, token?: string | null) {
    return this.expressRequest<{ success: boolean; account: any }>("/api/accounts/google-drive/connect", {
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

  // ─── Policy Engine API ─────────────────────────────────────────────────────

  getPolicies(token?: string | null) {
    return this.expressRequest<{ success: boolean; policies: any[] }>("/api/policies", {
      auth: Boolean(token), token
    });
  }

  savePolicy(policy: unknown, token?: string | null) {
    return this.expressRequest<{ success: boolean; filePath: string }>("/api/policies", {
      method: "POST",
      auth: Boolean(token), token,
      body: JSON.stringify(policy)
    });
  }

  deletePolicy(id: string, token?: string | null) {
    return this.expressRequest<{ success: boolean }>(`/api/policies/${id}`, {
      method: "DELETE",
      auth: Boolean(token), token
    });
  }

  patchPolicy(id: string, patch: { enabled?: boolean; name?: string; description?: string; tags?: string[]; priority?: number }, token?: string | null) {
    return this.expressRequest<{ success: boolean }>(`/api/policies/${id}`, {
      method: "PATCH",
      auth: Boolean(token), token,
      body: JSON.stringify(patch)
    });
  }

  reloadPolicies(token?: string | null) {
    return this.expressRequest<{ success: boolean; count: number }>("/api/policies/reload", {
      method: "POST",
      auth: Boolean(token), token
    });
  }

  synthesizePolicy(payload: { description: string; provider?: string; model?: string }, token?: string | null) {
    return this.expressRequest<{ success: boolean; policy: any }>("/api/policies/synthesize", {
      method: "POST",
      auth: Boolean(token), token,
      body: JSON.stringify(payload)
    });
  }

  getSDKChatProviders() {
    return this.expressRequest<{ success: boolean; providers: { provider: string; models: { id: string }[] }[] }>("/api/sdk/providers/chat");
  }

  // ─── Ingestion / Funnel API ─────────────────────────────────────────────────

  getIngestions(params: { page?: number; pageSize?: number; q?: string } = {}, token?: string | null) {
    const qs = new URLSearchParams();
    if (params.page) qs.set("page", String(params.page));
    if (params.pageSize) qs.set("pageSize", String(params.pageSize));
    if (params.q) qs.set("q", params.q);
    const query = qs.toString() ? `?${qs}` : "";
    return this.expressRequest<{ success: boolean; ingestions: any[]; total: number; page: number; pageSize: number }>(
      `/api/ingestions${query}`,
      { auth: Boolean(token), token }
    );
  }

  uploadDocument(file: File, token?: string | null) {
    const form = new FormData();
    form.append("file", file);
    const config = getApiConfig();
    const headers: Record<string, string> = {
      "X-Supabase-Url": config.edgeFunctionsUrl.replace("/functions/v1", ""),
      "X-Supabase-Anon-Key": config.anonKey
    };
    if (token) headers["Authorization"] = `Bearer ${token}`;
    return fetch(`${config.expressApiUrl}/api/ingestions/upload`, { method: "POST", headers, body: form })
      .then((r) => r.json()) as Promise<{ success: boolean; ingestion: any }>;
  }

  rerunIngestion(id: string, token?: string | null) {
    return this.expressRequest<{ success: boolean; matched: boolean }>(`/api/ingestions/${id}/rerun`, {
      method: "POST",
      auth: Boolean(token), token
    });
  }

  deleteIngestion(id: string, token?: string | null) {
    return this.expressRequest<{ success: boolean }>(`/api/ingestions/${id}`, {
      method: "DELETE",
      auth: Boolean(token), token
    });
  }

  updateIngestionTags(id: string, tags: string[], token?: string | null) {
    return this.expressRequest<{ success: boolean; tags: string[] }>(`/api/ingestions/${id}/tags`, {
      method: "PATCH",
      auth: Boolean(token), token,
      body: JSON.stringify({ tags })
    });
  }

  summarizeIngestion(id: string, token?: string | null) {
    return this.expressRequest<{ success: boolean; summary: string | null }>(`/api/ingestions/${id}/summarize`, {
      method: "POST",
      auth: Boolean(token), token
    });
  }

  // ─── Baseline Config API ────────────────────────────────────────────────────

  getBaselineConfig(token?: string | null) {
    return this.expressRequest<{ success: boolean; config: BaselineConfig | null; defaults: BaselineField[] }>(
      "/api/baseline-config",
      { auth: Boolean(token), token }
    );
  }

  getBaselineConfigHistory(token?: string | null) {
    return this.expressRequest<{ success: boolean; history: BaselineConfig[] }>(
      "/api/baseline-config/history",
      { auth: Boolean(token), token }
    );
  }

  saveBaselineConfig(
    payload: { context?: string | null; fields: BaselineField[]; activate?: boolean },
    token?: string | null
  ) {
    return this.expressRequest<{ success: boolean; config: BaselineConfig }>(
      "/api/baseline-config",
      { method: "POST", auth: Boolean(token), token, body: JSON.stringify(payload) }
    );
  }

  activateBaselineConfig(id: string, token?: string | null) {
    return this.expressRequest<{ success: boolean }>(
      `/api/baseline-config/${id}/activate`,
      { method: "POST", auth: Boolean(token), token }
    );
  }

  suggestBaselineConfig(
    payload: { description: string; provider?: string; model?: string },
    token?: string | null
  ) {
    return this.expressRequest<{ success: boolean; suggestion: { context: string; fields: import("./types").BaselineField[] } }>(
      "/api/baseline-config/suggest",
      { method: "POST", auth: Boolean(token), token, body: JSON.stringify(payload) }
    );
  }
}

export const api = new HybridApiClient();
