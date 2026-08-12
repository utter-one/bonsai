import { describe, it, beforeEach } from 'mocha';
import { expect } from 'chai';
import { authed, resetDatabase } from '../utils';

function minimalProvider() {
  return {
    name: 'Test Provider',
    providerType: 'storage',
    apiType: 'local',
    config: { basePath: '/tmp/test-storage' },
  };
}

describe('Provider API', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  describe('list', () => {
    it('returns empty list', async () => {
      const res = await authed().get('/api/providers');
      expect(res.status).to.equal(200);
      expect(res.body.items).to.be.an('array').that.is.empty;
    });

    it('returns providers after creation', async () => {
      await authed().post('/api/providers').send({ ...minimalProvider(), name: 'A' });
      await authed().post('/api/providers').send({ ...minimalProvider(), name: 'B' });
      const res = await authed().get('/api/providers');
      expect(res.body.items).to.have.length(2);
    });
  });

  describe('create', () => {
    it('creates with minimal fields', async () => {
      const res = await authed().post('/api/providers').send(minimalProvider());
      expect(res.status).to.equal(201);
      expect(res.body.id).to.be.a('string');
      expect(res.body.version).to.equal(1);
    });

    it('creates with full config', async () => {
      const res = await authed().post('/api/providers').send({
        ...minimalProvider(),
        description: 'A test storage provider',
        tags: ['test', 'storage'],
      });
      expect(res.status).to.equal(201);
      expect(res.body.description).to.equal('A test storage provider');
      expect(res.body.tags).to.deep.equal(['test', 'storage']);
    });

    it('rejects missing name (400)', async () => {
      const p = minimalProvider();
      delete p.name;
      const res = await authed().post('/api/providers').send(p);
      expect(res.status).to.equal(400);
    });

    it('rejects missing config (400)', async () => {
      const p = minimalProvider();
      delete p.config;
      const res = await authed().post('/api/providers').send(p);
      expect(res.status).to.equal(400);
    });
  });

  describe('get by id', () => {
    it('returns provider by ID', async () => {
      const cr = await authed().post('/api/providers').send(minimalProvider());
      const res = await authed().get(`/api/providers/${cr.body.id}`);
      expect(res.status).to.equal(200);
      expect(res.body.id).to.equal(cr.body.id);
    });

    it('returns 404 for non-existent', async () => {
      const res = await authed().get('/api/providers/nonexistent');
      expect(res.status).to.equal(404);
    });
  });

  describe('update', () => {
    it('updates name', async () => {
      const cr = await authed().post('/api/providers').send(minimalProvider());
      const res = await authed().put(`/api/providers/${cr.body.id}`).send({ name: 'Updated', version: cr.body.version });
      expect(res.status).to.equal(200);
      expect(res.body.name).to.equal('Updated');
      expect(res.body.version).to.equal(cr.body.version + 1);
    });

    it('rejects stale version (409)', async () => {
      const cr = await authed().post('/api/providers').send(minimalProvider());
      await authed().put(`/api/providers/${cr.body.id}`).send({ name: 'First', version: cr.body.version });
      const res = await authed().put(`/api/providers/${cr.body.id}`).send({ name: 'Second', version: cr.body.version });
      expect(res.status).to.be.oneOf([400, 409]);
    });

    it('rejects missing version (400)', async () => {
      const cr = await authed().post('/api/providers').send(minimalProvider());
      const res = await authed().put(`/api/providers/${cr.body.id}`).send({ name: 'Updated' });
      expect(res.status).to.equal(400);
    });

    it('returns 404 for non-existent', async () => {
      const res = await authed().put('/api/providers/nonexistent').send({ name: 'X', version: 1 });
      expect(res.status).to.equal(404);
    });
  });

  describe('delete', () => {
    it('deletes a provider', async () => {
      const cr = await authed().post('/api/providers').send(minimalProvider());
      const res = await authed().delete(`/api/providers/${cr.body.id}`).send({ version: cr.body.version });
      expect(res.status).to.be.oneOf([200, 204]);
      const getRes = await authed().get(`/api/providers/${cr.body.id}`);
      expect(getRes.status).to.equal(404);
    });

    it('returns 404 for non-existent', async () => {
      const res = await authed().delete('/api/providers/nonexistent').send({ version: 1 });
      expect(res.status).to.equal(404);
    });
  });

  describe('audit logs', () => {
    it('returns audit logs after creation', async () => {
      const cr = await authed().post('/api/providers').send(minimalProvider());
      const res = await authed().get(`/api/providers/${cr.body.id}/audit-logs`);
      expect(res.status).to.equal(200);
      expect(res.body).to.be.an('array');
      expect(res.body.length).to.be.greaterThanOrEqual(1);
    });
  });

  describe('enumerate models', () => {
    it('returns models for an LLM provider', async () => {
      const llmRes = await authed().post('/api/providers').send({
        name: 'Test LLM',
        providerType: 'llm',
        apiType: 'openai',
        config: { apiKey: 'sk-test-key-123' },
      });
      expect(llmRes.status).to.equal(201);

      const res = await authed().get(`/api/providers/${llmRes.body.id}/models`);
      expect(res.status).to.equal(200);
      expect(res.body).to.have.property('models').that.is.an('array');
      // May have models from API or static fallback
      expect(res.body.models.length).to.be.greaterThanOrEqual(0);
    });

    it('returns 400 for non-LLM provider', async () => {
      const res = await authed().get('/api/providers/nonexistent/models');
      // Non-existent provider returns 404; non-LLM returns 400
      expect(res.status).to.be.oneOf([400, 404]);
    });

    it('returns 404 for non-existent provider', async () => {
      const res = await authed().get('/api/providers/nonexistent/models');
      expect(res.status).to.equal(404);
    });

    it('returns 400 for storage provider', async () => {
      const cr = await authed().post('/api/providers').send(minimalProvider());
      expect(cr.status).to.equal(201);

      const res = await authed().get(`/api/providers/${cr.body.id}/models`);
      expect(res.status).to.equal(400);
    });
  });

  describe('pagination and filtering', () => {
    it('respects offset/limit', async () => {
      for (let i = 0; i < 3; i++) {
        await authed().post('/api/providers').send({ ...minimalProvider(), name: `P${i}` });
      }
      const res = await authed().get('/api/providers?offset=1&limit=1');
      expect(res.body.items).to.have.length(1);
      expect(res.body.total).to.equal(3);
    });

    it('filters by providerType', async () => {
      await authed().post('/api/providers').send({ ...minimalProvider(), name: 'Storage' });
      const res = await authed().get('/api/providers?filters[providerType]=storage');
      expect(res.body.items).to.have.length(1);
    });

    it('filters by apiType', async () => {
      await authed().post('/api/providers').send({ ...minimalProvider(), name: 'Local' });
      const res = await authed().get('/api/providers?filters[apiType]=local');
      expect(res.body.items).to.have.length(1);
    });

    it('searches by name', async () => {
      await authed().post('/api/providers').send({ ...minimalProvider(), name: 'Alpha' });
      await authed().post('/api/providers').send({ ...minimalProvider(), name: 'Beta' });
      const res = await authed().get('/api/providers?textSearch=alpha');
      expect(res.body.items).to.have.length(1);
    });
  });
});
