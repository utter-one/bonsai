import { describe, it, beforeEach } from 'mocha';
import { expect } from 'chai';
import { authed, resetDatabase } from '../utils';
import { createProjectWithAgent } from '../fixtures';

interface Fixture { projectId: string; agentId: string; }

function minimalQuickPrompt() {
  return {
    categoryId: 'agent' as const,
    name: 'Test Prompt',
    content: 'You are a {{role}}.',
  };
}

describe('Quick Prompt API', () => {
  let fix: Fixture;

  beforeEach(async () => {
    await resetDatabase();
    fix = await createProjectWithAgent();
  });

  describe('list', () => {
    it('returns prompts after creation', async () => {
      await authed().post(`/api/projects/${fix.projectId}/quick-prompts`).send({ ...minimalQuickPrompt(), name: 'A' });
      const res = await authed().get(`/api/projects/${fix.projectId}/quick-prompts`);
      expect(res.status).to.equal(200);
      expect(res.body.items).to.have.length.greaterThanOrEqual(1);
    });
  });

  describe('create', () => {
    it('creates with minimal fields', async () => {
      const res = await authed().post(`/api/projects/${fix.projectId}/quick-prompts`).send(minimalQuickPrompt());
      expect(res.status).to.equal(201);
      expect(res.body.id).to.be.a('string');
      expect(res.body.version).to.equal(1);
    });

    it('creates with full config', async () => {
      const res = await authed().post(`/api/projects/${fix.projectId}/quick-prompts`).send({
        ...minimalQuickPrompt(),
        description: 'Agent prompt template',
        tags: ['templates'],
        isPublic: false,
      });
      expect(res.status).to.equal(201);
      expect(res.body.description).to.equal('Agent prompt template');
      expect(res.body.isPublic).to.equal(false);
    });

    it('rejects missing name (400)', async () => {
      const p = minimalQuickPrompt();
      delete p.name;
      const res = await authed().post(`/api/projects/${fix.projectId}/quick-prompts`).send(p);
      expect(res.status).to.equal(400);
    });

    it('rejects missing content (400)', async () => {
      const p = minimalQuickPrompt();
      delete p.content;
      const res = await authed().post(`/api/projects/${fix.projectId}/quick-prompts`).send(p);
      expect(res.status).to.equal(400);
    });

    it('rejects invalid categoryId (400)', async () => {
      const res = await authed().post(`/api/projects/${fix.projectId}/quick-prompts`).send({
        ...minimalQuickPrompt(),
        categoryId: 'invalid_category',
      });
      expect(res.status).to.equal(400);
    });
  });

  describe('get by id', () => {
    it('returns prompt by ID', async () => {
      const cr = await authed().post(`/api/projects/${fix.projectId}/quick-prompts`).send(minimalQuickPrompt());
      const res = await authed().get(`/api/projects/${fix.projectId}/quick-prompts/${cr.body.id}`);
      expect(res.status).to.equal(200);
      expect(res.body.id).to.equal(cr.body.id);
    });

    it('returns 404 for non-existent', async () => {
      const res = await authed().get(`/api/projects/${fix.projectId}/quick-prompts/nonexistent`);
      expect(res.status).to.equal(404);
    });
  });

  describe('update', () => {
    it('updates name', async () => {
      const cr = await authed().post(`/api/projects/${fix.projectId}/quick-prompts`).send(minimalQuickPrompt());
      const res = await authed().put(`/api/projects/${fix.projectId}/quick-prompts/${cr.body.id}`).send({ name: 'Updated', version: cr.body.version });
      expect(res.status).to.equal(200);
      expect(res.body.name).to.equal('Updated');
      expect(res.body.version).to.equal(cr.body.version + 1);
    });

    it('rejects stale version (409)', async () => {
      const cr = await authed().post(`/api/projects/${fix.projectId}/quick-prompts`).send(minimalQuickPrompt());
      await authed().put(`/api/projects/${fix.projectId}/quick-prompts/${cr.body.id}`).send({ name: 'First', version: cr.body.version });
      const res = await authed().put(`/api/projects/${fix.projectId}/quick-prompts/${cr.body.id}`).send({ name: 'Second', version: cr.body.version });
      expect(res.status).to.be.oneOf([400, 409]);
    });

    it('rejects missing version (400)', async () => {
      const cr = await authed().post(`/api/projects/${fix.projectId}/quick-prompts`).send(minimalQuickPrompt());
      const res = await authed().put(`/api/projects/${fix.projectId}/quick-prompts/${cr.body.id}`).send({ name: 'Updated' });
      expect(res.status).to.equal(400);
    });

    it('returns 404 for non-existent', async () => {
      const res = await authed().put(`/api/projects/${fix.projectId}/quick-prompts/nonexistent`).send({ name: 'X', version: 1 });
      expect(res.status).to.equal(404);
    });
  });

  describe('delete', () => {
    it('deletes a prompt', async () => {
      const cr = await authed().post(`/api/projects/${fix.projectId}/quick-prompts`).send(minimalQuickPrompt());
      const res = await authed().delete(`/api/projects/${fix.projectId}/quick-prompts/${cr.body.id}`).send({ version: cr.body.version });
      expect(res.status).to.be.oneOf([200, 204]);
      const getRes = await authed().get(`/api/projects/${fix.projectId}/quick-prompts/${cr.body.id}`);
      expect(getRes.status).to.equal(404);
    });

    it('returns 404 for non-existent', async () => {
      const res = await authed().delete(`/api/projects/${fix.projectId}/quick-prompts/nonexistent`).send({ version: 1 });
      expect(res.status).to.equal(404);
    });
  });

  describe('clone', () => {
    it('clones with auto-generated name', async () => {
      const cr = await authed().post(`/api/projects/${fix.projectId}/quick-prompts`).send({ ...minimalQuickPrompt(), name: 'Original' });
      const res = await authed().post(`/api/projects/${fix.projectId}/quick-prompts/${cr.body.id}/clone`).send({});
      expect(res.status).to.equal(201);
      expect(res.body.id).to.not.equal(cr.body.id);
      expect(res.body.name).to.equal('Original (Clone)');
    });

    it('clones with custom name', async () => {
      const cr = await authed().post(`/api/projects/${fix.projectId}/quick-prompts`).send({ ...minimalQuickPrompt(), name: 'Original' });
      const res = await authed().post(`/api/projects/${fix.projectId}/quick-prompts/${cr.body.id}/clone`).send({ name: 'Custom' });
      expect(res.status).to.equal(201);
      expect(res.body.name).to.equal('Custom');
    });

    it('returns 404 for non-existent', async () => {
      const res = await authed().post(`/api/projects/${fix.projectId}/quick-prompts/nonexistent/clone`).send({});
      expect(res.status).to.equal(404);
    });
  });

  describe('pagination and filtering', () => {
    it('respects offset/limit', async () => {
      for (let i = 0; i < 3; i++) {
        await authed().post(`/api/projects/${fix.projectId}/quick-prompts`).send({ ...minimalQuickPrompt(), name: `Q${i}` });
      }
      const res = await authed().get(`/api/projects/${fix.projectId}/quick-prompts?offset=1&limit=1`);
      expect(res.body.items).to.have.length(1);
    });

    it('filters by tags', async () => {
      await authed().post(`/api/projects/${fix.projectId}/quick-prompts`).send({ ...minimalQuickPrompt(), name: 'Tagged', tags: ['templates'] });
      await authed().post(`/api/projects/${fix.projectId}/quick-prompts`).send({ ...minimalQuickPrompt(), name: 'Untagged' });
      const res = await authed().get(`/api/projects/${fix.projectId}/quick-prompts?filters[tags]=templates`);
      expect(res.body.items).to.have.length(1);
    });

    it('searches by name', async () => {
      await authed().post(`/api/projects/${fix.projectId}/quick-prompts`).send({ ...minimalQuickPrompt(), name: 'Alpha' });
      await authed().post(`/api/projects/${fix.projectId}/quick-prompts`).send({ ...minimalQuickPrompt(), name: 'Beta' });
      const res = await authed().get(`/api/projects/${fix.projectId}/quick-prompts?textSearch=alpha`);
      expect(res.body.items).to.have.length(1);
    });
  });
});
