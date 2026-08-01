import { describe, it, beforeEach } from 'mocha';
import { expect } from 'chai';
import { authed, resetDatabase } from '../utils';
import { createProjectWithAgent } from '../fixtures';

interface Fixture { projectId: string; agentId: string; }

function minimalTransformer() {
  return {
    name: 'Test Transformer',
    prompt: 'Transform the context.',
    llmProviderId: 'openai',
    llmSettings: { provider: 'openai', model: 'gpt-4', temperature: 0.5 },
  };
}

describe('Context Transformer API', () => {
  let fix: Fixture;

  beforeEach(async () => {
    await resetDatabase();
    fix = await createProjectWithAgent();
  });

  describe('list', () => {
    it('returns empty list', async () => {
      const res = await authed().get(`/api/projects/${fix.projectId}/context-transformers`);
      expect(res.status).to.equal(200);
      expect(res.body.items).to.be.an('array').that.is.empty;
    });

    it('returns transformers after creation', async () => {
      await authed().post(`/api/projects/${fix.projectId}/context-transformers`).send({ ...minimalTransformer(), name: 'A' });
      await authed().post(`/api/projects/${fix.projectId}/context-transformers`).send({ ...minimalTransformer(), name: 'B' });
      const res = await authed().get(`/api/projects/${fix.projectId}/context-transformers`);
      expect(res.body.items).to.have.length(2);
    });
  });

  describe('create', () => {
    it('creates with minimal fields', async () => {
      const res = await authed().post(`/api/projects/${fix.projectId}/context-transformers`).send(minimalTransformer());
      expect(res.status).to.equal(201);
      expect(res.body.id).to.be.a('string');
      expect(res.body.version).to.equal(1);
    });

    it('auto-generates ID', async () => {
      const res = await authed().post(`/api/projects/${fix.projectId}/context-transformers`).send(minimalTransformer());
      expect(res.status).to.equal(201);
      expect(res.body.id).to.be.a('string');
    });

    it('creates with context fields', async () => {
      const res = await authed().post(`/api/projects/${fix.projectId}/context-transformers`).send({
        ...minimalTransformer(),
        description: 'Summarizer',
        contextFields: ['userInput', 'history'],
        tags: ['summarize'],
        metadata: { version: '1.0' },
      });
      expect(res.status).to.equal(201);
      expect(res.body.contextFields).to.deep.equal(['userInput', 'history']);
      expect(res.body.tags).to.deep.equal(['summarize']);
    });

    it('rejects missing name (400)', async () => {
      const p = minimalTransformer();
      delete p.name;
      const res = await authed().post(`/api/projects/${fix.projectId}/context-transformers`).send(p);
      expect(res.status).to.equal(400);
    });

    it('rejects missing prompt (400)', async () => {
      const p = minimalTransformer();
      delete p.prompt;
      const res = await authed().post(`/api/projects/${fix.projectId}/context-transformers`).send(p);
      expect(res.status).to.equal(400);
    });
  });

  describe('get by id', () => {
    it('returns transformer by ID', async () => {
      const cr = await authed().post(`/api/projects/${fix.projectId}/context-transformers`).send(minimalTransformer());
      const res = await authed().get(`/api/projects/${fix.projectId}/context-transformers/${cr.body.id}`);
      expect(res.status).to.equal(200);
      expect(res.body.id).to.equal(cr.body.id);
    });

    it('returns 404 for non-existent', async () => {
      const res = await authed().get(`/api/projects/${fix.projectId}/context-transformers/nonexistent`);
      expect(res.status).to.equal(404);
    });
  });

  describe('update', () => {
    it('updates name', async () => {
      const cr = await authed().post(`/api/projects/${fix.projectId}/context-transformers`).send(minimalTransformer());
      const res = await authed().put(`/api/projects/${fix.projectId}/context-transformers/${cr.body.id}`).send({ name: 'Updated', version: cr.body.version });
      expect(res.status).to.equal(200);
      expect(res.body.name).to.equal('Updated');
      expect(res.body.version).to.equal(cr.body.version + 1);
    });

    it('updates context fields', async () => {
      const cr = await authed().post(`/api/projects/${fix.projectId}/context-transformers`).send(minimalTransformer());
      const res = await authed().put(`/api/projects/${fix.projectId}/context-transformers/${cr.body.id}`).send({
        contextFields: ['userInput', 'history', 'metadata'],
        version: cr.body.version,
      });
      expect(res.status).to.equal(200);
      expect(res.body.contextFields).to.deep.equal(['userInput', 'history', 'metadata']);
    });

    it('rejects stale version (409)', async () => {
      const cr = await authed().post(`/api/projects/${fix.projectId}/context-transformers`).send(minimalTransformer());
      await authed().put(`/api/projects/${fix.projectId}/context-transformers/${cr.body.id}`).send({ name: 'First', version: cr.body.version });
      const res = await authed().put(`/api/projects/${fix.projectId}/context-transformers/${cr.body.id}`).send({ name: 'Second', version: cr.body.version });
      expect(res.status).to.be.oneOf([400, 409]);
    });

    it('rejects missing version (400)', async () => {
      const cr = await authed().post(`/api/projects/${fix.projectId}/context-transformers`).send(minimalTransformer());
      const res = await authed().put(`/api/projects/${fix.projectId}/context-transformers/${cr.body.id}`).send({ name: 'Updated' });
      expect(res.status).to.equal(400);
    });

    it('returns 404 for non-existent', async () => {
      const res = await authed().put(`/api/projects/${fix.projectId}/context-transformers/nonexistent`).send({ name: 'X', version: 1 });
      expect(res.status).to.equal(404);
    });
  });

  describe('delete', () => {
    it('deletes a transformer', async () => {
      const cr = await authed().post(`/api/projects/${fix.projectId}/context-transformers`).send(minimalTransformer());
      const res = await authed().delete(`/api/projects/${fix.projectId}/context-transformers/${cr.body.id}`).send({ version: cr.body.version });
      expect(res.status).to.be.oneOf([200, 204]);
      const getRes = await authed().get(`/api/projects/${fix.projectId}/context-transformers/${cr.body.id}`);
      expect(getRes.status).to.equal(404);
    });

    it('returns 404 for non-existent', async () => {
      const res = await authed().delete(`/api/projects/${fix.projectId}/context-transformers/nonexistent`).send({ version: 1 });
      expect(res.status).to.equal(404);
    });
  });

  describe('clone', () => {
    it('clones with auto-generated name', async () => {
      const cr = await authed().post(`/api/projects/${fix.projectId}/context-transformers`).send({ ...minimalTransformer(), name: 'Original' });
      const res = await authed().post(`/api/projects/${fix.projectId}/context-transformers/${cr.body.id}/clone`).send({});
      expect(res.status).to.equal(201);
      expect(res.body.id).to.not.equal(cr.body.id);
      expect(res.body.name).to.equal('Original (Clone)');
    });

    it('clones with custom name', async () => {
      const cr = await authed().post(`/api/projects/${fix.projectId}/context-transformers`).send({ ...minimalTransformer(), name: 'Original' });
      const res = await authed().post(`/api/projects/${fix.projectId}/context-transformers/${cr.body.id}/clone`).send({ name: 'Custom' });
      expect(res.status).to.equal(201);
      expect(res.body.name).to.equal('Custom');
    });

    it('returns 404 for non-existent', async () => {
      const res = await authed().post(`/api/projects/${fix.projectId}/context-transformers/nonexistent/clone`).send({});
      expect(res.status).to.equal(404);
    });
  });

  describe('audit logs', () => {
    it('returns audit logs after creation', async () => {
      const cr = await authed().post(`/api/projects/${fix.projectId}/context-transformers`).send(minimalTransformer());
      const res = await authed().get(`/api/projects/${fix.projectId}/context-transformers/${cr.body.id}/audit-logs`);
      expect(res.status).to.equal(200);
      expect(res.body).to.be.an('array');
      expect(res.body.length).to.be.greaterThanOrEqual(1);
    });
  });

  describe('pagination and filtering', () => {
    it('respects offset/limit', async () => {
      for (let i = 0; i < 3; i++) {
        await authed().post(`/api/projects/${fix.projectId}/context-transformers`).send({ ...minimalTransformer(), name: `CT${i}` });
      }
      const res = await authed().get(`/api/projects/${fix.projectId}/context-transformers?offset=1&limit=1`);
      expect(res.body.items).to.have.length(1);
      expect(res.body.total).to.equal(3);
    });

    it('filters by tags', async () => {
      await authed().post(`/api/projects/${fix.projectId}/context-transformers`).send({ ...minimalTransformer(), name: 'Tagged', tags: ['summarize'] });
      await authed().post(`/api/projects/${fix.projectId}/context-transformers`).send({ ...minimalTransformer(), name: 'Untagged' });
      const res = await authed().get(`/api/projects/${fix.projectId}/context-transformers?filters[tags]=summarize`);
      expect(res.body.items).to.have.length(1);
    });

    it('searches by name', async () => {
      await authed().post(`/api/projects/${fix.projectId}/context-transformers`).send({ ...minimalTransformer(), name: 'Alpha' });
      await authed().post(`/api/projects/${fix.projectId}/context-transformers`).send({ ...minimalTransformer(), name: 'Beta' });
      const res = await authed().get(`/api/projects/${fix.projectId}/context-transformers?textSearch=alpha`);
      expect(res.body.items).to.have.length(1);
    });
  });
});
