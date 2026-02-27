import { Router } from "express";
import multer from "multer";
import os from "os";
import path from "path";
import fs from "fs/promises";
import crypto from "crypto";
import { asyncHandler } from "../middleware/errorHandler.js";
import { optionalAuth } from "../middleware/auth.js";
import { IngestionService } from "../services/IngestionService.js";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

router.use(optionalAuth);

// GET /api/ingestions — list ingestions
router.get(
    "/",
    asyncHandler(async (req, res) => {
        if (!req.supabase || !req.user) {
            res.status(401).json({ success: false, error: "Authentication required" });
            return;
        }
        const ingestions = await IngestionService.list(req.supabase, req.user.id);
        res.json({ success: true, ingestions });
    })
);

// GET /api/ingestions/:id — get single ingestion
router.get(
    "/:id",
    asyncHandler(async (req, res) => {
        if (!req.supabase || !req.user) {
            res.status(401).json({ success: false, error: "Authentication required" });
            return;
        }
        const ingestion = await IngestionService.get(req.params["id"] as string, req.supabase, req.user.id);
        if (!ingestion) {
            res.status(404).json({ success: false, error: "Not found" });
            return;
        }
        res.json({ success: true, ingestion });
    })
);

// POST /api/ingestions/upload — manual file upload
router.post(
    "/upload",
    upload.single("file"),
    asyncHandler(async (req, res) => {
        if (!req.supabase || !req.user) {
            res.status(401).json({ success: false, error: "Authentication required" });
            return;
        }
        const file = req.file;
        if (!file) {
            res.status(400).json({ success: false, error: "No file uploaded" });
            return;
        }

        // Fetch user configured Storage Path (Dropzone)
        const { data: settings } = await req.supabase
            .from("user_settings")
            .select("storage_path")
            .eq("user_id", req.user.id)
            .maybeSingle();

        const dropzoneDir = settings?.storage_path || path.join(os.homedir(), ".realtimex", "folio", "dropzone");
        await fs.mkdir(dropzoneDir, { recursive: true });

        // Compute SHA-256 hash before writing — used for deduplication
        const fileHash = crypto.createHash("sha256").update(file.buffer).digest("hex");

        // Save physical file
        const safeFilename = `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9.-]/g, "_")}`;
        const filePath = path.join(dropzoneDir, safeFilename);
        await fs.writeFile(filePath, file.buffer);

        // Extract text (mock extraction for pdfs, works for text files)
        const content = file.buffer.toString("utf-8").replace(/\0/g, "").slice(0, 50_000);

        const ingestion = await IngestionService.ingest({
            supabase: req.supabase,
            userId: req.user.id,
            filename: file.originalname,
            mimeType: file.mimetype,
            fileSize: file.size,
            source: "upload",
            filePath,
            content,
            fileHash,
        });

        res.status(201).json({ success: true, ingestion });
    })
);

// POST /api/ingestions/:id/rerun — re-run processing
router.post(
    "/:id/rerun",
    asyncHandler(async (req, res) => {
        if (!req.supabase || !req.user) {
            res.status(401).json({ success: false, error: "Authentication required" });
            return;
        }
        const matched = await IngestionService.rerun(req.params["id"] as string, req.supabase, req.user.id);
        res.json({ success: true, matched });
    })
);

// POST /api/ingestions/:id/summarize — generate (or return cached) prose summary
router.post(
    "/:id/summarize",
    asyncHandler(async (req, res) => {
        if (!req.supabase || !req.user) {
            res.status(401).json({ success: false, error: "Authentication required" });
            return;
        }
        const { data: settingsRow } = await req.supabase
            .from("user_settings")
            .select("llm_provider, llm_model")
            .eq("user_id", req.user.id)
            .maybeSingle();

        const llmSettings = {
            llm_provider: settingsRow?.llm_provider ?? undefined,
            llm_model: settingsRow?.llm_model ?? undefined,
        };

        const summary = await IngestionService.summarize(
            req.params["id"] as string,
            req.supabase,
            req.user.id,
            llmSettings
        );
        res.json({ success: true, summary });
    })
);

// PATCH /api/ingestions/:id/tags — replace tags array (human edits)
router.patch(
    "/:id/tags",
    asyncHandler(async (req, res) => {
        if (!req.supabase || !req.user) {
            res.status(401).json({ success: false, error: "Authentication required" });
            return;
        }
        const tags: unknown = req.body?.tags;
        if (!Array.isArray(tags) || tags.some((t) => typeof t !== "string")) {
            res.status(400).json({ success: false, error: "tags must be an array of strings" });
            return;
        }
        const normalized = (tags as string[]).map((t) => t.toLowerCase().trim()).filter(Boolean);
        const { error } = await req.supabase
            .from("ingestions")
            .update({ tags: normalized })
            .eq("id", req.params["id"] as string)
            .eq("user_id", req.user.id);
        if (error) {
            res.status(500).json({ success: false, error: error.message });
            return;
        }
        res.json({ success: true, tags: normalized });
    })
);

// DELETE /api/ingestions/:id — delete
router.delete(
    "/:id",
    asyncHandler(async (req, res) => {
        if (!req.supabase || !req.user) {
            res.status(401).json({ success: false, error: "Authentication required" });
            return;
        }
        const deleted = await IngestionService.delete(req.params["id"] as string, req.supabase, req.user.id);
        if (!deleted) {
            res.status(404).json({ success: false, error: "Not found" });
            return;
        }
        res.json({ success: true });
    })
);

export default router;
