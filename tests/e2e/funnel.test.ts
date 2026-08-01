import { describe, it, beforeEach } from 'mocha';
import { expect } from 'chai';
import { authed, resetDatabase } from '../utils';
import { createProjectWithAgent } from '../fixtures';

interface Fixture { projectId: string; agentId: string; }

function minimalFunnelQuery() {
  return {
    name: 'Test Funnel',
    query: {
      steps: [
        { eventType: 'session_started', params: { minSessions: '1' } },
        { eventType: 'enter_stage', params: { stageName: 'welcome' } },
      ],
    },
  };
}

describe('Funnel Saved Query API', () => {
  let fix: Fixture;

  beforeEach(async () => {
    await resetDatabase();
    fix = await createProjectWithAgent();
  });

  describe('list', () => {
    it('returns empty list', async () => {
      const res = await authed().get(`/api/projects/${fix.projectId}/analytics/funnels/saved-queries`);
      expect(res.status).to.equal(200);
      expect(res.body).to.be.an('array').that.is.empty;
    });

    it('returns queries after creation', async () => {
      await authed().post(`/api/projects/${fix.projectId}/analytics/funnels/saved-queries`).send({ ...minimalFunnelQuery(), name: 'A' });
      const res = await authed().get(`/api/projects/${fix.projectId}/analytics/funnels/saved-queries`);
      expect(res.body).to.have.length(1);
    });
  });

  describe('create', () => {
    it('creates with minimal fields', async () => {
      const res = await authed().post(`/api/projects/${fix.projectId}/analytics/funnels/saved-queries`).send(minimalFunnelQuery());
      expect(res.status).to.equal(201);
      expect(res.body.id).to.be.a('string');
      expect(res.body.version).to.equal(1);
    });

    it('rejects missing name (400)', async () => {
      const p = minimalFunnelQuery();
      delete p.name;
      const res = await authed().post(`/api/projects/${fix.projectId}/analytics/funnels/saved-queries`).send(p);
      expect(res.status).to.equal(400);
    });

    it('rejects missing query (400)', async () => {
      const p = minimalFunnelQuery();
      delete p.query;
      const res = await authed().post(`/api/projects/${fix.projectId}/analytics/funnels/saved-queries`).send(p);
      expect(res.status).to.equal(400);
    });
  });

  describe('get by id', () => {
    it('returns 404 for non-existent', async () => {
      const res = await authed().get(`/api/projects/${fix.projectId}/analytics/funnels/saved-queries/nonexistent`);
      expect(res.status).to.equal(404);
    });
  });

  describe('update', () => {
    it('updates name', async () => {
      const cr = await authed().post(`/api/projects/${fix.projectId}/analytics/funnels/saved-queries`).send(minimalFunnelQuery());
      const res = await authed().put(`/api/projects/${fix.projectId}/analytics/funnels/saved-queries/${cr.body.id}`).send({ name: 'Updated', version: cr.body.version });
      expect(res.status).to.equal(200);
      expect(res.body.name).to.equal('Updated');
      expect(res.body.version).to.equal(cr.body.version + 1);
    });

    it('rejects stale version (409)', async () => {
      const cr = await authed().post(`/api/projects/${fix.projectId}/analytics/funnels/saved-queries`).send(minimalFunnelQuery());
      await authed().put(`/api/projects/${fix.projectId}/analytics/funnels/saved-queries/${cr.body.id}`).send({ name: 'First', version: cr.body.version });
      const res = await authed().put(`/api/projects/${fix.projectId}/analytics/funnels/saved-queries/${cr.body.id}`).send({ name: 'Second', version: cr.body.version });
      expect(res.status).to.be.oneOf([400, 409]);
    });

    it('rejects missing version (400)', async () => {
      const cr = await authed().post(`/api/projects/${fix.projectId}/analytics/funnels/saved-queries`).send(minimalFunnelQuery());
      const res = await authed().put(`/api/projects/${fix.projectId}/analytics/funnels/saved-queries/${cr.body.id}`).send({ name: 'Updated' });
      expect(res.status).to.equal(400);
    });

    it('returns 404 for non-existent', async () => {
      const res = await authed().put(`/api/projects/${fix.projectId}/analytics/funnels/saved-queries/nonexistent`).send({ name: 'X', version: 1 });
      expect(res.status).to.equal(404);
    });
  });

  describe('delete', () => {
    it('deletes a query', async () => {
      const cr = await authed().post(`/api/projects/${fix.projectId}/analytics/funnels/saved-queries`).send(minimalFunnelQuery());
      const res = await authed().delete(`/api/projects/${fix.projectId}/analytics/funnels/saved-queries/${cr.body.id}`).send({ version: cr.body.version });
      expect(res.status).to.be.oneOf([200, 204]);
      const getRes = await authed().get(`/api/projects/${fix.projectId}/analytics/funnels/saved-queries/${cr.body.id}`);
      expect(getRes.status).to.equal(404);
    });

    it('returns 404 for non-existent', async () => {
      const res = await authed().delete(`/api/projects/${fix.projectId}/analytics/funnels/saved-queries/nonexistent`).send({ version: 1 });
      expect(res.status).to.equal(404);
    });
  });

  describe('funnel query execution', () => {
    it('runs a funnel query', async () => {
      const res = await authed().post(`/api/projects/${fix.projectId}/analytics/funnels/query`).send({
        steps: [
          { eventType: 'session_started', params: { minSessions: '1' } },
          { eventType: 'enter_stage', params: { stageName: 'welcome' } },
        ],
        relativeTime: { amount: 7, unit: 'days' },
      });
      expect(res.status).to.equal(200);
      expect(res.body).to.have.property('totalConversionRate');
      expect(res.body).to.have.property('usersAtStart');
      expect(res.body).to.have.property('steps');
    });

    it('runs a funnel query with from/to range', async () => {
      const res = await authed().post(`/api/projects/${fix.projectId}/analytics/funnels/query`).send({
        steps: [
          { eventType: 'session_started', params: { minSessions: '1' } },
          { eventType: 'enter_stage', params: { stageName: 'welcome' } },
        ],
        from: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
        to: new Date().toISOString(),
      });
      expect(res.status).to.equal(200);
      expect(res.body.steps).to.be.an('array');
    });

    it('rejects missing steps (400)', async () => {
      const res = await authed().post(`/api/projects/${fix.projectId}/analytics/funnels/query`).send({
        relativeTime: { amount: 7, unit: 'days' },
      });
      expect(res.status).to.equal(400);
    });

    it('rejects empty steps (400)', async () => {
      const res = await authed().post(`/api/projects/${fix.projectId}/analytics/funnels/query`).send({
        steps: [],
        relativeTime: { amount: 7, unit: 'days' },
      });
      expect(res.status).to.equal(400);
    });

    it('rejects invalid eventType (400)', async () => {
      const res = await authed().post(`/api/projects/${fix.projectId}/analytics/funnels/query`).send({
        steps: [
          { eventType: 'invalid_event_type', params: {} },
        ],
        relativeTime: { amount: 7, unit: 'days' },
      });
      expect(res.status).to.equal(400);
    });
  });

  describe('funnel query with scenarioRunId', () => {
    it('accepts scenarioRunId filter', async () => {
      const res = await authed().post(`/api/projects/${fix.projectId}/analytics/funnels/query?scenarioRunId=some-run-id`).send({
        steps: [
          { eventType: 'session_started', params: { minSessions: '1' } },
          { eventType: 'enter_stage', params: { stageName: 'welcome' } },
        ],
        relativeTime: { amount: 7, unit: 'days' },
      });
      expect(res.status).to.equal(200);
    });
  });
});
