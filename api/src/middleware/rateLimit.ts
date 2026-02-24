import { NextFunction, Request, Response } from "express";

import { config } from "../config/index.js";
import { RateLimitError } from "./errorHandler.js";

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const rateLimitStore = new Map<string, RateLimitEntry>();

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitStore.entries()) {
    if (entry.resetAt < now) {
      rateLimitStore.delete(key);
    }
  }
}, 60_000);

export interface RateLimitOptions {
  windowMs?: number;
  max?: number;
  keyGenerator?: (req: Request) => string;
  skip?: (req: Request) => boolean;
}

export function rateLimit(options: RateLimitOptions = {}) {
  const {
    windowMs = config.security.rateLimitWindowMs,
    max = config.security.rateLimitMax,
    keyGenerator = (req) => req.ip || String(req.headers["x-forwarded-for"] || "unknown"),
    skip = () => false
  } = options;

  return (req: Request, res: Response, next: NextFunction): void => {
    if (skip(req)) {
      return next();
    }

    const key = keyGenerator(req);
    const now = Date.now();
    let entry = rateLimitStore.get(key);

    if (!entry || entry.resetAt < now) {
      entry = {
        count: 1,
        resetAt: now + windowMs
      };
      rateLimitStore.set(key, entry);
    } else {
      entry.count += 1;
    }

    res.setHeader("X-RateLimit-Limit", max);
    res.setHeader("X-RateLimit-Remaining", Math.max(0, max - entry.count));
    res.setHeader("X-RateLimit-Reset", Math.ceil(entry.resetAt / 1000));

    if (entry.count > max) {
      return next(new RateLimitError());
    }

    next();
  };
}

export const apiRateLimit = rateLimit({
  windowMs: 60_000,
  max: 60
});
