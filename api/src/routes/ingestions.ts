import { Router } from "express";
import multer from "multer";
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

        // Extract text — for now use the raw buffer as string (works for .txt, .md)
        // PDF/DOCX extraction would need extra libraries
        const content = file.buffer.toString("utf-8").replace(/\0/g, "").slice(0, 50_000);

        const ingestion = await IngestionService.ingest({
            supabase: req.supabase,
            userId: req.user.id,
            filename: file.originalname,
            mimeType: file.mimetype,
            fileSize: file.size,
            source: "upload",
            content,
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
