import { NextFunction, Request, Response } from "express";
import { z, ZodError, ZodSchema } from "zod";

import { ValidationError } from "./errorHandler.js";

export function validateBody<T>(schema: ZodSchema<T>) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const message = error.errors.map((item) => `${item.path.join(".")}: ${item.message}`).join(", ");
        next(new ValidationError(message));
        return;
      }
      next(error);
    }
  };
}

export function validateQuery<T>(schema: ZodSchema<T>) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      req.query = schema.parse(req.query) as Request["query"];
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const message = error.errors.map((item) => `${item.path.join(".")}: ${item.message}`).join(", ");
        next(new ValidationError(message));
        return;
      }
      next(error);
    }
  };
}

export const schemas = {
  testSupabase: z.object({
    url: z.string().url(),
    anonKey: z.string().min(10)
  }),
  autoProvision: z.object({
    orgId: z.string().min(1),
    projectName: z.string().min(1).max(64).optional(),
    region: z.string().min(1).max(64).optional()
  }),
  migrate: z.object({
    projectRef: z.string().min(1),
    accessToken: z.string().min(1),
    anonKey: z.string().min(1).optional()
  }),

  dispatchProcessing: z.object({
    source_type: z.string().min(1),
    payload: z.record(z.unknown())
  })
};
