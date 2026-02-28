import { Router } from "express";
import axios from "axios";
import { asyncHandler } from "../middleware/errorHandler.js";
import { optionalAuth } from "../middleware/auth.js";

const router = Router();

router.use(optionalAuth);

// GET /api/accounts
router.get(
    "/",
    asyncHandler(async (req, res) => {
        if (!req.user || !req.supabase) {
            res.status(401).json({ error: "Authentication required" });
            return;
        }

        const { data, error } = await req.supabase
            .from("integrations")
            .select("id, provider, is_enabled, created_at, updated_at")
            .eq("user_id", req.user.id);

        if (error) {
            res.status(500).json({ error: error.message });
            return;
        }

        // Map to expected frontend format
        const accounts = data?.map(integration => ({
            id: integration.id,
            email_address: integration.provider, // Just for UI display
            provider: integration.provider,
            is_connected: integration.is_enabled,
            sync_enabled: integration.is_enabled,
            created_at: integration.created_at,
            updated_at: integration.updated_at
        })) || [];

        res.json({ accounts });
    })
);

// POST /api/accounts/google-drive/auth-url
router.post(
    "/google-drive/auth-url",
    asyncHandler(async (req, res) => {
        const { clientId } = req.body;
        if (!clientId) {
            res.status(400).json({ error: "Missing clientId" });
            return;
        }

        const redirectUri = "urn:ietf:wg:oauth:2.0:oob"; // Desktop/local app flow

        // We request drive (full access) to allow downloading and uploading (moving) files
        const params = new URLSearchParams({
            client_id: clientId,
            redirect_uri: redirectUri,
            response_type: "code",
            scope: "https://www.googleapis.com/auth/drive",
            access_type: "offline",
            prompt: "consent",
        });

        const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
        res.json({ authUrl });
    })
);

// POST /api/accounts/google-drive/connect
router.post(
    "/google-drive/connect",
    asyncHandler(async (req, res) => {
        if (!req.supabase || !req.user) {
            res.status(401).json({ error: "Authentication required" });
            return;
        }

        const { authCode, clientId, clientSecret } = req.body;
        if (!authCode || !clientId || !clientSecret) {
            res.status(400).json({ error: "Missing authCode, clientId, or clientSecret" });
            return;
        }

        try {
            // Exchange code for tokens
            const tokenResponse = await axios.post("https://oauth2.googleapis.com/token", null, {
                params: {
                    client_id: clientId,
                    client_secret: clientSecret,
                    code: authCode,
                    grant_type: "authorization_code",
                    redirect_uri: "urn:ietf:wg:oauth:2.0:oob",
                },
            });

            const { access_token, refresh_token, expires_in } = tokenResponse.data;

            const credentials = {
                access_token,
                refresh_token,
                expires_at: Date.now() + expires_in * 1000,
                client_id: clientId,
                client_secret: clientSecret
            };

            // Save to integrations
            const { data: integration, error } = await req.supabase
                .from("integrations")
                .upsert(
                    {
                        user_id: req.user.id,
                        provider: "google_drive",
                        credentials,
                        is_enabled: true
                    },
                    { onConflict: "user_id,provider" }
                )
                .select()
                .single();

            if (error) {
                throw new Error(`Database error: ${error.message}`);
            }

            res.json({ success: true, account: integration });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (error: any) {
            const errorMessage = error.response?.data?.error_description
                || error.response?.data?.error
                || error.message
                || "Failed to connect Google Drive";

            res.status(500).json({
                error: errorMessage
            });
        }
    })
);

export default router;
