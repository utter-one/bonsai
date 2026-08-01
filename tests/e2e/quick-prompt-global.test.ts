import { describe, it, beforeEach } from 'mocha';
import { expect } from 'chai';
import { authed, resetDatabase } from '../utils';

function minimalGlobalQuickPrompt() {
  return {
    categoryId: 'agent' as const,
    name: 'Global Prompt',
    content: 'You are a {{role}}.',
  };
}

describe('Quick Prompt API — Global (non-project scoped)', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  describe('list', () => {
    it('returns empty list', async () => {
      const res = await authed().get('/api/quick-prompts');
      expect(res.status).to.equal(200);
      expect(res.body.items).to.be.an('array');
      expect(res.body.total).to.equal(0);
    });

    it('returns prompts after creation', async () => {
      await authed().post('/api/quick-prompts').send({ ...minimalGlobalQuickPrompt(), name: 'A' });
      await authed().post('/api/quick-prompts').send({ ...minimalGlobalQuickPrompt(), name: 'B' });
      const res = await authed().get('/api/quick-prompts');
      expect(res.status).to.equal(200);
      expect(res.body.items).to.have.length.greaterThanOrEqual(2);
    });
  });

  describe('create', () => {
    it('creates with minimal fields', async () => {
      const res = await authed().post('/api/quick-prompts').send(minimalGlobalQuickPrompt());
      expect(res.status).to.equal(201);
      expect(res.body.id).to.be.a('string');
      expect(res.body.version).to.equal(1);
      expect(res.body.name).to.equal('Global Prompt');
    });

    it('creates with full config', async () => {
      const res = await authed().post('/api/quick-prompts').send({
        ...minimalGlobalQuickPrompt(),
        description: 'A global prompt',
        tags: ['shared'],
        isPublic: true,
      });
      expect(res.status).to.equal(201);
      expect(res.body.description).to.equal('A global prompt');
      expect(res.body.tags).to.deep.equal(['shared']);
      expect(res.body.isPublic).to.equal(true);
    });

    it('rejects missing name (400)', async () => {
      const p = minimalGlobalQuickPrompt();
      delete p.name;
      const res = await authed().post('/api/quick-prompts').send(p);
      expect(res.status).to.equal(400);
    });

    it('rejects missing content (400)', async () => {
      const p = minimalGlobalQuickPrompt();
      delete p.content;
      const res = await authed().post('/api/quick-prompts').send(p);
      expect(res.status).to.equal(400);
    });

    it('rejects invalid categoryId (400)', async () => {
      const res = await authed().post('/api/quick-prompts').send({
        ...minimalGlobalQuickPrompt(),
        categoryId: 'invalid_category',
      });
      expect(res.status).to.equal(400);
    });
  });

  describe('get by id', () => {
    it('returns prompt by ID', async () => {
      const cr = await authed().post('/api/quick-prompts').send(minimalGlobalQuickPrompt());
      const res = await authed().get(`/api/quick-prompts/${cr.body.id}`);
      expect(res.status).to.equal(200);
      expect(res.body.id).to.equal(cr.body.id);
      expect(res.body.name).to.equal('Global Prompt');
    });

    it('returns 404 for non-existent', async () => {
      const res = await authed().get('/api/quick-prompts/nonexistent');
      expect(res.status).to.equal(404);
    });
  });

  describe('update', () => {
    it('updates name', async () => {
      const cr = await authed().post('/api/quick-prompts').send(minimalGlobalQuickPrompt());
      const res = await authed().put(`/api/quick-prompts/${cr.body.id}`).send({
        name: 'Updated Global',
        version: cr.body.version,
      });
      expect(res.status).to.equal(200);
      expect(res.body.name).to.equal('Updated Global');
      expect(res.body.version).to.equal(cr.body.version + 1);
    });

    it('updates content', async () => {
      const cr = await authed().post('/api/quick-prompts').send(minimalGlobalQuickPrompt());
      const res = await authed().put(`/api/quick-prompts/${cr.body.id}`).send({
        content: 'New content here.',
        version: cr.body.version,
      });
      expect(res.status).to.equal(200);
      expect(res.body.content).to.equal('New content here.');
    });

    it('rejects stale version (409)', async () => {
      const cr = await authed().post('/api/quick-prompts').send(minimalGlobalQuickPrompt());
      await authed().put(`/api/quick-prompts/${cr.body.id}`).send({ name: 'First', version: cr.body.version });
      const res = await authed().put(`/api/quick-prompts/${cr.body.id}`).send({ name: 'Second', version: cr.body.version });
      expect(res.status).to.be.oneOf([400, 409]);
    });

    it('rejects missing version (400)', async () => {
      const cr = await authed().post('/api/quick-prompts').send(minimalGlobalQuickPrompt());
      const res = await authed().put(`/api/quick-prompts/${cr.body.id}`).send({ name: 'Updated' });
      expect(res.status).to.equal(400);
    });

    it('returns 404 for non-existent', async () => {
      const res = await authed().put('/api/quick-prompts/nonexistent').send({ name: 'X', version: 1 });
      expect(res.status).to.equal(404);
    });
  });

  describe('delete', () => {
    it('deletes a prompt', async () => {
      const cr = await authed().post('/api/quick-prompts').send(minimalGlobalQuickPrompt());
      const res = await authed().delete(`/api/quick-prompts/${cr.body.id}`).send({ version: cr.body.version });
      expect(res.status).to.be.oneOf([200, 204]);
      const getRes = await authed().get(`/api/quick-prompts/${cr.body.id}`);
      expect(getRes.status).to.equal(404);
    });

    it('returns 404 for non-existent', async () => {
      const res = await authed().delete('/api/quick-prompts/nonexistent').send({ version: 1 });
      expect(res.status).to.equal(404);
    });
  });

  describe('clone', () => {
    it('clones with auto-generated name', async () => {
      const cr = await authed().post('/api/quick-prompts').send({ ...minimalGlobalQuickPrompt(), name: 'Original' });
      const res = await authed().post(`/api/quick-prompts/${cr.body.id}/clone`).send({});
      expect(res.status).to.equal(201);
      expect(res.body.id).to.not.equal(cr.body.id);
      expect(res.body.name).to.equal('Original (Clone)');
    });

    it('clones with custom name', async () => {
      const cr = await authed().post('/api/quick-prompts').send({ ...minimalGlobalQuickPrompt(), name: 'Original' });
      const res = await authed().post(`/api/quick-prompts/${cr.body.id}/clone`).send({ name: 'Custom Clone' });
      expect(res.status).to.equal(201);
      expect(res.body.name).to.equal('Custom Clone');
      expect(res.body.content).to.equal('You are a {{role}}.');
    });

    it('returns 404 for non-existent', async () => {
      const res = await authed().post('/api/quick-prompts/nonexistent/clone').send({});
      expect(res.status).to.equal(404);
    });
  });

  describe('pagination and filtering', () => {
    it('respects offset/limit', async () => {
      for (let i = 0; i < 3; i++) {
        await authed().post('/api/quick-prompts').send({ ...minimalGlobalQuickPrompt(), name: `G${i}` });
      }
      const res = await authed().get('/api/quick-prompts?offset=1&limit=1');
      expect(res.status).to.equal(200);
      expect(res.body.items).to.have.length(1);
    });

    it('filters by tags', async () => {
      await authed().post('/api/quick-prompts').send({ ...minimalGlobalQuickPrompt(), name: 'Tagged', tags: ['shared'] });
      await authed().post('/api/quick-prompts').send({ ...minimalGlobalQuickPrompt(), name: 'Untagged' });
      const res = await authed().get('/api/quick-prompts?filters[tags]=shared');
      expect(res.status).to.equal(200);
      expect(res.body.items).to.have.length(1);
    });

    it('searches by name', async () => {
      await authed().post('/api/quick-prompts').send({ ...minimalGlobalQuickPrompt(), name: 'Alpha Global' });
      await authed().post('/api/quick-prompts').send({ ...minimalGlobalQuickPrompt(), name: 'Beta Global' });
      const res = await authed().get('/api/quick-prompts?textSearch=alpha');
      expect(res.status).to.equal(200);
      expect(res.body.items).to.have.length(1);
    });
  });
});
