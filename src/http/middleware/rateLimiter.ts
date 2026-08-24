import { createHash } from 'node:crypto';
import { rateLimit, ipKeyGenerator, MemoryStore } from 'express-rate-limit';
import type { Request } from 'express';
import { TooManyRequestsError } from '../../errors';
import { parseEnvInt } from '../../utils/env';
import { getMetricsRegistry } from '../../services/monitoring/ProviderCallRecorder';
import logger from '../../utils/logger';

export type RateLimitScope = 'auth' | 'api';
export type RateLimitKeyType = 'operator' | 'ip';

/**
 * First 12 hex chars of sha256(key). Never log raw operator ids/IPs in a way
 * that enables cross-referencing abuse; the hash still lets ops correlate
 * repeated rejections of the same key.
 */
export function hashLimitKey(key: string): string {
  return createHash('sha256').update(key).digest('hex').slice(0, 12);
}

// Module-scoped stores: the rateLimit() closure captures the store reference,
// so test resets must target these exact instances (see
// resetRateLimitersForTests). The library's window-expiry timer is unref()'d,
// so these cannot keep the process alive.
const authStore = new MemoryStore();
const apiStore = new MemoryStore();

/** Auth limiter limit — read per request so tests can change the env without a restart. */
export function authLimit(): number {
  return parseEnvInt('RATE_LIMIT_AUTH_MAX', 10);
}

/** API limiter limit — read per request so tests can change the env without a restart. */
export function apiLimit(): number {
  return parseEnvInt('RATE_LIMIT_API_MAX', 300);
}

/** Auth limiter key: client IP (login/refresh are pre-auth — no operator yet). */
export function authKey(req: Request): string {
  return ipKeyGenerator(req.ip ?? '');
}

/** API limiter key: authenticated operator id when available, falling back to client IP. */
export function apiKey(req: Request): string {
  return req.user?.operatorId ?? ipKeyGenerator(req.ip ?? '');
}

export function keyTypeOf(req: Request): RateLimitKeyType {
  return req.user?.operatorId ? 'operator' : 'ip';
}

/**
 * In-memory top-N map of rejecting keys (P2-01's api-429-spike /
 * auth-429-spike rules read this to answer "one key caused > 50% of
 * rejections"). Cumulative per process; when more than TOP_N distinct keys
 * reject, the min-count entry is evicted (ties: oldest lastRejectedAt). The
 * map's `total` can be lower than the rate_limit_rejections_total counter —
 * the counter is the authoritative total.
 */
export interface RateLimitRejectionKeyStats {
  keyHash: string;
  scope: RateLimitScope;
  keyType: RateLimitKeyType;
  count: number;
  lastRejectedAt: number;
}

const REJECTION_TOP_N = 10;
const rejectionKeys = new Map<string, RateLimitRejectionKeyStats>();

function recordRateLimitRejection(scope: RateLimitScope, keyType: RateLimitKeyType, key: string): void {
  const keyHash = hashLimitKey(key);
  const now = Date.now();
  const existing = rejectionKeys.get(keyHash);
  if (existing) {
    existing.count += 1;
    existing.lastRejectedAt = now;
    return;
  }
  rejectionKeys.set(keyHash, { keyHash, scope, keyType, count: 1, lastRejectedAt: now });
  if (rejectionKeys.size > REJECTION_TOP_N) {
    let victim: RateLimitRejectionKeyStats | null = null;
    for (const entry of rejectionKeys.values()) {
      if (!victim || entry.count < victim.count || (entry.count === victim.count && entry.lastRejectedAt < victim.lastRejectedAt)) {
        victim = entry;
      }
    }
    if (victim) rejectionKeys.delete(victim.keyHash);
  }
}

/** Sorted (count desc) view of the top-N rejecting keys. */
export function getRateLimitRejectionStats(): { total: number; topKeys: RateLimitRejectionKeyStats[] } {
  const topKeys = [...rejectionKeys.values()].sort((a, b) => b.count - a.count || a.keyHash.localeCompare(b.keyHash));
  const total = topKeys.reduce((sum, entry) => sum + entry.count, 0);
  return { total, topKeys };
}

/**
 * Test seam (e2e): clears both limiter stores and the top-N rejection map.
 * Must be called on the app-world module instance — tests/setup.ts exposes it
 * on globalThis because e2e files load in a different module graph (P1-04
 * dual-graph lesson).
 */
export async function resetRateLimitersForTests(): Promise<void> {
  await authStore.resetAll();
  await apiStore.resetAll();
  rejectionKeys.clear();
}

/**
 * Counts a limiter rejection: metric counter, top-N key map, and a pino warn
 * with the hashed key (never the raw key). Logging lives here — not in the
 * error handler — because only the handler knows scope + key.
 */
function onRejection(scope: RateLimitScope, keyType: RateLimitKeyType, key: string, path: string): void {
  const registry = getMetricsRegistry();
  registry?.inc('rate_limit_rejections_total', { scope, key_type: keyType });
  recordRateLimitRejection(scope, keyType, key);
  logger.warn({ scope, key: hashLimitKey(key), path }, 'Rate limit exceeded');
}

/**
 * Creates a rate limiter for authentication endpoints (login, refresh).
 * Keyed by client IP address. Limits are configurable via environment variables:
 * - RATE_LIMIT_AUTH_WINDOW_MS: time window in milliseconds (default: 900000 = 15 minutes)
 * - RATE_LIMIT_AUTH_MAX: max requests per window (default: 10, read per request)
 */
export function createAuthRateLimiter() {
  return rateLimit({
    store: authStore,
    windowMs: parseEnvInt('RATE_LIMIT_AUTH_WINDOW_MS', 900_000),
    max: authLimit,
    keyGenerator: authKey,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (req, _res, next) => {
      onRejection('auth', keyTypeOf(req), authKey(req), req.path);
      next(new TooManyRequestsError('Too many login attempts, please try again later', 'auth'));
    },
  });
}

/**
 * Creates a rate limiter for the general API.
 * Keyed by authenticated operator ID when available, falling back to client IP.
 * Limits are configurable via environment variables:
 * - RATE_LIMIT_API_WINDOW_MS: time window in milliseconds (default: 60000 = 1 minute)
 * - RATE_LIMIT_API_MAX: max requests per window (default: 300, read per request)
 */
export function createApiRateLimiter() {
  return rateLimit({
    store: apiStore,
    windowMs: parseEnvInt('RATE_LIMIT_API_WINDOW_MS', 60_000),
    max: apiLimit,
    skip: (req: Request) => req.path === '/api/auth/login' || req.path === '/api/auth/refresh',
    keyGenerator: apiKey,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (req, _res, next) => {
      const keyType = keyTypeOf(req);
      onRejection('api', keyType, apiKey(req), req.path);
      next(new TooManyRequestsError('Too many requests, please slow down', 'api'));
    },
  });
}
