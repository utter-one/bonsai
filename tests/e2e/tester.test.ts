import { describe, it, beforeEach } from 'mocha';
import { expect } from 'chai';
import { authed, resetDatabase } from '../utils';
import { createProjectWithAgent } from '../fixtures';

interface Fixture { projectId: string; agentId: string; }

function minimalTester() {
  return {
    name: 'Test Persona',
    prompt: 'You are a test persona.',
  };
}

describe('Tester API', () => {
  let fix: Fixture;

  beforeEach(async () => {
    await resetDatabase();
    fix = await createProjectWithAgent();
  });

  describe('list', () => {
    it('returns empty list', async () => {
      const res = await authed().get(`/api/projects/${fix.projectId}/testers`);
      expect(res.status).to.equal(200);
      expect(res.body.items).to.be.an('array').that.is.empty;
    });

    it('returns testers after creation', async () => {
      await authed().post(`/api/projects/${fix.projectId}/testers`).send({ ...minimalTester(), name: 'A' });
      const res = await authed().get(`/api/projects/${fix.projectId}/testers`);
      expect(res.body.items).to.have.length(1);
    });
  });

  describe('create', () => {
    it('creates with minimal fields', async () => {
      const res = await authed().post(`/api/projects/${fix.projectId}/testers`).send(minimalTester());
      expect(res.status).to.equal(201);
      expect(res.body.id).to.be.a('string');
      expect(res.body.version).to.equal(1);
    });

    it('creates with full config', async () => {
      const res = await authed().post(`/api/projects/${fix.projectId}/testers`).send({
        ...minimalTester(),
        description: 'A detailed tester',
        hangUpPrompt: 'return false;',
        tags: ['primary'],
        metadata: { env: 'test' },
      });
      expect(res.status).to.equal(201);
      expect(res.body.description).to.equal('A detailed tester');
      expect(res.body.hangUpPrompt).to.equal('return false;');
    });

    it('rejects missing name (400)', async () => {
      const p = minimalTester();
      delete p.name;
      const res = await authed().post(`/api/projects/${fix.projectId}/testers`).send(p);
      expect(res.status).to.equal(400);
    });

    it('rejects missing prompt (400)', async () => {
      const p = minimalTester();
      delete p.prompt;
      const res = await authed().post(`/api/projects/${fix.projectId}/testers`).send(p);
      expect(res.status).to.equal(400);
    });
  });

  describe('get by id', () => {
    it('returns tester by ID', async () => {
      const cr = await authed().post(`/api/projects/${fix.projectId}/testers`).send(minimalTester());
      const res = await authed().get(`/api/projects/${fix.projectId}/testers/${cr.body.id}`);
      expect(res.status).to.equal(200);
      expect(res.body.id).to.equal(cr.body.id);
    });

    it('returns 404 for non-existent', async () => {
      const res = await authed().get(`/api/projects/${fix.projectId}/testers/nonexistent`);
      expect(res.status).to.equal(404);
    });
  });

  describe('update', () => {
    it('updates name', async () => {
      const cr = await authed().post(`/api/projects/${fix.projectId}/testers`).send(minimalTester());
      const res = await authed().put(`/api/projects/${fix.projectId}/testers/${cr.body.id}`).send({ name: 'Updated', version: cr.body.version });
      expect(res.status).to.equal(200);
      expect(res.body.name).to.equal('Updated');
      expect(res.body.version).to.equal(cr.body.version + 1);
    });

    it('rejects stale version (409)', async () => {
      const cr = await authed().post(`/api/projects/${fix.projectId}/testers`).send(minimalTester());
      await authed().put(`/api/projects/${fix.projectId}/testers/${cr.body.id}`).send({ name: 'First', version: cr.body.version });
      const res = await authed().put(`/api/projects/${fix.projectId}/testers/${cr.body.id}`).send({ name: 'Second', version: cr.body.version });
      expect(res.status).to.be.oneOf([400, 409]);
    });

    it('rejects missing version (400)', async () => {
      const cr = await authed().post(`/api/projects/${fix.projectId}/testers`).send(minimalTester());
      const res = await authed().put(`/api/projects/${fix.projectId}/testers/${cr.body.id}`).send({ name: 'Updated' });
      expect(res.status).to.equal(400);
    });

    it('returns 404 for non-existent', async () => {
      const res = await authed().put(`/api/projects/${fix.projectId}/testers/nonexistent`).send({ name: 'X', version: 1 });
      expect(res.status).to.equal(404);
    });
  });

  describe('delete', () => {
    it('deletes a tester', async () => {
      const cr = await authed().post(`/api/projects/${fix.projectId}/testers`).send(minimalTester());
      const res = await authed().delete(`/api/projects/${fix.projectId}/testers/${cr.body.id}`).send({ version: cr.body.version });
      expect(res.status).to.be.oneOf([200, 204]);
      const getRes = await authed().get(`/api/projects/${fix.projectId}/testers/${cr.body.id}`);
      expect(getRes.status).to.equal(404);
    });

    it('returns 404 for non-existent', async () => {
      const res = await authed().delete(`/api/projects/${fix.projectId}/testers/nonexistent`).send({ version: 1 });
      expect(res.status).to.equal(404);
    });
  });

  describe('audit logs', () => {
    it('returns audit logs after creation', async () => {
      const cr = await authed().post(`/api/projects/${fix.projectId}/testers`).send(minimalTester());
      const res = await authed().get(`/api/projects/${fix.projectId}/testers/${cr.body.id}/audit-logs`);
      expect(res.status).to.equal(200);
      expect(res.body).to.be.an('array');
      expect(res.body.length).to.be.greaterThanOrEqual(1);
    });
  });

  describe('pagination and filtering', () => {
    it('respects offset/limit', async () => {
      for (let i = 0; i < 3; i++) {
        await authed().post(`/api/projects/${fix.projectId}/testers`).send({ ...minimalTester(), name: `T${i}` });
      }
      const res = await authed().get(`/api/projects/${fix.projectId}/testers?offset=1&limit=1`);
      expect(res.body.items).to.have.length(1);
      expect(res.body.total).to.equal(3);
    });



    it('searches by name', async () => {
      await authed().post(`/api/projects/${fix.projectId}/testers`).send({ ...minimalTester(), name: 'Alpha' });
      await authed().post(`/api/projects/${fix.projectId}/testers`).send({ ...minimalTester(), name: 'Beta' });
      const res = await authed().get(`/api/projects/${fix.projectId}/testers?textSearch=alpha`);
      expect(res.body.items).to.have.length(1);
    });
  });
});
