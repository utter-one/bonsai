import { describe, it, beforeEach } from 'mocha';
import { expect } from 'chai';
import { authed, resetDatabase } from '../utils';
import { createProjectWithAgent } from '../fixtures';

interface Fixture { projectId: string; agentId: string; }

function minimalApiKey() {
  return { name: 'Test Key' };
}

describe('API Key API', () => {
  let fix: Fixture;

  beforeEach(async () => {
    await resetDatabase();
    fix = await createProjectWithAgent();
  });

  describe('list (project-scoped)', () => {
    it('returns empty list', async () => {
      const res = await authed().get(`/api/projects/${fix.projectId}/api-keys`);
      expect(res.status).to.equal(200);
      expect(res.body.items).to.be.an('array').that.is.empty;
    });

    it('returns keys after creation', async () => {
      await authed().post(`/api/projects/${fix.projectId}/api-keys`).send({ name: 'Key A' });
      const res = await authed().get(`/api/projects/${fix.projectId}/api-keys`);
      expect(res.body.items).to.have.length(1);
    });
  });

  describe('list (all)', () => {
    it('returns all keys across projects', async () => {
      await authed().post(`/api/projects/${fix.projectId}/api-keys`).send({ name: 'Key A' });
      const res = await authed().get('/api/api-keys');
      expect(res.status).to.equal(200);
      expect(res.body.items).to.have.length(1);
    });
  });

  describe('create', () => {
    it('creates with minimal fields', async () => {
      const res = await authed().post(`/api/projects/${fix.projectId}/api-keys`).send(minimalApiKey());
      expect(res.status).to.equal(201);
      expect(res.body.id).to.be.a('string');
      expect(res.body.key).to.be.a('string');
      expect(res.body.version).to.equal(1);
    });

    it('creates with key settings', async () => {
      const res = await authed().post(`/api/projects/${fix.projectId}/api-keys`).send({
        name: 'Restricted Key',
        keySettings: {
          allowedChannels: ['websocket'],
          allowedFeatures: ['conversation_control'],
        },
      });
      expect(res.status).to.equal(201);
      expect(res.body.keySettings.allowedChannels).to.deep.equal(['websocket']);
    });

    it('creates with metadata', async () => {
      const res = await authed().post(`/api/projects/${fix.projectId}/api-keys`).send({
        name: 'Meta Key',
        metadata: { env: 'staging' },
      });
      expect(res.status).to.equal(201);
      expect(res.body.metadata.env).to.equal('staging');
    });

    it('rejects missing name (400)', async () => {
      const res = await authed().post(`/api/projects/${fix.projectId}/api-keys`).send({});
      expect(res.status).to.equal(400);
    });
  });

  describe('get by id', () => {
    it('returns key by ID', async () => {
      const cr = await authed().post(`/api/projects/${fix.projectId}/api-keys`).send(minimalApiKey());
      const res = await authed().get(`/api/projects/${fix.projectId}/api-keys/${cr.body.id}`);
      expect(res.status).to.equal(200);
      expect(res.body.id).to.equal(cr.body.id);
    });

    it('returns 404 for non-existent', async () => {
      const res = await authed().get(`/api/projects/${fix.projectId}/api-keys/nonexistent`);
      expect(res.status).to.equal(404);
    });
  });

  describe('update', () => {
    it('updates name', async () => {
      const cr = await authed().post(`/api/projects/${fix.projectId}/api-keys`).send(minimalApiKey());
      const res = await authed().put(`/api/projects/${fix.projectId}/api-keys/${cr.body.id}`).send({
        name: 'Updated Key',
        version: cr.body.version,
      });
      expect(res.status).to.equal(200);
      expect(res.body.name).to.equal('Updated Key');
      expect(res.body.version).to.equal(cr.body.version + 1);
    });

    it('deactivates key', async () => {
      const cr = await authed().post(`/api/projects/${fix.projectId}/api-keys`).send(minimalApiKey());
      const res = await authed().put(`/api/projects/${fix.projectId}/api-keys/${cr.body.id}`).send({
        isActive: false,
        version: cr.body.version,
      });
      expect(res.status).to.equal(200);
      expect(res.body.isActive).to.equal(false);
    });

    it('rejects stale version (409)', async () => {
      const cr = await authed().post(`/api/projects/${fix.projectId}/api-keys`).send(minimalApiKey());
      await authed().put(`/api/projects/${fix.projectId}/api-keys/${cr.body.id}`).send({ name: 'First', version: cr.body.version });
      const res = await authed().put(`/api/projects/${fix.projectId}/api-keys/${cr.body.id}`).send({ name: 'Second', version: cr.body.version });
      expect(res.status).to.be.oneOf([400, 409]);
    });

    it('rejects missing version (400)', async () => {
      const cr = await authed().post(`/api/projects/${fix.projectId}/api-keys`).send(minimalApiKey());
      const res = await authed().put(`/api/projects/${fix.projectId}/api-keys/${cr.body.id}`).send({ name: 'Updated' });
      expect(res.status).to.equal(400);
    });

    it('returns 404 for non-existent', async () => {
      const res = await authed().put(`/api/projects/${fix.projectId}/api-keys/nonexistent`).send({ name: 'X', version: 1 });
      expect(res.status).to.equal(404);
    });
  });

  describe('delete', () => {
    it('deletes a key', async () => {
      const cr = await authed().post(`/api/projects/${fix.projectId}/api-keys`).send(minimalApiKey());
      const res = await authed().delete(`/api/projects/${fix.projectId}/api-keys/${cr.body.id}`).send({ version: cr.body.version });
      expect(res.status).to.be.oneOf([200, 204]);
      const getRes = await authed().get(`/api/projects/${fix.projectId}/api-keys/${cr.body.id}`);
      expect(getRes.status).to.equal(404);
    });

    it('returns 404 for non-existent', async () => {
      const res = await authed().delete(`/api/projects/${fix.projectId}/api-keys/nonexistent`).send({ version: 1 });
      expect(res.status).to.equal(404);
    });
  });

  describe('audit logs', () => {
    it('returns audit logs after creation', async () => {
      const cr = await authed().post(`/api/projects/${fix.projectId}/api-keys`).send(minimalApiKey());
      const res = await authed().get(`/api/projects/${fix.projectId}/api-keys/${cr.body.id}/audit-logs`);
      expect(res.status).to.equal(200);
      expect(res.body).to.be.an('array');
      expect(res.body.length).to.be.greaterThanOrEqual(1);
    });
  });

  describe('pagination and filtering', () => {
    it('respects offset/limit', async () => {
      for (let i = 0; i < 3; i++) {
        await authed().post(`/api/projects/${fix.projectId}/api-keys`).send({ name: `Key ${i}` });
      }
      const res = await authed().get(`/api/projects/${fix.projectId}/api-keys?offset=1&limit=1`);
      expect(res.body.items).to.have.length(1);
      expect(res.body.total).to.equal(3);
    });

    it('searches by name', async () => {
      await authed().post(`/api/projects/${fix.projectId}/api-keys`).send({ name: 'Alpha Key' });
      await authed().post(`/api/projects/${fix.projectId}/api-keys`).send({ name: 'Beta Key' });
      const res = await authed().get(`/api/projects/${fix.projectId}/api-keys?textSearch=alpha`);
      expect(res.body.items).to.have.length(1);
    });

    it('filters by isActive', async () => {
      await authed().post(`/api/projects/${fix.projectId}/api-keys`).send({ name: 'Active Key' });
      const inactiveRes = await authed().post(`/api/projects/${fix.projectId}/api-keys`).send({ name: 'Inactive Key' });
      await authed().put(`/api/projects/${fix.projectId}/api-keys/${inactiveRes.body.id}`).send({
        isActive: false,
        version: inactiveRes.body.version,
      });
      const res = await authed().get(`/api/projects/${fix.projectId}/api-keys?filters[isActive]=true`);
      expect(res.body.items).to.have.length(1);
      expect(res.body.items[0].name).to.equal('Active Key');
    });
  });
});
