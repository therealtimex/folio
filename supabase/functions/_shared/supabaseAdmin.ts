import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export function getAdminClient() {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing");
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
}
