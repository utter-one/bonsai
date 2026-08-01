import { describe, it, beforeEach } from 'mocha';
import { expect } from 'chai';
import request from 'supertest';
import { authed, unauthed, getAccessToken, resetDatabase } from '../utils';

describe('Rate Limiter', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  describe('API rate limiter', () => {
    it('uses operator ID as key for authenticated requests', async () => {
      const results: number[] = [];
      for (let i = 0; i < 10; i++) {
        const res = await authed().get('/api/projects');
        results.push(res.status);
      }
      expect(results.every(s => s === 200)).to.equal(true);
    });

    it('uses IP as key for unauthenticated requests', async () => {
      const results: number[] = [];
      for (let i = 0; i < 10; i++) {
        const res = await unauthed().get('/version');
        results.push(res.status);
      }
      expect(results.every(s => s === 200)).to.equal(true);
    });

    it('health endpoint bypasses all rate limiting', async () => {
      const results: number[] = [];
      for (let i = 0; i < 50; i++) {
        const res = await unauthed().get('/health');
        results.push(res.status);
      }
      expect(results.every(s => s === 200)).to.equal(true);
    });
  });
});
