import { describe, it, beforeEach } from 'mocha';
import { expect } from 'chai';
import { authed, resetDatabase } from '../utils';
import { createProjectWithAgent } from '../fixtures';

interface Fixture { projectId: string; agentId: string; }

function minimalAgent() {
  return {
    name: 'Test Agent',
    prompt: 'You are a helpful assistant.',
  };
}

describe('Agent API', () => {
  let fix: Fixture;

  beforeEach(async () => {
    await resetDatabase();
    fix = await createProjectWithAgent();
  });

  describe('list', () => {
    it('returns agents after creation', async () => {
      // fixture already creates 1 agent; create 2 more
      await authed().post(`/api/projects/${fix.projectId}/agents`).send({ ...minimalAgent(), name: 'A' });
      await authed().post(`/api/projects/${fix.projectId}/agents`).send({ ...minimalAgent(), name: 'B' });
      const res = await authed().get(`/api/projects/${fix.projectId}/agents`);
      expect(res.status).to.equal(200);
      expect(res.body.items).to.have.length(3);
    });
  });

  describe('create', () => {
    it('creates with minimal fields', async () => {
      const res = await authed().post(`/api/projects/${fix.projectId}/agents`).send(minimalAgent());
      expect(res.status).to.equal(201);
      expect(res.body.id).to.be.a('string');
      expect(res.body.version).to.equal(1);
    });

    it('creates with full config', async () => {
      const res = await authed().post(`/api/projects/${fix.projectId}/agents`).send({
        ...minimalAgent(),
        description: 'Full agent',
        tags: ['primary'],
        metadata: { env: 'test' },
      });
      expect(res.status).to.equal(201);
      expect(res.body.description).to.equal('Full agent');
      expect(res.body.tags).to.deep.equal(['primary']);
    });

    it('rejects missing name (400)', async () => {
      const p = minimalAgent();
      delete p.name;
      const res = await authed().post(`/api/projects/${fix.projectId}/agents`).send(p);
      expect(res.status).to.equal(400);
    });

    it('rejects missing prompt (400)', async () => {
      const p = minimalAgent();
      delete p.prompt;
      const res = await authed().post(`/api/projects/${fix.projectId}/agents`).send(p);
      expect(res.status).to.equal(400);
    });
  });

  describe('get by id', () => {
    it('returns agent by ID', async () => {
      const cr = await authed().post(`/api/projects/${fix.projectId}/agents`).send(minimalAgent());
      const res = await authed().get(`/api/projects/${fix.projectId}/agents/${cr.body.id}`);
      expect(res.status).to.equal(200);
      expect(res.body.id).to.equal(cr.body.id);
    });

    it('returns 404 for non-existent', async () => {
      const res = await authed().get(`/api/projects/${fix.projectId}/agents/nonexistent`);
      expect(res.status).to.equal(404);
    });
  });

  describe('update', () => {
    it('updates name', async () => {
      const cr = await authed().post(`/api/projects/${fix.projectId}/agents`).send(minimalAgent());
      const res = await authed().put(`/api/projects/${fix.projectId}/agents/${cr.body.id}`).send({ name: 'Updated', version: cr.body.version });
      expect(res.status).to.equal(200);
      expect(res.body.name).to.equal('Updated');
      expect(res.body.version).to.equal(cr.body.version + 1);
    });

    it('rejects stale version (409)', async () => {
      const cr = await authed().post(`/api/projects/${fix.projectId}/agents`).send(minimalAgent());
      await authed().put(`/api/projects/${fix.projectId}/agents/${cr.body.id}`).send({ name: 'First', version: cr.body.version });
      const res = await authed().put(`/api/projects/${fix.projectId}/agents/${cr.body.id}`).send({ name: 'Second', version: cr.body.version });
      expect(res.status).to.be.oneOf([400, 409]);
    });

    it('rejects missing version (400)', async () => {
      const cr = await authed().post(`/api/projects/${fix.projectId}/agents`).send(minimalAgent());
      const res = await authed().put(`/api/projects/${fix.projectId}/agents/${cr.body.id}`).send({ name: 'Updated' });
      expect(res.status).to.equal(400);
    });

    it('returns 404 for non-existent', async () => {
      const res = await authed().put(`/api/projects/${fix.projectId}/agents/nonexistent`).send({ name: 'X', version: 1 });
      expect(res.status).to.equal(404);
    });
  });

  describe('delete', () => {
    it('deletes an agent', async () => {
      const cr = await authed().post(`/api/projects/${fix.projectId}/agents`).send(minimalAgent());
      const res = await authed().delete(`/api/projects/${fix.projectId}/agents/${cr.body.id}`).send({ version: cr.body.version });
      expect(res.status).to.be.oneOf([200, 204]);
      const getRes = await authed().get(`/api/projects/${fix.projectId}/agents/${cr.body.id}`);
      expect(getRes.status).to.equal(404);
    });

    it('returns 404 for non-existent', async () => {
      const res = await authed().delete(`/api/projects/${fix.projectId}/agents/nonexistent`).send({ version: 1 });
      expect(res.status).to.equal(404);
    });
  });

  describe('clone', () => {
    it('clones with auto-generated name', async () => {
      const cr = await authed().post(`/api/projects/${fix.projectId}/agents`).send({ ...minimalAgent(), name: 'Original' });
      const res = await authed().post(`/api/projects/${fix.projectId}/agents/${cr.body.id}/clone`).send({});
      expect(res.status).to.equal(201);
      expect(res.body.id).to.not.equal(cr.body.id);
      expect(res.body.name).to.equal('Original (Clone)');
    });

    it('clones with custom name', async () => {
      const cr = await authed().post(`/api/projects/${fix.projectId}/agents`).send({ ...minimalAgent(), name: 'Original' });
      const res = await authed().post(`/api/projects/${fix.projectId}/agents/${cr.body.id}/clone`).send({ name: 'Custom' });
      expect(res.status).to.equal(201);
      expect(res.body.name).to.equal('Custom');
    });

    it('returns 404 for non-existent', async () => {
      const res = await authed().post(`/api/projects/${fix.projectId}/agents/nonexistent/clone`).send({});
      expect(res.status).to.equal(404);
    });
  });

  describe('audit logs', () => {
    it('returns audit logs after creation', async () => {
      const cr = await authed().post(`/api/projects/${fix.projectId}/agents`).send(minimalAgent());
      const res = await authed().get(`/api/projects/${fix.projectId}/agents/${cr.body.id}/audit-logs`);
      expect(res.status).to.equal(200);
      expect(res.body).to.be.an('array');
      expect(res.body.length).to.be.greaterThanOrEqual(1);
    });
  });

  describe('pagination and filtering', () => {
    it('respects offset/limit', async () => {
      for (let i = 0; i < 3; i++) {
        await authed().post(`/api/projects/${fix.projectId}/agents`).send({ ...minimalAgent(), name: `A${i}` });
      }
      const res = await authed().get(`/api/projects/${fix.projectId}/agents?offset=1&limit=1`);
      expect(res.body.items).to.have.length(1);
      expect(res.body.total).to.equal(4); // fixture creates 1 + 3 = 4
    });

    it('searches by name', async () => {
      await authed().post(`/api/projects/${fix.projectId}/agents`).send({ ...minimalAgent(), name: 'Alpha' });
      await authed().post(`/api/projects/${fix.projectId}/agents`).send({ ...minimalAgent(), name: 'Beta' });
      const res = await authed().get(`/api/projects/${fix.projectId}/agents?textSearch=alpha`);
      expect(res.body.items).to.have.length(1);
    });
  });
});
