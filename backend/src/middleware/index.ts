import type { NextFunction, Request, Response, RequestHandler } from "express";
import { ZodError, type ZodTypeAny, type z } from "zod";
import multer from "multer";
import rateLimit from "express-rate-limit";
import { HttpError } from "../utils/httpError.js";
import { verifyToken } from "../services/auth.js";
import type { ChainReader } from "../services/chain.js";
import { logger } from "../utils/logger.js";

declare module "express-serve-static-core" {
  interface Request {
    wallet?: string;
    validated?: { body?: unknown; query?: unknown; params?: unknown };
  }
}

// ------------------------------------------------------------------ validation

export function validate(schemas: { body?: ZodTypeAny; query?: ZodTypeAny; params?: ZodTypeAny }): RequestHandler {
  return (req, _res, next) => {
    try {
      req.validated = {
        body: schemas.body ? schemas.body.parse(req.body ?? {}) : undefined,
        query: schemas.query ? schemas.query.parse(req.query) : undefined,
        params: schemas.params ? schemas.params.parse(req.params) : undefined,
      };
      next();
    } catch (err) {
      next(err);
    }
  };
}

export const v = <T extends ZodTypeAny>(req: Request, part: "body" | "query" | "params") => req.validated?.[part] as z.infer<T>;

// ------------------------------------------------------------------ auth

/** Requires a valid session token obtained by signing a nonce with the wallet. */
export function requireAuth(jwtSecret: string): RequestHandler {
  return (req, _res, next) => {
    const header = req.headers.authorization ?? "";
    const [scheme, token] = header.split(" ");
    if (scheme !== "Bearer" || !token) return next(HttpError.unauthorized());
    try {
      req.wallet = verifyToken(token, jwtSecret).wallet;
      next();
    } catch (err) {
      next(err);
    }
  };
}

/** Optional auth: attaches req.wallet when a valid token is present, never fails. */
export function optionalAuth(jwtSecret: string): RequestHandler {
  return (req, _res, next) => {
    const [scheme, token] = (req.headers.authorization ?? "").split(" ");
    if (scheme === "Bearer" && token) {
      try {
        req.wallet = verifyToken(token, jwtSecret).wallet;
      } catch {
        /* ignore */
      }
    }
    next();
  };
}

/** Admin check is performed ON-CHAIN against RoleManager, never trusted from the client. */
export function requireOnChainAdmin(reader: ChainReader): RequestHandler {
  return async (req, _res, next) => {
    try {
      if (!req.wallet) throw HttpError.unauthorized();
      if (!(await reader.isAdmin(req.wallet))) throw HttpError.forbidden("Wallet does not hold the on-chain admin role");
      next();
    } catch (err) {
      next(err);
    }
  };
}

// ------------------------------------------------------------------ uploads

export const ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp", "application/pdf"];

export function uploadMiddleware(maxMb: number) {
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxMb * 1024 * 1024, files: 1 },
    fileFilter: (_req, file, cb) => {
      if (!ALLOWED_MIME.includes(file.mimetype)) {
        cb(HttpError.badRequest(`Unsupported file type "${file.mimetype}". Allowed: JPG, PNG, WebP, PDF`));
      } else cb(null, true);
    },
  }).single("file");
}

// ------------------------------------------------------------------ rate limits

export const limiters = {
  api: rateLimit({ windowMs: 15 * 60 * 1000, limit: 600, standardHeaders: "draft-7", legacyHeaders: false }),
  auth: rateLimit({ windowMs: 15 * 60 * 1000, limit: 60, standardHeaders: "draft-7", legacyHeaders: false }),
  upload: rateLimit({ windowMs: 15 * 60 * 1000, limit: 60, standardHeaders: "draft-7", legacyHeaders: false }),
};

// ------------------------------------------------------------------ errors

export const notFound: RequestHandler = (req, _res, next) => next(HttpError.notFound(`Route ${req.method} ${req.path} not found`));

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: "Validation failed",
      details: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    });
  }
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, details: err.details });
  if (err instanceof multer.MulterError) {
    const msg = err.code === "LIMIT_FILE_SIZE" ? "File too large" : err.message;
    return res.status(err.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({ error: msg });
  }
  if ((err as { type?: string }).type === "entity.parse.failed") return res.status(400).json({ error: "Malformed JSON body" });
  if ((err as { type?: string }).type === "entity.too.large") return res.status(413).json({ error: "Request body too large" });
  logger.error(err);
  return res.status(500).json({ error: "Internal server error" });
}
