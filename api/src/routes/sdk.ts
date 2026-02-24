import { Router, Request, Response } from "express";
import { SDKService } from "../services/SDKService.js";
import { ProvidersResponse } from "@realtimex/sdk";

const router = Router();

/**
 * GET /api/sdk/providers/chat
 * Returns available chat providers and their models
 */
router.get("/providers/chat", async (req: Request, res: Response) => {
    try {
        const sdk = SDKService.getSDK();
        if (!sdk) {
            return res.json({ success: false, message: "SDK not available", providers: [] });
        }

        const { providers } = await SDKService.withTimeout<ProvidersResponse>(
            sdk.llm.chatProviders(),
            30000,
            "Chat providers fetch timed out"
        );

        res.json({ success: true, providers: providers || [] });
    } catch (error: any) {
        res.json({ success: false, providers: [], message: error.message });
    }
});

/**
 * GET /api/sdk/providers/embed
 * Returns available embedding providers and their models
 */
router.get("/providers/embed", async (req: Request, res: Response) => {
    try {
        const sdk = SDKService.getSDK();
        if (!sdk) {
            return res.json({ success: false, message: "SDK not available", providers: [] });
        }

        const { providers } = await SDKService.withTimeout<ProvidersResponse>(
            sdk.llm.embedProviders(),
            30000,
            "Embed providers fetch timed out"
        );

        res.json({ success: true, providers: providers || [] });
    } catch (error: any) {
        res.json({ success: false, providers: [], message: error.message });
    }
});

/**
 * POST /api/sdk/test-llm
 * Tests connection to a specific LLM provider/model
 */
router.post("/test-llm", async (req: Request, res: Response) => {
    try {
        const { llm_provider, llm_model } = req.body;
        const sdk = SDKService.getSDK();
        if (!sdk) {
            return res.json({ success: false, message: "SDK not available" });
        }

        const { provider, model } = await SDKService.resolveChatProvider({
            llm_provider,
            llm_model
        });

        const response = await sdk.llm.chat(
            [{ role: "user", content: "Say OK" }],
            { provider, model }
        );

        if (response.success) {
            res.json({ success: true, message: `Connected to ${provider}/${model}` });
        } else {
            res.json({ success: false, message: response.error || "Failed to connect to LLM" });
        }
    } catch (error: any) {
        res.json({ success: false, message: error.message });
    }
});

export default router;
