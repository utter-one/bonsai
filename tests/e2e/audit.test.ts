import { describe, it, beforeEach } from 'mocha';
import { expect } from 'chai';
import { authed, resetDatabase } from '../utils';
import { createProjectWithAgent } from '../fixtures';

describe('Audit API', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  describe('list', () => {
    it('returns empty list', async () => {
      const res = await authed().get('/api/audit-logs');
      expect(res.status).to.equal(200);
      expect(res.body.items).to.be.an('array').that.is.empty;
      expect(res.body.total).to.equal(0);
    });

    it('returns audit logs after entity creation', async () => {
      const fix = await createProjectWithAgent();
      await authed().post(`/api/projects/${fix.projectId}/agents`).send({
        name: 'Test Agent',
        prompt: 'You are a test agent.',
      });
      const res = await authed().get('/api/audit-logs');
      expect(res.status).to.equal(200);
      expect(res.body.items).to.have.length.greaterThanOrEqual(1);
    });

    it('filters by entityType', async () => {
      const fix = await createProjectWithAgent();
      await authed().post(`/api/projects/${fix.projectId}/agents`).send({
        name: 'Agent A',
        prompt: 'You are a test agent.',
      });
      const res = await authed().get('/api/audit-logs?filters[entityType]=agent');
      expect(res.status).to.equal(200);
      expect(res.body.items).to.have.length.greaterThanOrEqual(1);
    });

    it('filters by action', async () => {
      const fix = await createProjectWithAgent();
      await authed().post(`/api/projects/${fix.projectId}/agents`).send({
        name: 'Agent A',
        prompt: 'You are a test agent.',
      });
      const res = await authed().get('/api/audit-logs?filters[action]=CREATE');
      expect(res.status).to.equal(200);
      expect(res.body.items).to.have.length.greaterThanOrEqual(1);
    });

    it('respects offset/limit', async () => {
      const fix = await createProjectWithAgent();
      for (let i = 0; i < 3; i++) {
        await authed().post(`/api/projects/${fix.projectId}/agents`).send({
          name: `Agent ${i}`,
          prompt: 'You are a test agent.',
        });
      }
      const res = await authed().get('/api/audit-logs?offset=0&limit=1');
      expect(res.body.items).to.have.length(1);
    });

    it('searches by text', async () => {
      const fix = await createProjectWithAgent();
      await authed().post(`/api/projects/${fix.projectId}/agents`).send({
        name: 'Searchable Agent',
        prompt: 'You are a test agent.',
      });
      const res = await authed().get('/api/audit-logs?textSearch=CREATE');
      expect(res.status).to.equal(200);
      expect(res.body.items).to.have.length.greaterThanOrEqual(1);
    });
  });
});
