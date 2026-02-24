import { getSupabaseConfig } from "./supabase-config";

export interface ApiConfig {
  edgeFunctionsUrl: string;
  expressApiUrl: string;
  anonKey: string;
}

export function getApiConfig(): ApiConfig {
  const supabaseConfig = getSupabaseConfig();
  const edgeFunctionsUrl = supabaseConfig ? `${supabaseConfig.url}/functions/v1` : "";
  const anonKey = supabaseConfig?.anonKey ?? "";

  const isViteDev = window.location.port === "5173";
  const envApiUrl = import.meta.env.VITE_API_URL;

  const expressApiUrl = isViteDev ? envApiUrl || "http://localhost:3006" : window.location.origin;

  return {
    edgeFunctionsUrl,
    expressApiUrl,
    anonKey
  };
}
