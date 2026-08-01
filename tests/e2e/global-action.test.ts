import { describe, it, beforeEach } from 'mocha';
import { expect } from 'chai';
import { authed, resetDatabase } from '../utils';
import { createProjectWithAgent } from '../fixtures';

interface Fixture { projectId: string; agentId: string; }

function minimalGlobalAction() {
  return {
    name: 'Test Global Action',
    triggerOnUserInput: true,
    triggerOnClientCommand: false,
    effects: [{ type: 'generate_response' }],
  };
}

describe('Global Action API', () => {
  let fix: Fixture;

  beforeEach(async () => {
    await resetDatabase();
    fix = await createProjectWithAgent();
  });

  describe('list', () => {
    it('returns empty list', async () => {
      const res = await authed().get(`/api/projects/${fix.projectId}/global-actions`);
      expect(res.status).to.equal(200);
      expect(res.body.items).to.be.an('array').that.is.empty;
    });

    it('returns global actions after creation', async () => {
      await authed().post(`/api/projects/${fix.projectId}/global-actions`).send({ ...minimalGlobalAction(), name: 'A' });
      await authed().post(`/api/projects/${fix.projectId}/global-actions`).send({ ...minimalGlobalAction(), name: 'B' });
      const res = await authed().get(`/api/projects/${fix.projectId}/global-actions`);
      expect(res.body.items).to.have.length(2);
    });
  });

  describe('create', () => {
    it('creates with minimal fields', async () => {
      const res = await authed().post(`/api/projects/${fix.projectId}/global-actions`).send(minimalGlobalAction());
      expect(res.status).to.equal(201);
      expect(res.body.id).to.be.a('string');
      expect(res.body.version).to.equal(1);
    });

    it('auto-generates ID', async () => {
      const res = await authed().post(`/api/projects/${fix.projectId}/global-actions`).send(minimalGlobalAction());
      expect(res.status).to.equal(201);
      expect(res.body.id).to.be.a('string');
    });

    it('creates with full config', async () => {
      const res = await authed().post(`/api/projects/${fix.projectId}/global-actions`).send({
        ...minimalGlobalAction(),
        condition: 'vars.order != null',
        classificationTrigger: 'order_status',
        parameters: [{ name: 'orderId', type: 'string', description: 'Order ID', required: true }],
        examples: ['What is my order status?'],
        tags: ['orders'],
        metadata: { source: 'test' },
      });
      expect(res.status).to.equal(201);
      expect(res.body.condition).to.equal('vars.order != null');
      expect(res.body.classificationTrigger).to.equal('order_status');
      expect(res.body.parameters).to.have.length(1);
    });

    it('supports multiple effects', async () => {
      const res = await authed().post(`/api/projects/${fix.projectId}/global-actions`).send({
        ...minimalGlobalAction(),
        effects: [
          { type: 'modify_variables', modifications: [{ variableName: 'lastAction', operation: 'set', value: 'greeted' }] },
          { type: 'generate_response' },
        ],
      });
      expect(res.status).to.equal(201);
      expect(res.body.effects).to.have.length(2);
    });

    it('rejects missing name (400)', async () => {
      const p = minimalGlobalAction();
      delete p.name;
      const res = await authed().post(`/api/projects/${fix.projectId}/global-actions`).send(p);
      expect(res.status).to.equal(400);
    });
  });

  describe('get by id', () => {
    it('returns global action by ID', async () => {
      const cr = await authed().post(`/api/projects/${fix.projectId}/global-actions`).send(minimalGlobalAction());
      const res = await authed().get(`/api/projects/${fix.projectId}/global-actions/${cr.body.id}`);
      expect(res.status).to.equal(200);
      expect(res.body.id).to.equal(cr.body.id);
    });

    it('returns 404 for non-existent', async () => {
      const res = await authed().get(`/api/projects/${fix.projectId}/global-actions/nonexistent`);
      expect(res.status).to.equal(404);
    });
  });

  describe('update', () => {
    it('updates name', async () => {
      const cr = await authed().post(`/api/projects/${fix.projectId}/global-actions`).send(minimalGlobalAction());
      const res = await authed().put(`/api/projects/${fix.projectId}/global-actions/${cr.body.id}`).send({ name: 'Updated', version: cr.body.version });
      expect(res.status).to.equal(200);
      expect(res.body.name).to.equal('Updated');
      expect(res.body.version).to.equal(cr.body.version + 1);
    });

    it('updates effects', async () => {
      const cr = await authed().post(`/api/projects/${fix.projectId}/global-actions`).send(minimalGlobalAction());
      const res = await authed().put(`/api/projects/${fix.projectId}/global-actions/${cr.body.id}`).send({
        version: cr.body.version,
        effects: [{ type: 'end_conversation', reason: 'user left' }],
      });
      expect(res.status).to.equal(200);
      expect(res.body.effects[0].type).to.equal('end_conversation');
    });

    it('rejects stale version (409)', async () => {
      const cr = await authed().post(`/api/projects/${fix.projectId}/global-actions`).send(minimalGlobalAction());
      await authed().put(`/api/projects/${fix.projectId}/global-actions/${cr.body.id}`).send({ name: 'First', version: cr.body.version });
      const res = await authed().put(`/api/projects/${fix.projectId}/global-actions/${cr.body.id}`).send({ name: 'Second', version: cr.body.version });
      expect(res.status).to.be.oneOf([400, 409]);
    });

    it('rejects missing version (400)', async () => {
      const cr = await authed().post(`/api/projects/${fix.projectId}/global-actions`).send(minimalGlobalAction());
      const res = await authed().put(`/api/projects/${fix.projectId}/global-actions/${cr.body.id}`).send({ name: 'Updated' });
      expect(res.status).to.equal(400);
    });

    it('returns 404 for non-existent', async () => {
      const res = await authed().put(`/api/projects/${fix.projectId}/global-actions/nonexistent`).send({ name: 'X', version: 1 });
      expect(res.status).to.equal(404);
    });
  });

  describe('delete', () => {
    it('deletes a global action', async () => {
      const cr = await authed().post(`/api/projects/${fix.projectId}/global-actions`).send(minimalGlobalAction());
      const res = await authed().delete(`/api/projects/${fix.projectId}/global-actions/${cr.body.id}`).send({ version: cr.body.version });
      expect(res.status).to.be.oneOf([200, 204]);
      const getRes = await authed().get(`/api/projects/${fix.projectId}/global-actions/${cr.body.id}`);
      expect(getRes.status).to.equal(404);
    });

    it('returns 404 for non-existent', async () => {
      const res = await authed().delete(`/api/projects/${fix.projectId}/global-actions/nonexistent`).send({ version: 1 });
      expect(res.status).to.equal(404);
    });
  });

  describe('clone', () => {
    it('clones with auto-generated name', async () => {
      const cr = await authed().post(`/api/projects/${fix.projectId}/global-actions`).send({ ...minimalGlobalAction(), name: 'Original' });
      const res = await authed().post(`/api/projects/${fix.projectId}/global-actions/${cr.body.id}/clone`).send({});
      expect(res.status).to.equal(201);
      expect(res.body.id).to.not.equal(cr.body.id);
      expect(res.body.name).to.equal('Original (Clone)');
    });

    it('clones with custom name', async () => {
      const cr = await authed().post(`/api/projects/${fix.projectId}/global-actions`).send({ ...minimalGlobalAction(), name: 'Original' });
      const res = await authed().post(`/api/projects/${fix.projectId}/global-actions/${cr.body.id}/clone`).send({ name: 'Custom' });
      expect(res.status).to.equal(201);
      expect(res.body.name).to.equal('Custom');
    });

    it('returns 404 for non-existent', async () => {
      const res = await authed().post(`/api/projects/${fix.projectId}/global-actions/nonexistent/clone`).send({});
      expect(res.status).to.equal(404);
    });
  });

  describe('audit logs', () => {
    it('returns audit logs after creation', async () => {
      const cr = await authed().post(`/api/projects/${fix.projectId}/global-actions`).send(minimalGlobalAction());
      const res = await authed().get(`/api/projects/${fix.projectId}/global-actions/${cr.body.id}/audit-logs`);
      expect(res.status).to.equal(200);
      expect(res.body).to.be.an('array');
      expect(res.body.length).to.be.greaterThanOrEqual(1);
    });
  });

  describe('triggers and metadata', () => {
    it('supports triggerOnExternal', async () => {
      const res = await authed().post(`/api/projects/${fix.projectId}/global-actions`).send({
        ...minimalGlobalAction(),
        triggerOnExternal: true,
      });
      expect(res.status).to.equal(201);
      expect(res.body.triggerOnExternal).to.equal(true);
    });

    it('supports overrideClassifierId', async () => {
      const res = await authed().post(`/api/projects/${fix.projectId}/global-actions`).send({
        ...minimalGlobalAction(),
        overrideClassifierId: 'custom-classifier',
      });
      expect(res.status).to.equal(201);
      expect(res.body.overrideClassifierId).to.equal('custom-classifier');
    });
  });

  describe('pagination and filtering', () => {
    it('respects offset/limit', async () => {
      for (let i = 0; i < 3; i++) {
        await authed().post(`/api/projects/${fix.projectId}/global-actions`).send({ ...minimalGlobalAction(), name: `GA${i}` });
      }
      const res = await authed().get(`/api/projects/${fix.projectId}/global-actions?offset=1&limit=1`);
      expect(res.body.items).to.have.length(1);
      expect(res.body.total).to.equal(3);
    });

    it('filters by tags', async () => {
      await authed().post(`/api/projects/${fix.projectId}/global-actions`).send({ ...minimalGlobalAction(), name: 'Tagged', tags: ['billing'] });
      await authed().post(`/api/projects/${fix.projectId}/global-actions`).send({ ...minimalGlobalAction(), name: 'Untagged' });
      const res = await authed().get(`/api/projects/${fix.projectId}/global-actions?filters[tags]=billing`);
      expect(res.body.items).to.have.length(1);
    });

    it('searches by name', async () => {
      await authed().post(`/api/projects/${fix.projectId}/global-actions`).send({ ...minimalGlobalAction(), name: 'Alpha' });
      await authed().post(`/api/projects/${fix.projectId}/global-actions`).send({ ...minimalGlobalAction(), name: 'Beta' });
      const res = await authed().get(`/api/projects/${fix.projectId}/global-actions?textSearch=alpha`);
      expect(res.body.items).to.have.length(1);
    });
  });
});
