import { describe, it, beforeEach } from 'mocha';
import { expect } from 'chai';
import { authed, resetDatabase } from '../utils';
import { createProjectWithAgent } from '../fixtures';

interface Fixture { projectId: string; agentId: string; }

describe('Analytics API', () => {
  let fix: Fixture;

  beforeEach(async () => {
    await resetDatabase();
    fix = await createProjectWithAgent();
  });

  describe('latency stats', () => {
    it('returns empty stats', async () => {
      const res = await authed().get(`/api/projects/${fix.projectId}/analytics/latency`);
      expect(res.status).to.equal(200);
      expect(res.body.totalTurns).to.equal(0);
    });
  });

  describe('latency percentiles', () => {
    it('returns empty percentiles', async () => {
      const res = await authed().get(`/api/projects/${fix.projectId}/analytics/latency/percentiles`);
      expect(res.status).to.equal(200);
      expect(res.body.totalTurns).to.equal(0);
    });
  });

  describe('latency trend', () => {
    it('returns empty trend', async () => {
      const res = await authed().get(`/api/projects/${fix.projectId}/analytics/latency/trend`);
      expect(res.status).to.equal(200);
      expect(res.body.points).to.be.an('array').that.is.empty;
    });

    it('respects interval param', async () => {
      const res = await authed().get(`/api/projects/${fix.projectId}/analytics/latency/trend?interval=hour`);
      expect(res.status).to.equal(200);
      expect(res.body.interval).to.equal('hour');
    });
  });

  describe('token usage stats', () => {
    it('returns empty usage', async () => {
      const res = await authed().get(`/api/projects/${fix.projectId}/analytics/usage`);
      expect(res.status).to.equal(200);
      expect(res.body.totalEvents).to.equal(0);
    });
  });

  describe('token usage trend', () => {
    it('returns empty trend', async () => {
      const res = await authed().get(`/api/projects/${fix.projectId}/analytics/usage/trend`);
      expect(res.status).to.equal(200);
      expect(res.body.points).to.be.an('array').that.is.empty;
    });
  });

  describe('source catalog', () => {
    it('returns source catalog', async () => {
      const res = await authed().get(`/api/projects/${fix.projectId}/analytics/sources`);
      expect(res.status).to.equal(200);
    });
  });

  describe('slice query', () => {
    it('returns empty results with valid query', async () => {
      const res = await authed().get(`/api/projects/${fix.projectId}/analytics/query`).query({
        source: 'conversations',
        metrics: 'count',
      });
      expect(res.status).to.equal(200);
      expect(res.body.rows).to.be.an('array');
      expect(res.body.source).to.equal('conversations');
      expect(res.body.metrics).to.deep.equal(['count']);
    });

    it('returns 400 for missing source', async () => {
      const res = await authed().get(`/api/projects/${fix.projectId}/analytics/query`).query({
        metrics: 'count',
      });
      expect(res.status).to.equal(400);
    });

    it('returns 400 for missing metrics', async () => {
      const res = await authed().get(`/api/projects/${fix.projectId}/analytics/query`).query({
        source: 'conversations',
      });
      expect(res.status).to.equal(400);
    });

    it('returns 400 for unknown source', async () => {
      const res = await authed().get(`/api/projects/${fix.projectId}/analytics/query`).query({
        source: 'nonexistent_source',
        metrics: 'count',
      });
      expect(res.status).to.equal(400);
    });

    it('returns results for non-existent project (no project filter enforced)', async () => {
      const res = await authed().get('/api/projects/nonexistent/analytics/query').query({
        source: 'conversations',
        metrics: 'count',
      });
      expect(res.status).to.equal(200);
      expect(res.body.rows).to.be.an('array');
    });

    it('accepts groupBy parameter', async () => {
      const res = await authed().get(`/api/projects/${fix.projectId}/analytics/query`).query({
        source: 'events',
        metrics: 'count',
        groupBy: 'eventType',
      });
      expect(res.status).to.equal(200);
      expect(res.body.groupBy).to.deep.equal(['eventType']);
    });

    it('accepts interval parameter', async () => {
      const res = await authed().get(`/api/projects/${fix.projectId}/analytics/query`).query({
        source: 'events',
        metrics: 'count',
        interval: 'day',
      });
      expect(res.status).to.equal(200);
      expect(res.body.interval).to.equal('day');
    });

    it('accepts relativeTime parameter', async () => {
      const res = await authed().get(`/api/projects/${fix.projectId}/analytics/query`).query({
        source: 'events',
        metrics: 'count',
        'relativeTime[amount]': '7',
        'relativeTime[unit]': 'days',
      });
      expect(res.status).to.equal(200);
    });

    it('accepts limit parameter', async () => {
      const res = await authed().get(`/api/projects/${fix.projectId}/analytics/query`).query({
        source: 'conversations',
        metrics: 'count',
        limit: '50',
      });
      expect(res.status).to.equal(200);
    });

    it('accepts multiple metric specs', async () => {
      const res = await authed().get(`/api/projects/${fix.projectId}/analytics/query`).query({
        source: 'turns',
        metrics: ['count', 'avg:totalTurnDurationMs'],
      });
      expect(res.status).to.equal(200);
      expect(res.body.metrics).to.have.length(2);
    });

    it('returns 400 for invalid interval', async () => {
      const res = await authed().get(`/api/projects/${fix.projectId}/analytics/query`).query({
        source: 'conversations',
        metrics: 'count',
        interval: 'minute',
      });
      expect(res.status).to.equal(400);
    });
  });

  describe('conversation timeline', () => {
    it('returns empty timeline for non-existent conversation', async () => {
      const res = await authed().get(`/api/projects/${fix.projectId}/analytics/conversations/nonexistent/timeline`);
      expect(res.status).to.equal(200);
      expect(res.body).to.be.an('object');
    });
  });
});
