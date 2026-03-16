import { rateLimit, ipKeyGenerator } from 'express-rate-limit';
import type { Request } from 'express';
import { TooManyRequestsError } from '../../errors';

/**
 * Creates a rate limiter for authentication endpoints (login, refresh).
 * Keyed by client IP address. Limits are configurable via environment variables:
 * - RATE_LIMIT_AUTH_WINDOW_MS: time window in milliseconds (default: 900000 = 15 minutes)
 * - RATE_LIMIT_AUTH_MAX: max requests per window (default: 10)
 */
export function createAuthRateLimiter() {
  return rateLimit({
    windowMs: parseInt(process.env.RATE_LIMIT_AUTH_WINDOW_MS ?? '900000', 10),
    max: parseInt(process.env.RATE_LIMIT_AUTH_MAX ?? '10', 10),
    keyGenerator: (req: Request) => ipKeyGenerator(req.ip ?? ''),
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (_req, _res, next) => {
      next(new TooManyRequestsError('Too many login attempts, please try again later'));
    },
  });
}

/**
 * Creates a rate limiter for the general API.
 * Keyed by authenticated operator ID when available, falling back to client IP.
 * Limits are configurable via environment variables:
 * - RATE_LIMIT_API_WINDOW_MS: time window in milliseconds (default: 60000 = 1 minute)
 * - RATE_LIMIT_API_MAX: max requests per window (default: 300)
 */
export function createApiRateLimiter() {
  return rateLimit({
    windowMs: parseInt(process.env.RATE_LIMIT_API_WINDOW_MS ?? '60000', 10),
    max: parseInt(process.env.RATE_LIMIT_API_MAX ?? '300', 10),
    keyGenerator: (req: Request) => req.user?.operatorId ?? ipKeyGenerator(req.ip ?? ''),
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (_req, _res, next) => {
      next(new TooManyRequestsError('Too many requests, please slow down'));
    },
  });
}
