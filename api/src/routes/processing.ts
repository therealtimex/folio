import { Router } from "express";

import { config } from "../config/index.js";
import { authMiddleware } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { validateBody, schemas } from "../middleware/validation.js";
import { SDKService } from "../services/SDKService.js";

const router = Router();

router.post(
  "/dispatch",
  authMiddleware,
  validateBody(schemas.dispatchProcessing),
  asyncHandler(async (req, res) => {
    if (!req.user || !req.supabase) {
      res.status(401).json({
        success: false,
        error: {
          code: "AUTH_REQUIRED",
          message: "Authentication required"
        }
      });
      return;
    }

    const sdkAvailable = await SDKService.isAvailable();
    const defaultProvider = await SDKService.getDefaultChatProvider();

    const { source_type, payload } = req.body;

    // Foundation-only dev path: avoid FK coupling to auth.users when auth is disabled.
    if (config.security.disableAuth && !config.isProduction) {
      res.status(202).json({
        success: true,
        job: {
          id: `dev-${Date.now()}`,
          user_id: req.user.id,
          status: "queued",
          source_type,
          payload,
          runtime_key: sdkAvailable ? `${defaultProvider.provider}:${defaultProvider.model}` : null,
          error_message: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        },
        runtime: {
          sdkAvailable,
          provider: defaultProvider,
          mode: "dev_stub"
        }
      });
      return;
    }

    const { data, error } = await req.supabase
      .from("processing_jobs")
      .insert({
        user_id: req.user.id,
        status: "queued",
        source_type,
        payload,
        runtime_key: sdkAvailable ? `${defaultProvider.provider}:${defaultProvider.model}` : null
      })
      .select("*")
      .single();

    if (error) {
      res.status(500).json({
        success: false,
        error: {
          code: "DB_INSERT_FAILED",
          message: error.message
        }
      });
      return;
    }

    res.status(202).json({
      success: true,
      job: data,
      runtime: {
        sdkAvailable,
        provider: defaultProvider
      }
    });
  })
);

export default router;
