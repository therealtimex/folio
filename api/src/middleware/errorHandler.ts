import { NextFunction, Request, Response } from "express";

import { config } from "../config/index.js";
import { createLogger } from "../utils/logger.js";

const logger = createLogger("ErrorHandler");

export class AppError extends Error {
  statusCode: number;
  isOperational: boolean;
  code?: string;

  constructor(message: string, statusCode = 500, code?: string) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true;
    this.code = code;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(message, 400, "VALIDATION_ERROR");
  }
}

export class AuthenticationError extends AppError {
  constructor(message = "Authentication required") {
    super(message, 401, "AUTHENTICATION_ERROR");
  }
}

export class AuthorizationError extends AppError {
  constructor(message = "Insufficient permissions") {
    super(message, 403, "AUTHORIZATION_ERROR");
  }
}

export class NotFoundError extends AppError {
  constructor(resource = "Resource") {
    super(`${resource} not found`, 404, "NOT_FOUND");
  }
}

export class RateLimitError extends AppError {
  constructor() {
    super("Too many requests", 429, "RATE_LIMIT_EXCEEDED");
  }
}

export function errorHandler(err: Error | AppError, req: Request, res: Response, _next: NextFunction): void {
  const statusCode = err instanceof AppError ? err.statusCode : 500;
  const code = err instanceof AppError ? err.code : "INTERNAL_ERROR";

  if (statusCode >= 500) {
    logger.error("Server error", {
      method: req.method,
      path: req.path,
      statusCode,
      message: err.message
    });
  } else {
    logger.warn("Client error", {
      method: req.method,
      path: req.path,
      statusCode,
      message: err.message
    });
  }

  res.status(statusCode).json({
    success: false,
    error: {
      code,
      message: !config.isProduction ? err.message : statusCode >= 500 ? "Unexpected error" : err.message,
      ...(config.isProduction ? {} : { stack: err.stack })
    }
  });
}

export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
