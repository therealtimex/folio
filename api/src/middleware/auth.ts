import { createClient, SupabaseClient, User } from "@supabase/supabase-js";
import { NextFunction, Request, Response } from "express";

import { config } from "../config/index.js";
import { getServerSupabase, getSupabaseConfigFromHeaders } from "../services/supabase.js";
import { Logger, createLogger } from "../utils/logger.js";
import { AuthenticationError, AuthorizationError } from "./errorHandler.js";

const logger = createLogger("AuthMiddleware");

declare global {
  namespace Express {
    interface Request {
      user?: User;
      supabase?: SupabaseClient;
    }
  }
}

function resolveSupabaseConfig(req: Request): { url: string; anonKey: string } | null {
  const headerConfig = getSupabaseConfigFromHeaders(req.headers as Record<string, unknown>);

  const envUrl = config.supabase.url;
  const envKey = config.supabase.anonKey;

  const envIsValid = envUrl.startsWith("http://") || envUrl.startsWith("https://");
  if (envIsValid && envKey) {
    return { url: envUrl, anonKey: envKey };
  }

  return headerConfig;
}

export async function authMiddleware(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const supabaseConfig = resolveSupabaseConfig(req);

    if (!supabaseConfig) {
      throw new AuthenticationError("Supabase not configured");
    }

    if (config.security.disableAuth && !config.isProduction) {
      const user = {
        id: "00000000-0000-0000-0000-000000000000",
        email: "dev@folio.local",
        user_metadata: {},
        app_metadata: {},
        aud: "authenticated",
        created_at: new Date().toISOString()
      } as User;

      const supabase =
        getServerSupabase() ||
        createClient(supabaseConfig.url, supabaseConfig.anonKey, {
          auth: {
            autoRefreshToken: false,
            persistSession: false
          }
        });

      req.user = user;
      req.supabase = supabase;
      Logger.setPersistence(supabase, user.id);
      return next();
    }

    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      throw new AuthenticationError("Missing bearer token");
    }

    const token = authHeader.slice(7);

    const supabase = createClient(supabaseConfig.url, supabaseConfig.anonKey, {
      global: {
        headers: {
          Authorization: `Bearer ${token}`
        }
      }
    });

    const {
      data: { user },
      error
    } = await supabase.auth.getUser(token);

    if (error || !user) {
      throw new AuthenticationError("Invalid or expired token");
    }

    req.user = user;
    req.supabase = supabase;
    Logger.setPersistence(supabase, user.id);
    next();
  } catch (error) {
    logger.error("Auth middleware error", {
      error: error instanceof Error ? error.message : String(error)
    });
    next(error);
  }
}

export function optionalAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    next();
    return;
  }

  void authMiddleware(req, res, next);
}

export function requireRole(roles: string[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) {
      next(new AuthenticationError());
      return;
    }

    const role = req.user.user_metadata?.role || "user";
    if (!roles.includes(role)) {
      next(new AuthorizationError(`Requires one of: ${roles.join(", ")}`));
      return;
    }

    next();
  };
}
