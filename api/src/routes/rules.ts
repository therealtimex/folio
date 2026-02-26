import { Router } from "express";
import { asyncHandler } from "../middleware/errorHandler.js";

const router = Router();

// GET /api/rules
router.get("/", asyncHandler(async (req, res) => {
    res.json({ rules: [] });
}));

export default router;
