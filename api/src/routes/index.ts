import { Router } from "express";

import healthRoutes from "./health.js";
import migrateRoutes from "./migrate.js";
import processingRoutes from "./processing.js";
import setupRoutes from "./setup.js";
import ttsRoutes from "./tts.js";
import sdkRoutes from "./sdk.js";
import policiesRoutes from "./policies.js";

const router = Router();

router.use("/health", healthRoutes);
router.use("/migrate", migrateRoutes);
router.use("/setup", setupRoutes);
router.use("/processing", processingRoutes);
router.use("/tts", ttsRoutes);
router.use("/sdk", sdkRoutes);
router.use("/policies", policiesRoutes);

export default router;
