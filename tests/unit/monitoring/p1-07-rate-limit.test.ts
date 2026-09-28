import 'reflect-metadata';
import { describe, it, beforeEach, afterEach } from 'mocha';
import { expect } from 'chai';
import type { Request } from 'express';
import {
  hashLimitKey,
  authLimit,
  apiLimit,
  authKey,
  apiKey,
  keyTypeOf,
  getRateLimitRejectionStats,
  resetRateLimitersForTests,
} from '../../../src/http/middleware/rateLimiter';
import { TooManyRequestsError } from '../../../src/errors';

function mockReq(partial: Record<string, unknown>): Request {
  return partial as unknown as Request;
}

describe('P1-07 rate limit instrumentation (unit)', () => {
  const savedAuth = process.env.RATE_LIMIT_AUTH_MAX;
  const savedApi = process.env.RATE_LIMIT_API_MAX;

  beforeEach(() => {
    delete process.env.RATE_LIMIT_AUTH_MAX;
    delete process.env.RATE_LIMIT_API_MAX;
  });

  afterEach(() => {
    if (savedAuth === undefined) delete process.env.RATE_LIMIT_AUTH_MAX;
    else process.env.RATE_LIMIT_AUTH_MAX = savedAuth;
    if (savedApi === undefined) delete process.env.RATE_LIMIT_API_MAX;
    else process.env.RATE_LIMIT_API_MAX = savedApi;
  });

  describe('hashLimitKey', () => {
    it('is deterministic and returns 12 hex chars', () => {
      const a = hashLimitKey('op_123');
      const b = hashLimitKey('op_123');
      expect(a).to.equal(b);
      expect(a).to.match(/^[0-9a-f]{12}$/);
    });

    it('produces distinct hashes for distinct keys', () => {
      expect(hashLimitKey('op_1')).to.not.equal(hashLimitKey('op_2'));
      expect(hashLimitKey('1.2.3.4')).to.not.equal(hashLimitKey('5.6.7.8'));
    });
  });

  describe('TooManyRequestsError scope', () => {
    it('propagates scope when provided', () => {
      const err = new TooManyRequestsError('Too many login attempts', 'auth');
      expect(err.name).to.equal('TooManyRequestsError');
      expect(err.message).to.equal('Too many login attempts');
      expect(err.scope).to.equal('auth');
    });

    it('leaves scope undefined when omitted (existing call sites unaffected)', () => {
      const err = new TooManyRequestsError('Request timed out, runner is busy');
      expect(err.scope).to.equal(undefined);
    });
  });

  describe('per-request limit resolution', () => {
    it('falls back to defaults when env vars are unset', () => {
      expect(authLimit()).to.equal(10);
      expect(apiLimit()).to.equal(300);
    });

    it('reads valid env values', () => {
      process.env.RATE_LIMIT_AUTH_MAX = '25';
      process.env.RATE_LIMIT_API_MAX = '1234';
      expect(authLimit()).to.equal(25);
      expect(apiLimit()).to.equal(1234);
    });

    it('ignores non-numeric, zero and negative values (parseEnvInt semantics)', () => {
      process.env.RATE_LIMIT_AUTH_MAX = 'abc';
      process.env.RATE_LIMIT_API_MAX = '0';
      expect(authLimit()).to.equal(10);
      process.env.RATE_LIMIT_API_MAX = '-5';
      expect(apiLimit()).to.equal(300);
    });

    it('resolves per call — env changes are picked up without restart', () => {
      expect(authLimit()).to.equal(10);
      process.env.RATE_LIMIT_AUTH_MAX = '3';
      expect(authLimit()).to.equal(3);
    });
  });

  describe('key resolution', () => {
    it('authKey maps the client IP (IPv4 passthrough, IPv6 /56 subnet)', () => {
      expect(authKey(mockReq({ ip: '1.2.3.4' }))).to.equal('1.2.3.4');
      expect(authKey(mockReq({ ip: '2001:db8::7' }))).to.equal('2001:db8::/56');
    });

    it('apiKey prefers the operator id and falls back to the client IP', () => {
      const withUser = mockReq({ ip: '1.2.3.4', user: { operatorId: 'op_abc', roles: [] } });
      const withoutUser = mockReq({ ip: '1.2.3.4' });
      expect(apiKey(withUser)).to.equal('op_abc');
      expect(apiKey(withoutUser)).to.equal('1.2.3.4');
    });

    it('keyTypeOf mirrors apiKey', () => {
      expect(keyTypeOf(mockReq({ ip: '1.2.3.4', user: { operatorId: 'op_abc', roles: [] } }))).to.equal('operator');
      expect(keyTypeOf(mockReq({ ip: '1.2.3.4' }))).to.equal('ip');
    });
  });

  describe('top-N rejection stats', () => {
    it('is empty after reset', async () => {
      await resetRateLimitersForTests();
      const stats = getRateLimitRejectionStats();
      expect(stats.total).to.equal(0);
      expect(stats.topKeys).to.deep.equal([]);
    });
  });
});
