import { Router } from "express";
import { asyncHandler } from "../middleware/errorHandler.js";
import { optionalAuth } from "../middleware/auth.js";
import { PolicyLoader } from "../services/PolicyLoader.js";
import { PolicyEngine } from "../services/PolicyEngine.js";

const router = Router();

// Use optionalAuth on all routes — sets req.supabase + req.user if a valid
// bearer token is present. Falls through without error if no token.
router.use(optionalAuth);

// GET /api/policies — list all loaded policies
router.get(
    "/",
    asyncHandler(async (req, res) => {
        const policies = await PolicyLoader.load(false, req.supabase);
        res.json({ success: true, policies });
    })
);

// POST /api/policies — save a new policy
router.post(
    "/",
    asyncHandler(async (req, res) => {
        const policy = req.body;
        if (!PolicyLoader.validate(policy)) {
            res.status(400).json({ success: false, error: "Invalid policy schema" });
            return;
        }
        const filePath = await PolicyLoader.save(policy, req.supabase, req.user?.id);
        res.status(201).json({ success: true, filePath });
    })
);

// DELETE /api/policies/:id — delete a policy by ID
router.delete(
    "/:id",
    asyncHandler(async (req, res) => {
        const deleted = await PolicyLoader.delete(req.params["id"] as string, req.supabase, req.user?.id);
        if (!deleted) {
            res.status(404).json({ success: false, error: "Policy not found" });
            return;
        }
        res.json({ success: true });
    })
);

// PATCH /api/policies/:id — partial update (enabled toggle, metadata fields)
router.patch(
    "/:id",
    asyncHandler(async (req, res) => {
        const { enabled, name, description, tags, priority } = req.body;
        await PolicyLoader.patch(
            req.params["id"] as string,
            { enabled, name, description, tags, priority },
            req.supabase,
            req.user?.id
        );
        res.json({ success: true });
    })
);

// POST /api/policies/reload — force cache invalidation
router.post(
    "/reload",
    asyncHandler(async (req, res) => {
        PolicyLoader.invalidateCache();
        const policies = await PolicyLoader.load(true, req.supabase);
        res.json({ success: true, count: policies.length });
    })
);

// POST /api/policies/synthesize — NL → Policy via LLM
router.post(
    "/synthesize",
    asyncHandler(async (req, res) => {
        const { description, provider, model } = req.body;
        if (!description || typeof description !== "string") {
            res.status(400).json({ success: false, error: "description is required" });
            return;
        }
        const result = await PolicyEngine.synthesizeFromNL(description, {
            provider,
            model,
            userId: req.user?.id,
            supabase: req.supabase,
        });
        if (!result.policy) {
            res.status(503).json({ success: false, error: result.error ?? "Synthesis failed. SDK may be unavailable." });
            return;
        }
        res.json({ success: true, policy: result.policy, warning: result.error });
    })
);

export default router;
