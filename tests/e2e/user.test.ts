import { describe, it, beforeEach } from 'mocha';
import { expect } from 'chai';
import { authed, resetDatabase } from '../utils';
import { createProjectWithAgent } from '../fixtures';

interface Fixture { projectId: string; agentId: string; }

function minimalUser() {
  return { profile: { name: 'Test User' } };
}

describe('User API', () => {
  let fix: Fixture;

  beforeEach(async () => {
    await resetDatabase();
    fix = await createProjectWithAgent();
  });

  describe('list', () => {
    it('returns empty list', async () => {
      const res = await authed().get(`/api/projects/${fix.projectId}/users`);
      expect(res.status).to.equal(200);
      expect(res.body.items).to.be.an('array').that.is.empty;
    });

    it('returns users after creation', async () => {
      await authed().post(`/api/projects/${fix.projectId}/users`).send({ profile: { name: 'A' } });
      await authed().post(`/api/projects/${fix.projectId}/users`).send({ profile: { name: 'B' } });
      const res = await authed().get(`/api/projects/${fix.projectId}/users`);
      expect(res.body.items).to.have.length(2);
    });
  });

  describe('create', () => {
    it('creates with minimal fields', async () => {
      const res = await authed().post(`/api/projects/${fix.projectId}/users`).send(minimalUser());
      expect(res.status).to.equal(201);
      expect(res.body.id).to.be.a('string');
    });

    it('creates with full profile', async () => {
      const res = await authed().post(`/api/projects/${fix.projectId}/users`).send({
        profile: { name: 'John', email: 'john@test.com', age: 30 },
      });
      expect(res.status).to.equal(201);
      expect(res.body.profile.name).to.equal('John');
    });

    it('rejects missing profile (400)', async () => {
      const res = await authed().post(`/api/projects/${fix.projectId}/users`).send({});
      expect(res.status).to.equal(400);
    });
  });

  describe('get by id', () => {
    it('returns user by ID', async () => {
      const cr = await authed().post(`/api/projects/${fix.projectId}/users`).send(minimalUser());
      const res = await authed().get(`/api/projects/${fix.projectId}/users/${cr.body.id}`);
      expect(res.status).to.equal(200);
      expect(res.body.id).to.equal(cr.body.id);
    });

    it('returns 404 for non-existent', async () => {
      const res = await authed().get(`/api/projects/${fix.projectId}/users/nonexistent`);
      expect(res.status).to.equal(404);
    });
  });

  describe('update', () => {
    it('updates profile (merge)', async () => {
      const cr = await authed().post(`/api/projects/${fix.projectId}/users`).send({ profile: { name: 'John' } });
      const res = await authed().put(`/api/projects/${fix.projectId}/users/${cr.body.id}`).send({
        profile: { email: 'john@test.com' },
      });
      expect(res.status).to.equal(200);
    });

    it('updates banned status', async () => {
      const cr = await authed().post(`/api/projects/${fix.projectId}/users`).send(minimalUser());
      const res = await authed().put(`/api/projects/${fix.projectId}/users/${cr.body.id}`).send({
        banned: true,
        banReason: 'spam',
      });
      expect(res.status).to.equal(200);
      expect(res.body.banned).to.equal(true);
      expect(res.body.banReason).to.equal('spam');
    });

    it('returns 404 for non-existent', async () => {
      const res = await authed().put(`/api/projects/${fix.projectId}/users/nonexistent`).send({ profile: {} });
      expect(res.status).to.equal(404);
    });
  });

  describe('delete', () => {
    it('deletes a user', async () => {
      const cr = await authed().post(`/api/projects/${fix.projectId}/users`).send(minimalUser());
      const res = await authed().delete(`/api/projects/${fix.projectId}/users/${cr.body.id}`);
      expect(res.status).to.be.oneOf([200, 204]);
      const getRes = await authed().get(`/api/projects/${fix.projectId}/users/${cr.body.id}`);
      expect(getRes.status).to.equal(404);
    });

    it('returns 404 for non-existent', async () => {
      const res = await authed().delete(`/api/projects/${fix.projectId}/users/nonexistent`);
      expect(res.status).to.equal(404);
    });
  });

  describe('audit logs', () => {
    it('returns audit logs after creation', async () => {
      const cr = await authed().post(`/api/projects/${fix.projectId}/users`).send(minimalUser());
      const res = await authed().get(`/api/projects/${fix.projectId}/users/${cr.body.id}/audit-logs`);
      expect(res.status).to.equal(200);
      expect(res.body).to.be.an('array');
      expect(res.body.length).to.be.greaterThanOrEqual(1);
    });
  });

  describe('pagination and filtering', () => {
    it('respects offset/limit', async () => {
      for (let i = 0; i < 3; i++) {
        await authed().post(`/api/projects/${fix.projectId}/users`).send({ profile: { name: `U${i}` } });
      }
      const res = await authed().get(`/api/projects/${fix.projectId}/users?offset=1&limit=1`);
      expect(res.body.items).to.have.length(1);
      expect(res.body.total).to.equal(3);
    });
  });
});
