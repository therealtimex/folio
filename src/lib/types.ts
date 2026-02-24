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
  created_at: string;
  updated_at: string;
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
