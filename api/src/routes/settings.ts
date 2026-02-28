import { Router } from "express";
import { asyncHandler } from "../middleware/errorHandler.js";
import { optionalAuth } from "../middleware/auth.js";

const router = Router();
router.use(optionalAuth);

router.get("/", asyncHandler(async (req, res) => {
    if (!req.supabase || !req.user) {
        res.status(401).json({ error: "Authentication required" });
        return;
    }

    const { data, error } = await req.supabase
        .from("user_settings")
        .select("*")
        .eq("user_id", req.user.id)
        .maybeSingle();

    if (error) {
        res.status(500).json({ error: error.message });
        return;
    }

    res.json({ settings: data });
}));

router.patch("/", asyncHandler(async (req, res) => {
    if (!req.supabase || !req.user) {
        res.status(401).json({ error: "Authentication required" });
        return;
    }

    const body = req.body;
    const rawVisionMap = body.vision_model_capabilities;
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
        embedding_model: body.embedding_model,
        storage_path: body.storage_path,
        vision_model_capabilities: rawVisionMap && typeof rawVisionMap === "object" && !Array.isArray(rawVisionMap)
            ? rawVisionMap
            : undefined,
        google_client_id: body.google_client_id,
        google_client_secret: body.google_client_secret,
        microsoft_client_id: body.microsoft_client_id,
        microsoft_tenant_id: body.microsoft_tenant_id
    };

    // Remove undefined fields
    Object.keys(payload).forEach(key => {
        if ((payload as any)[key] === undefined) {
            delete (payload as any)[key];
        }
    });

    const { data, error } = await req.supabase
        .from("user_settings")
        .upsert({ user_id: req.user.id, ...payload }, { onConflict: "user_id" })
        .select("*")
        .single();

    if (error) {
        res.status(500).json({ error: error.message });
        return;
    }

    res.json({ settings: data });
}));

export default router;
