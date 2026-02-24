import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export async function authenticate(req: Request) {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    throw new Error("Missing bearer token");
  }

  const token = authHeader.replace("Bearer ", "");
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const supabaseAnon = Deno.env.get("SUPABASE_ANON_KEY") || "";

  if (!supabaseUrl || !supabaseAnon) {
    throw new Error("Supabase env not configured");
  }

  const client = createClient(supabaseUrl, supabaseAnon, {
    global: {
      headers: {
        Authorization: `Bearer ${token}`
      }
    }
  });

  const {
    data: { user },
    error
  } = await client.auth.getUser(token);

  if (error || !user) {
    throw new Error(error?.message || "Invalid token");
  }

  return { user, client };
}
