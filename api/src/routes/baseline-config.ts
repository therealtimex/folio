import { Router } from "express";
import { asyncHandler } from "../middleware/errorHandler.js";
import { optionalAuth } from "../middleware/auth.js";
import { BaselineConfigService, DEFAULT_BASELINE_FIELDS } from "../services/BaselineConfigService.js";
import { PolicyEngine } from "../services/PolicyEngine.js";

const router = Router();
router.use(optionalAuth);

// GET /api/baseline-config
// Returns the active config. If none exists, returns the built-in defaults
// with id: null so the UI can distinguish "never saved" from "saved and active".
router.get(
    "/",
    asyncHandler(async (req, res) => {
        if (!req.supabase || !req.user) {
            res.status(401).json({ success: false, error: "Authentication required" });
            return;
        }
        const config = await BaselineConfigService.getActive(req.supabase, req.user.id);
        res.json({
            success: true,
            config,
            defaults: DEFAULT_BASELINE_FIELDS,
        });
    })
);

// GET /api/baseline-config/history
// Returns all saved versions for the user, newest first.
router.get(
    "/history",
    asyncHandler(async (req, res) => {
        if (!req.supabase || !req.user) {
            res.status(401).json({ success: false, error: "Authentication required" });
            return;
        }
        const history = await BaselineConfigService.list(req.supabase, req.user.id);
        res.json({ success: true, history });
    })
);

// POST /api/baseline-config
// Save a new version. Body: { context?, fields[], activate? }
// Always creates a new row — never mutates an existing version.
router.post(
    "/",
    asyncHandler(async (req, res) => {
        if (!req.supabase || !req.user) {
            res.status(401).json({ success: false, error: "Authentication required" });
            return;
        }
        const { context, fields, activate = true } = req.body;
        if (!Array.isArray(fields) || fields.length === 0) {
            res.status(400).json({ success: false, error: "fields array is required and must not be empty" });
            return;
        }
        const config = await BaselineConfigService.save(
            req.supabase,
            req.user.id,
            { context, fields },
            activate
        );
        res.status(201).json({ success: true, config });
    })
);

// POST /api/baseline-config/:id/activate
// Activate a previously saved version.
router.post(
    "/:id/activate",
    asyncHandler(async (req, res) => {
        if (!req.supabase || !req.user) {
            res.status(401).json({ success: false, error: "Authentication required" });
            return;
        }
        const ok = await BaselineConfigService.activate(
            req.supabase,
            req.user.id,
            req.params.id as string
        );
        if (!ok) {
            res.status(404).json({ success: false, error: "Config version not found" });
            return;
        }
        res.json({ success: true });
    })
);

// POST /api/baseline-config/suggest
// Body: { description, provider?, model? }
// Returns a draft { context, fields[] } for the user to review before saving.
router.post(
    "/suggest",
    asyncHandler(async (req, res) => {
        if (!req.supabase || !req.user) {
            res.status(401).json({ success: false, error: "Authentication required" });
            return;
        }
        const { description, provider, model } = req.body;
        if (!description || typeof description !== "string") {
            res.status(400).json({ success: false, error: "description is required" });
            return;
        }

        // Pass current active fields so the LLM avoids duplicating them
        const activeConfig = await BaselineConfigService.getActive(req.supabase, req.user.id);
        const currentFields = activeConfig?.fields ?? DEFAULT_BASELINE_FIELDS;

        const result = await PolicyEngine.suggestBaseline(description, currentFields, { provider, model });
        if (!result.suggestion) {
            res.status(503).json({ success: false, error: result.error ?? "Suggestion failed. SDK may be unavailable." });
            return;
        }
        res.json({ success: true, suggestion: result.suggestion });
    })
);

export default router;
