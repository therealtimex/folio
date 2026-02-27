import { Router } from "express";

import healthRoutes from "./health.js";
import migrateRoutes from "./migrate.js";
import processingRoutes from "./processing.js";
import setupRoutes from "./setup.js";
import ttsRoutes from "./tts.js";
import sdkRoutes from "./sdk.js";
import policiesRoutes from "./policies.js";
import ingestionsRoutes from "./ingestions.js";
import baselineConfigRoutes from "./baseline-config.js";
import accountsRoutes from "./accounts.js";
import settingsRoutes from "./settings.js";
import rulesRoutes from "./rules.js";
import chatRoutes from "./chat.js";
import statsRoutes from "./stats.js";

const router = Router();

router.use("/health", healthRoutes);
router.use("/migrate", migrateRoutes);
router.use("/setup", setupRoutes);
router.use("/processing", processingRoutes);
router.use("/tts", ttsRoutes);
router.use("/sdk", sdkRoutes);
router.use("/policies", policiesRoutes);
router.use("/ingestions", ingestionsRoutes);
router.use("/baseline-config", baselineConfigRoutes);
router.use("/accounts", accountsRoutes);
router.use("/settings", settingsRoutes);
router.use("/rules", rulesRoutes);
router.use("/chat", chatRoutes);
router.use("/stats", statsRoutes);

export default router;
