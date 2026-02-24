import { Router } from "express";

import healthRoutes from "./health.js";
import migrateRoutes from "./migrate.js";
import processingRoutes from "./processing.js";
import setupRoutes from "./setup.js";

const router = Router();

router.use("/health", healthRoutes);
router.use("/migrate", migrateRoutes);
router.use("/setup", setupRoutes);
router.use("/processing", processingRoutes);

export default router;
