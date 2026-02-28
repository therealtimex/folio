import { Router, Request, Response } from "express";
import { SDKService } from "../services/SDKService.js";
import { ProvidersResponse } from "@realtimex/sdk";
import { createLogger } from "../utils/logger.js";
import { extractLlmResponse, previewLlmText } from "../utils/llmResponse.js";

const router = Router();
const logger = createLogger("SDKRoutes");

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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

        logger.info("LLM request (sdk test-llm)", { provider, model });
        const response = await sdk.llm.chat(
            [{ role: "user", content: "Say OK" }],
            { provider, model }
        );
        const raw = extractLlmResponse(response);
        logger.info("LLM response (sdk test-llm)", {
            provider,
            model,
            raw_length: raw.length,
            raw_preview: previewLlmText(raw),
        });

        if (response.success) {
            res.json({ success: true, message: `Connected to ${provider}/${model}` });
        } else {
            res.json({ success: false, message: response.error || "Failed to connect to LLM" });
        }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
        logger.error("LLM sdk test failed", { error: error?.message ?? String(error) });
        res.json({ success: false, message: error.message });
    }
});

export default router;
