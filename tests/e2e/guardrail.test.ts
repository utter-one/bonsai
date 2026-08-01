import { describe, it, beforeEach } from 'mocha';
import { expect } from 'chai';
import { authed, resetDatabase } from '../utils';
import { createProjectWithAgent } from '../fixtures';

interface Fixture { projectId: string; agentId: string; }

function minimalGuardrail() {
  return {
    name: 'Test Guardrail',
    effects: [{ type: 'generate_response' }],
  };
}

describe('Guardrail API', () => {
  let fix: Fixture;

  beforeEach(async () => {
    await resetDatabase();
    fix = await createProjectWithAgent();
  });

  describe('list', () => {
    it('returns empty list', async () => {
      const res = await authed().get(`/api/projects/${fix.projectId}/guardrails`);
      expect(res.status).to.equal(200);
      expect(res.body.items).to.be.an('array').that.is.empty;
    });

    it('returns guardrails after creation', async () => {
      await authed().post(`/api/projects/${fix.projectId}/guardrails`).send({ ...minimalGuardrail(), name: 'A' });
      await authed().post(`/api/projects/${fix.projectId}/guardrails`).send({ ...minimalGuardrail(), name: 'B' });
      const res = await authed().get(`/api/projects/${fix.projectId}/guardrails`);
      expect(res.body.items).to.have.length(2);
    });
  });

  describe('create', () => {
    it('creates with minimal fields', async () => {
      const res = await authed().post(`/api/projects/${fix.projectId}/guardrails`).send(minimalGuardrail());
      expect(res.status).to.equal(201);
      expect(res.body.id).to.be.a('string');
      expect(res.body.version).to.equal(1);
    });

    it('creates with condition and classification trigger', async () => {
      const res = await authed().post(`/api/projects/${fix.projectId}/guardrails`).send({
        ...minimalGuardrail(),
        condition: 'vars.score < 50',
        classificationTrigger: 'low_score',
        examples: ['I am not happy'],
        tags: ['safety'],
      });
      expect(res.status).to.equal(201);
      expect(res.body.condition).to.equal('vars.score < 50');
      expect(res.body.classificationTrigger).to.equal('low_score');
      expect(res.body.examples).to.deep.equal(['I am not happy']);
    });

    it('rejects missing name (400)', async () => {
      const p = minimalGuardrail();
      delete p.name;
      const res = await authed().post(`/api/projects/${fix.projectId}/guardrails`).send(p);
      expect(res.status).to.equal(400);
    });
  });

  describe('get by id', () => {
    it('returns guardrail by ID', async () => {
      const cr = await authed().post(`/api/projects/${fix.projectId}/guardrails`).send(minimalGuardrail());
      const res = await authed().get(`/api/projects/${fix.projectId}/guardrails/${cr.body.id}`);
      expect(res.status).to.equal(200);
      expect(res.body.id).to.equal(cr.body.id);
    });

    it('returns 404 for non-existent', async () => {
      const res = await authed().get(`/api/projects/${fix.projectId}/guardrails/nonexistent`);
      expect(res.status).to.equal(404);
    });
  });

  describe('update', () => {
    it('updates name', async () => {
      const cr = await authed().post(`/api/projects/${fix.projectId}/guardrails`).send(minimalGuardrail());
      const res = await authed().put(`/api/projects/${fix.projectId}/guardrails/${cr.body.id}`).send({ name: 'Updated', version: cr.body.version });
      expect(res.status).to.equal(200);
      expect(res.body.name).to.equal('Updated');
      expect(res.body.version).to.equal(cr.body.version + 1);
    });

    it('rejects stale version (409)', async () => {
      const cr = await authed().post(`/api/projects/${fix.projectId}/guardrails`).send(minimalGuardrail());
      await authed().put(`/api/projects/${fix.projectId}/guardrails/${cr.body.id}`).send({ name: 'First', version: cr.body.version });
      const res = await authed().put(`/api/projects/${fix.projectId}/guardrails/${cr.body.id}`).send({ name: 'Second', version: cr.body.version });
      expect(res.status).to.be.oneOf([400, 409]);
    });

    it('rejects missing version (400)', async () => {
      const cr = await authed().post(`/api/projects/${fix.projectId}/guardrails`).send(minimalGuardrail());
      const res = await authed().put(`/api/projects/${fix.projectId}/guardrails/${cr.body.id}`).send({ name: 'Updated' });
      expect(res.status).to.equal(400);
    });

    it('returns 404 for non-existent', async () => {
      const res = await authed().put(`/api/projects/${fix.projectId}/guardrails/nonexistent`).send({ name: 'X', version: 1 });
      expect(res.status).to.equal(404);
    });
  });

  describe('delete', () => {
    it('deletes a guardrail', async () => {
      const cr = await authed().post(`/api/projects/${fix.projectId}/guardrails`).send(minimalGuardrail());
      const res = await authed().delete(`/api/projects/${fix.projectId}/guardrails/${cr.body.id}`).send({ version: cr.body.version });
      expect(res.status).to.be.oneOf([200, 204]);
      const getRes = await authed().get(`/api/projects/${fix.projectId}/guardrails/${cr.body.id}`);
      expect(getRes.status).to.equal(404);
    });

    it('returns 404 for non-existent', async () => {
      const res = await authed().delete(`/api/projects/${fix.projectId}/guardrails/nonexistent`).send({ version: 1 });
      expect(res.status).to.equal(404);
    });
  });

  describe('clone', () => {
    it('clones with auto-generated name', async () => {
      const cr = await authed().post(`/api/projects/${fix.projectId}/guardrails`).send({ ...minimalGuardrail(), name: 'Original' });
      const res = await authed().post(`/api/projects/${fix.projectId}/guardrails/${cr.body.id}/clone`).send({});
      expect(res.status).to.equal(201);
      expect(res.body.id).to.not.equal(cr.body.id);
      expect(res.body.name).to.equal('Original (Clone)');
    });

    it('clones with custom name', async () => {
      const cr = await authed().post(`/api/projects/${fix.projectId}/guardrails`).send({ ...minimalGuardrail(), name: 'Original' });
      const res = await authed().post(`/api/projects/${fix.projectId}/guardrails/${cr.body.id}/clone`).send({ name: 'Custom' });
      expect(res.status).to.equal(201);
      expect(res.body.name).to.equal('Custom');
    });

    it('returns 404 for non-existent', async () => {
      const res = await authed().post(`/api/projects/${fix.projectId}/guardrails/nonexistent/clone`).send({});
      expect(res.status).to.equal(404);
    });
  });

  describe('audit logs', () => {
    it('returns audit logs after creation', async () => {
      const cr = await authed().post(`/api/projects/${fix.projectId}/guardrails`).send(minimalGuardrail());
      const res = await authed().get(`/api/projects/${fix.projectId}/guardrails/${cr.body.id}/audit-logs`);
      expect(res.status).to.equal(200);
      expect(res.body).to.be.an('array');
      expect(res.body.length).to.be.greaterThanOrEqual(1);
    });
  });

  describe('pagination and filtering', () => {
    it('respects offset/limit', async () => {
      for (let i = 0; i < 3; i++) {
        await authed().post(`/api/projects/${fix.projectId}/guardrails`).send({ ...minimalGuardrail(), name: `G${i}` });
      }
      const res = await authed().get(`/api/projects/${fix.projectId}/guardrails?offset=1&limit=1`);
      expect(res.body.items).to.have.length(1);
      expect(res.body.total).to.equal(3);
    });

    it('filters by tags', async () => {
      await authed().post(`/api/projects/${fix.projectId}/guardrails`).send({ ...minimalGuardrail(), name: 'Tagged', tags: ['safety'] });
      await authed().post(`/api/projects/${fix.projectId}/guardrails`).send({ ...minimalGuardrail(), name: 'Untagged' });
      const res = await authed().get(`/api/projects/${fix.projectId}/guardrails?filters[tags]=safety`);
      expect(res.body.items).to.have.length(1);
    });

    it('searches by name', async () => {
      await authed().post(`/api/projects/${fix.projectId}/guardrails`).send({ ...minimalGuardrail(), name: 'Alpha' });
      await authed().post(`/api/projects/${fix.projectId}/guardrails`).send({ ...minimalGuardrail(), name: 'Beta' });
      const res = await authed().get(`/api/projects/${fix.projectId}/guardrails?textSearch=alpha`);
      expect(res.body.items).to.have.length(1);
    });
  });
});
