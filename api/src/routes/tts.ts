import { Request, Response, Router } from "express";
import { SDKService } from "../services/SDKService.js";

const router = Router();

/**
 * GET /api/tts/providers
 * List available TTS providers and their configuration options
 */
router.get("/providers", async (req: Request, res: Response) => {
    try {
        const sdk = SDKService.getSDK();
        if (!sdk) {
            return res.status(503).json({
                success: false,
                error: "RealTimeX SDK not available. Please ensure RealTimeX Desktop is running."
            });
        }

        // Check if TTS module is available
        if (!sdk.tts) {
            return res.status(503).json({
                success: false,
                error: "TTS module not available. Please ensure RealTimeX Desktop is running and updated to v1.2.3+."
            });
        }

        const providers = await sdk.tts.listProviders();

        res.json({
            success: true,
            providers
        });
    } catch (error: any) {
        console.error("[TTS API] Failed to list providers:", error);
        res.status(503).json({
            success: false,
            error: error.message || "Failed to list TTS providers. Ensure RealTimeX Desktop is running."
        });
    }
});

/**
 * POST /api/tts/speak
 * Generate full audio buffer for text
 * Body: { text: string, provider?: string, voice?: string, speed?: number }
 */
router.post("/speak", async (req: Request, res: Response) => {
    try {
        const { text, provider, voice, speed, quality } = req.body;

        if (!text || typeof text !== "string") {
            return res.status(400).json({
                success: false,
                error: "Text is required"
            });
        }

        const sdk = SDKService.getSDK();
        if (!sdk) {
            return res.status(503).json({
                success: false,
                error: "RealTimeX SDK not available"
            });
        }

        // Check if TTS module is available
        if (!sdk.tts) {
            return res.status(503).json({
                success: false,
                error: "TTS module not available. Please ensure RealTimeX Desktop is running and updated to v1.2.3+."
            });
        }

        const options: any = {};
        if (provider) options.provider = provider;
        if (voice) options.voice = voice;
        if (speed) options.speed = parseFloat(speed);
        if (quality) options.num_inference_steps = parseInt(quality);

        const audioBuffer = await sdk.tts.speak(text, options);

        // Return audio as binary
        res.setHeader("Content-Type", "audio/mpeg");
        res.send(Buffer.from(audioBuffer));
    } catch (error: any) {
        console.error("[TTS API] Failed to generate speech:", error);
        res.status(500).json({
            success: false,
            error: error.message || "Failed to generate speech"
        });
    }
});

/**
 * POST /api/tts/stream
 * Stream audio chunks via Server-Sent Events
 * Body: { text: string, provider?: string, voice?: string, speed?: number }
 */
router.post("/stream", async (req: Request, res: Response) => {
    try {
        const { text, provider, voice, speed, quality } = req.body;

        if (!text || typeof text !== "string") {
            return res.status(400).json({
                success: false,
                error: "Text is required"
            });
        }

        const sdk = SDKService.getSDK();
        if (!sdk) {
            return res.status(503).json({
                success: false,
                error: "RealTimeX SDK not available"
            });
        }

        // Check if TTS module is available
        if (!sdk.tts) {
            return res.status(503).json({
                success: false,
                error: "TTS module not available. Please ensure RealTimeX Desktop is running and updated to v1.2.3+."
            });
        }

        // Set up SSE
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");

        const options: any = {};
        if (provider) options.provider = provider;
        if (voice) options.voice = voice;
        if (speed) options.speed = parseFloat(speed);
        if (quality) options.num_inference_steps = parseInt(quality);

        // Send info event
        res.write(`event: info\n`);
        res.write(`data: ${JSON.stringify({ message: "Starting TTS generation..." })}\n\n`);

        try {
            // Stream chunks
            for await (const chunk of sdk.tts.speakStream(text, options)) {
                // Encode ArrayBuffer to base64
                const base64Audio = Buffer.from(chunk.audio).toString("base64");

                res.write(`event: chunk\n`);
                res.write(`data: ${JSON.stringify({
                    index: chunk.index,
                    total: chunk.total,
                    audio: base64Audio,
                    mimeType: chunk.mimeType
                })}\n\n`);
            }

            // Send done event
            res.write(`event: done\n`);
            res.write(`data: ${JSON.stringify({ message: "TTS generation complete" })}\n\n`);
        } catch (streamError: any) {
            res.write(`event: error\n`);
            res.write(`data: ${JSON.stringify({ error: streamError.message })}\n\n`);
        }

        res.end();
    } catch (error: any) {
        console.error("[TTS API] Failed to stream speech:", error);

        // If headers not sent yet, send JSON error
        if (!res.headersSent) {
            res.status(500).json({
                success: false,
                error: error.message || "Failed to stream speech"
            });
        } else {
            // Send SSE error event
            res.write(`event: error\n`);
            res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
            res.end();
        }
    }
});

export default router;
