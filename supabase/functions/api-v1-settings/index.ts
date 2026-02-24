import { corsHeaders } from "../_shared/cors.ts";
import { authenticate } from "../_shared/auth.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { user, client } = await authenticate(req);

    if (req.method === "GET") {
      const { data, error } = await client
        .from("user_settings")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle();

      if (error) {
        return Response.json({ error: error.message }, { status: 500, headers: corsHeaders });
      }

      return Response.json({ settings: data }, { headers: corsHeaders });
    }

    if (req.method === "PATCH") {
      const body = await req.json();
      const payload = {
        llm_provider: body.llm_provider,
        llm_model: body.llm_model,
        sync_interval_minutes: body.sync_interval_minutes,
        tts_auto_play: body.tts_auto_play,
        tts_provider: body.tts_provider,
        tts_voice: body.tts_voice,
        tts_speed: body.tts_speed,
        tts_quality: body.tts_quality,
        embedding_provider: body.embedding_provider,
        embedding_model: body.embedding_model
      };

      const { data, error } = await client
        .from("user_settings")
        .upsert({ user_id: user.id, ...payload }, { onConflict: "user_id" })
        .select("*")
        .single();

      if (error) {
        return Response.json({ error: error.message }, { status: 500, headers: corsHeaders });
      }

      return Response.json({ settings: data }, { headers: corsHeaders });
    }

    return Response.json({ error: "Method not allowed" }, { status: 405, headers: corsHeaders });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unexpected error" },
      { status: 401, headers: corsHeaders }
    );
  }
});
