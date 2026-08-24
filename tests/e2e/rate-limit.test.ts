import 'reflect-metadata';
import { describe, it, beforeEach, afterEach } from 'mocha';
import { expect } from 'chai';
import { authed, unauthed, resetDatabase } from '../utils';
import type { MetricsRegistry } from '../../src/services/monitoring/MetricsRegistry';

// The app's registry + rate limiter seams, exposed by tests/setup.ts. Test files load in a
// separate module graph from the app (mocha's tsx require hook), so their own
// container.resolve(MetricsRegistry) or direct rateLimiter.ts import would operate on
// different instances than the middleware (P1-04 dual-graph lesson).
function appRegistry(): MetricsRegistry {
  const registry = (globalThis as any).__TEST_METRICS_REGISTRY__ as MetricsRegistry | undefined;
  expect(registry).to.not.equal(undefined, '__TEST_METRICS_REGISTRY__ is not set — tests/setup.ts must expose the app-world registry');
  return registry;
}

type RateLimitScope = 'auth' | 'api';
type RateLimitKeyType = 'operator' | 'ip';
interface RateLimitRejectionKeyStatsLocal {
  keyHash: string;
  scope: RateLimitScope;
  keyType: RateLimitKeyType;
  count: number;
  lastRejectedAt: number;
}

function rateLimits(): { reset: () => Promise<void>; getStats: () => { total: number; topKeys: RateLimitRejectionKeyStatsLocal[] } } {
  const seams = (globalThis as any).__TEST_RATE_LIMITS__ as
    | { reset: () => Promise<void>; getStats: () => { total: number; topKeys: RateLimitRejectionKeyStatsLocal[] } }
    | undefined;
  expect(seams).to.not.equal(undefined, '__TEST_RATE_LIMITS__ is not set — tests/setup.ts must expose the app-world rate limiter seams');
  return seams;
}

// Label keys are sorted alphabetically by MetricsRegistry.
function rejectionCount(scope: RateLimitScope, keyType: RateLimitKeyType): number {
  const label = `key_type=${keyType},scope=${scope}`;
  return appRegistry().snapshot().counters.rate_limit_rejections_total?.[label]?.count ?? 0;
}

const LOGIN_BODY = { id: 'test@example.com', password: 'wrong-password' };

describe('Rate limit 429s (P1-07)', () => {
  beforeEach(async () => {
    await resetDatabase();
    await rateLimits().reset();
    process.env.RATE_LIMIT_AUTH_MAX = '10';
    process.env.RATE_LIMIT_API_MAX = '10000';
  });

  afterEach(async () => {
    process.env.RATE_LIMIT_AUTH_MAX = '10000';
    process.env.RATE_LIMIT_API_MAX = '10000';
    await rateLimits().reset();
  });

  it('auth scope: 11th login attempt is rejected 429 and instrumented', async () => {
    const before = rejectionCount('auth', 'ip');

    for (let i = 0; i < 10; i++) {
      const res = await unauthed().post('/api/auth/login').send(LOGIN_BODY);
      expect(res.status).to.equal(401);
    }
    const rejected = await unauthed().post('/api/auth/login').send(LOGIN_BODY);
    expect(rejected.status).to.equal(429);
    // Retry-After is the remaining window in seconds — it decays as seconds pass during
    // the test, so assert the window range, not a constant (flake fix, 2026-08-18).
    const retryAfter = Number(rejected.headers['retry-after']);
    expect(Number.isFinite(retryAfter) && retryAfter >= 50 && retryAfter <= 60).to.equal(true);
    // Response body shape is unchanged.
    expect(rejected.body).to.deep.equal({ error: 'Too many login attempts, please try again later' });

    expect(rejectionCount('auth', 'ip') - before).to.be.at.least(1);
    const stats = rateLimits().getStats();
    expect(stats.topKeys.some((k: RateLimitRejectionKeyStatsLocal) => k.scope === 'auth' && k.keyType === 'ip' && k.count >= 1)).to.equal(true);
  });

  it('api scope: 6th authenticated request is rejected 429 with operator key_type', async () => {
    process.env.RATE_LIMIT_API_MAX = '5';
    const before = rejectionCount('api', 'operator');

    for (let i = 0; i < 5; i++) {
      const res = await authed().get('/api/profile');
      expect(res.status).to.equal(200);
    }
    const rejected = await authed().get('/api/profile');
    expect(rejected.status).to.equal(429);
    const retryAfter = Number(rejected.headers['retry-after']);
    expect(Number.isFinite(retryAfter) && retryAfter >= 50 && retryAfter <= 60).to.equal(true);
    expect(rejected.body).to.deep.equal({ error: 'Too many requests, please slow down' });

    expect(rejectionCount('api', 'operator') - before).to.be.at.least(1);
    const stats = rateLimits().getStats();
    expect(stats.topKeys.some((k: RateLimitRejectionKeyStatsLocal) => k.scope === 'api' && k.keyType === 'operator' && k.count >= 1)).to.equal(true);
  });

  it('does not contaminate later tests after restore', async () => {
    // Trip the auth limiter, then restore the limit and reset the stores.
    for (let i = 0; i < 10; i++) {
      await unauthed().post('/api/auth/login').send(LOGIN_BODY).expect(401);
    }
    await unauthed().post('/api/auth/login').send(LOGIN_BODY).expect(429);

    process.env.RATE_LIMIT_AUTH_MAX = '10000';
    await rateLimits().reset();

    // A fresh failed login must get 401 again, not a stale 429.
    const res = await unauthed().post('/api/auth/login').send(LOGIN_BODY);
    expect(res.status).to.equal(401);
  });
});
