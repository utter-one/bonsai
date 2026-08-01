import { describe, it, beforeEach } from 'mocha';
import { expect } from 'chai';
import { authed, resetDatabase } from '../utils';
import { createProjectWithAgent } from '../fixtures';

interface Fixture { projectId: string; agentId: string; }

function minimalSampleCopy() {
  return {
    name: 'Test Copy',
    promptTrigger: 'greeting',
    content: ['Hello!', 'Hi there!', 'Welcome!'],
  };
}

describe('Sample Copy API', () => {
  let fix: Fixture;

  beforeEach(async () => {
    await resetDatabase();
    fix = await createProjectWithAgent();
  });

  describe('list', () => {
    it('returns empty list', async () => {
      const res = await authed().get(`/api/projects/${fix.projectId}/sample-copies`);
      expect(res.status).to.equal(200);
      expect(res.body.items).to.be.an('array').that.is.empty;
      expect(res.body.total).to.equal(0);
    });

    it('returns copies after creation', async () => {
      await authed().post(`/api/projects/${fix.projectId}/sample-copies`).send({ ...minimalSampleCopy(), name: 'A' });
      const res = await authed().get(`/api/projects/${fix.projectId}/sample-copies`);
      expect(res.status).to.equal(200);
      expect(res.body.items).to.have.length.greaterThanOrEqual(1);
    });
  });

  describe('create', () => {
    it('creates with minimal fields', async () => {
      const res = await authed().post(`/api/projects/${fix.projectId}/sample-copies`).send(minimalSampleCopy());
      expect(res.status).to.equal(201);
      expect(res.body.id).to.be.a('string');
      expect(res.body.version).to.equal(1);
    });

    it('creates with full config', async () => {
      const res = await authed().post(`/api/projects/${fix.projectId}/sample-copies`).send({
        ...minimalSampleCopy(),
        amount: 2,
        samplingMethod: 'round_robin',
        mode: 'forced',
      });
      expect(res.status).to.equal(201);
      expect(res.body.amount).to.equal(2);
      expect(res.body.samplingMethod).to.equal('round_robin');
      expect(res.body.mode).to.equal('forced');
    });

    it('rejects missing name (400)', async () => {
      const p = minimalSampleCopy();
      delete p.name;
      const res = await authed().post(`/api/projects/${fix.projectId}/sample-copies`).send(p);
      expect(res.status).to.equal(400);
    });

    it('rejects missing promptTrigger (400)', async () => {
      const p = minimalSampleCopy();
      delete p.promptTrigger;
      const res = await authed().post(`/api/projects/${fix.projectId}/sample-copies`).send(p);
      expect(res.status).to.equal(400);
    });

    it('rejects empty content (400)', async () => {
      const res = await authed().post(`/api/projects/${fix.projectId}/sample-copies`).send({
        ...minimalSampleCopy(),
        content: [],
      });
      expect(res.status).to.equal(400);
    });
  });

  describe('get by id', () => {
    it('returns copy by ID', async () => {
      const cr = await authed().post(`/api/projects/${fix.projectId}/sample-copies`).send(minimalSampleCopy());
      const res = await authed().get(`/api/projects/${fix.projectId}/sample-copies/${cr.body.id}`);
      expect(res.status).to.equal(200);
      expect(res.body.id).to.equal(cr.body.id);
    });

    it('returns 404 for non-existent', async () => {
      const res = await authed().get(`/api/projects/${fix.projectId}/sample-copies/nonexistent`);
      expect(res.status).to.equal(404);
    });
  });

  describe('update', () => {
    it('updates name', async () => {
      const cr = await authed().post(`/api/projects/${fix.projectId}/sample-copies`).send(minimalSampleCopy());
      const res = await authed().put(`/api/projects/${fix.projectId}/sample-copies/${cr.body.id}`).send({ name: 'Updated', version: cr.body.version });
      expect(res.status).to.equal(200);
      expect(res.body.name).to.equal('Updated');
      expect(res.body.version).to.equal(cr.body.version + 1);
    });

    it('rejects stale version (409)', async () => {
      const cr = await authed().post(`/api/projects/${fix.projectId}/sample-copies`).send(minimalSampleCopy());
      await authed().put(`/api/projects/${fix.projectId}/sample-copies/${cr.body.id}`).send({ name: 'First', version: cr.body.version });
      const res = await authed().put(`/api/projects/${fix.projectId}/sample-copies/${cr.body.id}`).send({ name: 'Second', version: cr.body.version });
      expect(res.status).to.be.oneOf([400, 409]);
    });

    it('rejects missing version (400)', async () => {
      const cr = await authed().post(`/api/projects/${fix.projectId}/sample-copies`).send(minimalSampleCopy());
      const res = await authed().put(`/api/projects/${fix.projectId}/sample-copies/${cr.body.id}`).send({ name: 'Updated' });
      expect(res.status).to.equal(400);
    });

    it('returns 404 for non-existent', async () => {
      const res = await authed().put(`/api/projects/${fix.projectId}/sample-copies/nonexistent`).send({ name: 'X', version: 1 });
      expect(res.status).to.equal(404);
    });
  });

  describe('delete', () => {
    it('deletes a sample copy', async () => {
      const cr = await authed().post(`/api/projects/${fix.projectId}/sample-copies`).send(minimalSampleCopy());
      const res = await authed().delete(`/api/projects/${fix.projectId}/sample-copies/${cr.body.id}`).send({ version: cr.body.version });
      expect(res.status).to.be.oneOf([200, 204]);
      const getRes = await authed().get(`/api/projects/${fix.projectId}/sample-copies/${cr.body.id}`);
      expect(getRes.status).to.equal(404);
    });

    it('returns 404 for non-existent', async () => {
      const res = await authed().delete(`/api/projects/${fix.projectId}/sample-copies/nonexistent`).send({ version: 1 });
      expect(res.status).to.equal(404);
    });
  });

  describe('clone', () => {
    it('clones with auto-generated name', async () => {
      const cr = await authed().post(`/api/projects/${fix.projectId}/sample-copies`).send({ ...minimalSampleCopy(), name: 'Original' });
      const res = await authed().post(`/api/projects/${fix.projectId}/sample-copies/${cr.body.id}/clone`).send({});
      expect(res.status).to.equal(201);
      expect(res.body.id).to.not.equal(cr.body.id);
      expect(res.body.name).to.equal('Original (Clone)');
    });

    it('clones with custom name', async () => {
      const cr = await authed().post(`/api/projects/${fix.projectId}/sample-copies`).send({ ...minimalSampleCopy(), name: 'Original' });
      const res = await authed().post(`/api/projects/${fix.projectId}/sample-copies/${cr.body.id}/clone`).send({ name: 'Custom' });
      expect(res.status).to.equal(201);
      expect(res.body.name).to.equal('Custom');
    });

    it('returns 404 for non-existent', async () => {
      const res = await authed().post(`/api/projects/${fix.projectId}/sample-copies/nonexistent/clone`).send({});
      expect(res.status).to.equal(404);
    });
  });

  describe('audit logs', () => {
    it('returns audit logs after creation', async () => {
      const cr = await authed().post(`/api/projects/${fix.projectId}/sample-copies`).send(minimalSampleCopy());
      const res = await authed().get(`/api/projects/${fix.projectId}/sample-copies/${cr.body.id}/audit-logs`);
      expect(res.status).to.equal(200);
      expect(res.body).to.be.an('array');
      expect(res.body.length).to.be.greaterThanOrEqual(1);
    });
  });

  describe('pagination and filtering', () => {
    it('respects offset/limit', async () => {
      for (let i = 0; i < 3; i++) {
        await authed().post(`/api/projects/${fix.projectId}/sample-copies`).send({ ...minimalSampleCopy(), name: `SC${i}` });
      }
      const res = await authed().get(`/api/projects/${fix.projectId}/sample-copies?offset=1&limit=1`);
      expect(res.body.items).to.have.length(1);
      expect(res.body.total).to.equal(3);
    });

    it('searches by name', async () => {
      await authed().post(`/api/projects/${fix.projectId}/sample-copies`).send({ ...minimalSampleCopy(), name: 'Alpha' });
      await authed().post(`/api/projects/${fix.projectId}/sample-copies`).send({ ...minimalSampleCopy(), name: 'Beta' });
      const res = await authed().get(`/api/projects/${fix.projectId}/sample-copies?textSearch=alpha`);
      expect(res.body.items).to.have.length(1);
    });
  });
});
