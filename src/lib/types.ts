export interface BaselineField {
  key: string;
  type: "string" | "number" | "date" | "currency" | "string[]";
  description: string;
  enabled: boolean;
  is_default: boolean;
}

export interface BaselineConfig {
  id: string;
  user_id: string;
  version: number;
  context: string | null;
  fields: BaselineField[];
  is_active: boolean;
  created_at: string;
}

export interface SupabaseConfig {
  url: string;
  anonKey: string;
}

export interface UserSettings {
  id: string;
  user_id: string;
  llm_provider: string | null;
  llm_model: string | null;
  sync_interval_minutes: number;
  auto_trash_spam?: boolean;
  smart_drafts?: boolean;
  storage_path?: string | null;
  intelligent_rename?: boolean;
  // TTS Settings
  tts_auto_play?: boolean;
  tts_provider?: string;
  tts_voice?: string | null;
  tts_speed?: number;
  tts_quality?: number;
  // Embedding Settings
  embedding_provider?: string | null;
  embedding_model?: string | null;
  // BYOK
  google_client_id?: string;
  google_client_secret?: string;
  microsoft_client_id?: string;
  microsoft_client_secret?: string;
  microsoft_tenant_id?: string;
  created_at: string;
  updated_at: string;
}

export interface EmailAccount {
  id: string;
  user_id: string;
  provider: "gmail" | "outlook" | "imap";
  email_address: string;
  is_active: boolean;
  connection_type?: "oauth" | "imap" | null;
  last_sync_checkpoint?: string | null;
  sync_start_date?: string | null;
  last_sync_at?: string | null;
  last_sync_status?: "idle" | "syncing" | "success" | "error";
  last_sync_error?: string | null;
  created_at: string;
  updated_at: string;
}

export interface Rule {
  id: string;
  user_id: string;
  name: string;
  description?: string;
  condition: any;
  action?: string;
  actions?: string[];
  is_enabled: boolean;
  is_system?: boolean;
  created_at: string;
}

export interface Stats {
  totalEmails: number;
  categoryCounts: Record<string, number>;
  actionCounts: Record<string, number>;
  accountCount: number;
}

export interface ProcessingJob {
  id: string;
  user_id: string;
  status: "queued" | "running" | "completed" | "failed";
  source_type: string;
  payload: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  error_message: string | null;
}

export interface ApiError {
  code?: string;
  message: string;
}

export interface ApiResponse<T> {
  data?: T;
  error?: ApiError | string;
}

export interface Profile {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  avatar_url: string | null;
  is_admin: boolean;
  created_at: string;
  updated_at: string;
}
