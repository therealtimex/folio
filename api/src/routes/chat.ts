import { Router } from "express";
import { asyncHandler } from "../middleware/errorHandler.js";
import { optionalAuth } from "../middleware/auth.js";
import { ChatService } from "../services/ChatService.js";

const router = Router();

interface PostMessageBody {
    sessionId?: string;
    content?: string;
}

// All chat routes require authentication
router.use(optionalAuth);

// GET /api/chat/sessions
router.get(
    "/sessions",
    asyncHandler(async (req, res) => {
        if (!req.supabase || !req.user) {
            res.status(401).json({ success: false, error: "Authentication required" });
            return;
        }

        const { data: sessions, error } = await req.supabase
            .from("chat_sessions")
            .select("*")
            .eq("user_id", req.user.id)
            .order("updated_at", { ascending: false });

        if (error) {
            res.status(500).json({ success: false, error: error.message });
            return;
        }

        res.json({ success: true, sessions });
    })
);

// POST /api/chat/sessions
router.post(
    "/sessions",
    asyncHandler(async (req, res) => {
        if (!req.supabase || !req.user) {
            res.status(401).json({ success: false, error: "Authentication required" });
            return;
        }

        const { data: session, error } = await req.supabase
            .from("chat_sessions")
            .insert({ user_id: req.user.id, title: "New Conversation" })
            .select("*")
            .single();

        if (error) {
            res.status(500).json({ success: false, error: error.message });
            return;
        }

        res.status(201).json({ success: true, session });
    })
);

// GET /api/chat/sessions/:id/messages
router.get(
    "/sessions/:id/messages",
    asyncHandler(async (req, res) => {
        if (!req.supabase || !req.user) {
            res.status(401).json({ success: false, error: "Authentication required" });
            return;
        }

        // Verify session belongs to user
        const { data: sessionData } = await req.supabase
            .from("chat_sessions")
            .select("id")
            .eq("id", req.params["id"] as string)
            .eq("user_id", req.user.id)
            .maybeSingle();

        if (!sessionData) {
            res.status(404).json({ success: false, error: "Session not found" });
            return;
        }

        const { data: messages, error } = await req.supabase
            .from("chat_messages")
            .select("*")
            .eq("session_id", req.params["id"] as string)
            .eq("user_id", req.user.id)
            .order("created_at", { ascending: true });

        if (error) {
            res.status(500).json({ success: false, error: error.message });
            return;
        }

        res.json({ success: true, messages });
    })
);

// POST /api/chat/message
router.post(
    "/message",
    asyncHandler(async (req, res) => {
        if (!req.supabase || !req.user) {
            res.status(401).json({ success: false, error: "Authentication required" });
            return;
        }

        const { sessionId, content } = (req.body ?? {}) as PostMessageBody;
        const normalizedSessionId = typeof sessionId === "string" ? sessionId : "";
        const trimmedContent = typeof content === "string" ? content.trim() : "";
        if (!normalizedSessionId || !trimmedContent) {
            res.status(400).json({ success: false, error: "Missing sessionId or content" });
            return;
        }

        // Verify session belongs to user
        const { data: sessionData } = await req.supabase
            .from("chat_sessions")
            .select("id")
            .eq("id", normalizedSessionId)
            .eq("user_id", req.user.id)
            .maybeSingle();

        if (!sessionData) {
            res.status(404).json({ success: false, error: "Session not found" });
            return;
        }

        // Dynamically name session if it's the first message
        const { count } = await req.supabase
            .from("chat_messages")
            .select("*", { count: 'exact', head: true })
            .eq("session_id", normalizedSessionId)
            .eq("user_id", req.user.id);

        if (count === 0 && trimmedContent.length > 3) {
            const title = trimmedContent.substring(0, 30) + (trimmedContent.length > 30 ? "..." : "");
            await req.supabase.from("chat_sessions").update({ title }).eq("id", normalizedSessionId);
        }

        try {
            const aiMessage = await ChatService.handleMessage(normalizedSessionId, req.user.id, trimmedContent, req.supabase);
            res.json({ success: true, message: aiMessage });
        } catch (error) {
            const message = error instanceof Error ? error.message : "Failed to process message";
            res.status(500).json({ success: false, error: message });
        }
    })
);

export default router;
