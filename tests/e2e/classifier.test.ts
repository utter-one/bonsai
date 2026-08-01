import { describe, it, beforeEach } from 'mocha';
import { expect } from 'chai';
import { authed, resetDatabase } from '../utils';
import { createProjectWithAgent } from '../fixtures';

interface Fixture { projectId: string; agentId: string; }

function minimalClassifier() {
  return {
    name: 'Test Classifier',
    prompt: 'Classify the user intent.',
    llmProviderId: 'openai',
    llmSettings: { provider: 'openai', model: 'gpt-4', temperature: 0.5 },
  };
}

describe('Classifier API', () => {
  let fix: Fixture;

  beforeEach(async () => {
    await resetDatabase();
    fix = await createProjectWithAgent();
  });

  describe('list', () => {
    it('returns empty list', async () => {
      const res = await authed().get(`/api/projects/${fix.projectId}/classifiers`);
      expect(res.status).to.equal(200);
      expect(res.body.items).to.be.an('array').that.is.empty;
    });

    it('returns classifiers after creation', async () => {
      await authed().post(`/api/projects/${fix.projectId}/classifiers`).send({ ...minimalClassifier(), name: 'A' });
      await authed().post(`/api/projects/${fix.projectId}/classifiers`).send({ ...minimalClassifier(), name: 'B' });
      const res = await authed().get(`/api/projects/${fix.projectId}/classifiers`);
      expect(res.body.items).to.have.length(2);
      expect(res.body.total).to.equal(2);
    });
  });

  describe('create', () => {
    it('creates with minimal fields', async () => {
      const res = await authed().post(`/api/projects/${fix.projectId}/classifiers`).send(minimalClassifier());
      expect(res.status).to.equal(201);
      expect(res.body.id).to.be.a('string');
      expect(res.body.version).to.equal(1);
    });

    it('auto-generates ID', async () => {
      const payload = minimalClassifier();
      const res = await authed().post(`/api/projects/${fix.projectId}/classifiers`).send(payload);
      expect(res.status).to.equal(201);
      expect(res.body.id).to.be.a('string');
    });

    it('creates with full config', async () => {
      const res = await authed().post(`/api/projects/${fix.projectId}/classifiers`).send({
        ...minimalClassifier(),
        description: 'Intent classifier',
        tags: ['intent', 'primary'],
        metadata: { env: 'test' },
      });
      expect(res.status).to.equal(201);
      expect(res.body.description).to.equal('Intent classifier');
      expect(res.body.tags).to.deep.equal(['intent', 'primary']);
    });

    it('rejects missing name (400)', async () => {
      const p = minimalClassifier();
      delete p.name;
      const res = await authed().post(`/api/projects/${fix.projectId}/classifiers`).send(p);
      expect(res.status).to.equal(400);
    });

    it('rejects missing prompt (400)', async () => {
      const p = minimalClassifier();
      delete p.prompt;
      const res = await authed().post(`/api/projects/${fix.projectId}/classifiers`).send(p);
      expect(res.status).to.equal(400);
    });
  });

  describe('get by id', () => {
    it('returns classifier by ID', async () => {
      const cr = await authed().post(`/api/projects/${fix.projectId}/classifiers`).send(minimalClassifier());
      const res = await authed().get(`/api/projects/${fix.projectId}/classifiers/${cr.body.id}`);
      expect(res.status).to.equal(200);
      expect(res.body.id).to.equal(cr.body.id);
    });

    it('returns 404 for non-existent', async () => {
      const res = await authed().get(`/api/projects/${fix.projectId}/classifiers/nonexistent`);
      expect(res.status).to.equal(404);
    });
  });

  describe('update', () => {
    it('updates name', async () => {
      const cr = await authed().post(`/api/projects/${fix.projectId}/classifiers`).send(minimalClassifier());
      const res = await authed().put(`/api/projects/${fix.projectId}/classifiers/${cr.body.id}`).send({ name: 'Updated', version: cr.body.version });
      expect(res.status).to.equal(200);
      expect(res.body.name).to.equal('Updated');
      expect(res.body.version).to.equal(cr.body.version + 1);
    });

    it('rejects stale version (409)', async () => {
      const cr = await authed().post(`/api/projects/${fix.projectId}/classifiers`).send(minimalClassifier());
      await authed().put(`/api/projects/${fix.projectId}/classifiers/${cr.body.id}`).send({ name: 'First', version: cr.body.version });
      const res = await authed().put(`/api/projects/${fix.projectId}/classifiers/${cr.body.id}`).send({ name: 'Second', version: cr.body.version });
      expect(res.status).to.be.oneOf([400, 409]);
    });

    it('rejects missing version (400)', async () => {
      const cr = await authed().post(`/api/projects/${fix.projectId}/classifiers`).send(minimalClassifier());
      const res = await authed().put(`/api/projects/${fix.projectId}/classifiers/${cr.body.id}`).send({ name: 'Updated' });
      expect(res.status).to.equal(400);
    });

    it('returns 404 for non-existent', async () => {
      const res = await authed().put(`/api/projects/${fix.projectId}/classifiers/nonexistent`).send({ name: 'X', version: 1 });
      expect(res.status).to.equal(404);
    });
  });

  describe('delete', () => {
    it('deletes a classifier', async () => {
      const cr = await authed().post(`/api/projects/${fix.projectId}/classifiers`).send(minimalClassifier());
      const res = await authed().delete(`/api/projects/${fix.projectId}/classifiers/${cr.body.id}`).send({ version: cr.body.version });
      expect(res.status).to.be.oneOf([200, 204]);
      const getRes = await authed().get(`/api/projects/${fix.projectId}/classifiers/${cr.body.id}`);
      expect(getRes.status).to.equal(404);
    });

    it('returns 404 for non-existent', async () => {
      const res = await authed().delete(`/api/projects/${fix.projectId}/classifiers/nonexistent`).send({ version: 1 });
      expect(res.status).to.equal(404);
    });

    it('rejects stale version', async () => {
      const cr = await authed().post(`/api/projects/${fix.projectId}/classifiers`).send(minimalClassifier());
      await authed().put(`/api/projects/${fix.projectId}/classifiers/${cr.body.id}`).send({ name: 'Bump', version: 1 });
      const res = await authed().delete(`/api/projects/${fix.projectId}/classifiers/${cr.body.id}`).send({ version: 1 });
      expect(res.status).to.be.oneOf([400, 409]);
    });
  });

  describe('clone', () => {
    it('clones with auto-generated name', async () => {
      const cr = await authed().post(`/api/projects/${fix.projectId}/classifiers`).send({ ...minimalClassifier(), name: 'Original' });
      const res = await authed().post(`/api/projects/${fix.projectId}/classifiers/${cr.body.id}/clone`).send({});
      expect(res.status).to.equal(201);
      expect(res.body.id).to.not.equal(cr.body.id);
      expect(res.body.name).to.equal('Original (Clone)');
    });

    it('clones with custom name', async () => {
      const cr = await authed().post(`/api/projects/${fix.projectId}/classifiers`).send({ ...minimalClassifier(), name: 'Original' });
      const res = await authed().post(`/api/projects/${fix.projectId}/classifiers/${cr.body.id}/clone`).send({ name: 'Custom Clone' });
      expect(res.status).to.equal(201);
      expect(res.body.name).to.equal('Custom Clone');
    });

    it('returns 404 for non-existent', async () => {
      const res = await authed().post(`/api/projects/${fix.projectId}/classifiers/nonexistent/clone`).send({});
      expect(res.status).to.equal(404);
    });
  });

  describe('audit logs', () => {
    it('returns audit logs after creation', async () => {
      const cr = await authed().post(`/api/projects/${fix.projectId}/classifiers`).send(minimalClassifier());
      const res = await authed().get(`/api/projects/${fix.projectId}/classifiers/${cr.body.id}/audit-logs`);
      expect(res.status).to.equal(200);
      expect(res.body).to.be.an('array');
      expect(res.body.length).to.be.greaterThanOrEqual(1);
    });

    it('has entries after update', async () => {
      const cr = await authed().post(`/api/projects/${fix.projectId}/classifiers`).send(minimalClassifier());
      await authed().put(`/api/projects/${fix.projectId}/classifiers/${cr.body.id}`).send({ name: 'Updated', version: 1 });
      const res = await authed().get(`/api/projects/${fix.projectId}/classifiers/${cr.body.id}/audit-logs`);
      expect(res.body.length).to.be.greaterThanOrEqual(2);
    });
  });

  describe('pagination and filtering', () => {
    it('respects offset/limit', async () => {
      for (let i = 0; i < 3; i++) {
        await authed().post(`/api/projects/${fix.projectId}/classifiers`).send({ ...minimalClassifier(), name: `C${i}` });
      }
      const res = await authed().get(`/api/projects/${fix.projectId}/classifiers?offset=1&limit=1`);
      expect(res.body.items).to.have.length(1);
      expect(res.body.total).to.equal(3);
    });

    it('filters by tags', async () => {
      await authed().post(`/api/projects/${fix.projectId}/classifiers`).send({ ...minimalClassifier(), name: 'Tagged', tags: ['important'] });
      await authed().post(`/api/projects/${fix.projectId}/classifiers`).send({ ...minimalClassifier(), name: 'Untagged' });
      const res = await authed().get(`/api/projects/${fix.projectId}/classifiers?filters[tags]=important`);
      expect(res.body.items).to.have.length(1);
      expect(res.body.items[0].name).to.equal('Tagged');
    });

    it('searches by name', async () => {
      await authed().post(`/api/projects/${fix.projectId}/classifiers`).send({ ...minimalClassifier(), name: 'Alpha' });
      await authed().post(`/api/projects/${fix.projectId}/classifiers`).send({ ...minimalClassifier(), name: 'Beta' });
      const res = await authed().get(`/api/projects/${fix.projectId}/classifiers?textSearch=alpha`);
      expect(res.body.items).to.have.length(1);
    });
  });
});
