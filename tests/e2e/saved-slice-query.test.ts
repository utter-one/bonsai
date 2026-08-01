import { describe, it, beforeEach } from 'mocha';
import { expect } from 'chai';
import { authed, resetDatabase } from '../utils';
import { createProjectWithAgent } from '../fixtures';

interface Fixture { projectId: string; agentId: string; }

function minimalSliceQuery() {
  return {
    name: 'Test Query',
    query: {
      source: 'conversations',
      metrics: ['count'],
    },
  };
}

describe('Saved Slice Query API', () => {
  let fix: Fixture;

  beforeEach(async () => {
    await resetDatabase();
    fix = await createProjectWithAgent();
  });

  describe('list', () => {
    it('returns empty list', async () => {
      const res = await authed().get(`/api/projects/${fix.projectId}/analytics/saved-queries`);
      expect(res.status).to.equal(200);
      expect(res.body).to.be.an('array').that.is.empty;
    });

    it('returns queries after creation', async () => {
      await authed().post(`/api/projects/${fix.projectId}/analytics/saved-queries`).send({ ...minimalSliceQuery(), name: 'A' });
      const res = await authed().get(`/api/projects/${fix.projectId}/analytics/saved-queries`);
      expect(res.body).to.have.length(1);
    });
  });

  describe('create', () => {
    it('creates with minimal fields', async () => {
      const res = await authed().post(`/api/projects/${fix.projectId}/analytics/saved-queries`).send(minimalSliceQuery());
      expect(res.status).to.equal(201);
      expect(res.body.id).to.be.a('string');
      expect(res.body.version).to.equal(1);
    });

    it('rejects missing name (400)', async () => {
      const p = minimalSliceQuery();
      delete p.name;
      const res = await authed().post(`/api/projects/${fix.projectId}/analytics/saved-queries`).send(p);
      expect(res.status).to.equal(400);
    });

    it('rejects missing query (400)', async () => {
      const p = minimalSliceQuery();
      delete p.query;
      const res = await authed().post(`/api/projects/${fix.projectId}/analytics/saved-queries`).send(p);
      expect(res.status).to.equal(400);
    });

    it('creates with isShared flag', async () => {
      const res = await authed().post(`/api/projects/${fix.projectId}/analytics/saved-queries`).send({
        ...minimalSliceQuery(),
        isShared: true,
      });
      expect(res.status).to.equal(201);
      expect(res.body.isShared).to.equal(true);
    });

    it('rejects duplicate name', async () => {
      await authed().post(`/api/projects/${fix.projectId}/analytics/saved-queries`).send(minimalSliceQuery());
      const res = await authed().post(`/api/projects/${fix.projectId}/analytics/saved-queries`).send(minimalSliceQuery());
      expect(res.status).to.be.oneOf([400, 409, 500]);
    });
  });



  describe('update', () => {
    it('updates name', async () => {
      const cr = await authed().post(`/api/projects/${fix.projectId}/analytics/saved-queries`).send(minimalSliceQuery());
      const res = await authed().put(`/api/projects/${fix.projectId}/analytics/saved-queries/${cr.body.id}`).send({ name: 'Updated', version: cr.body.version });
      expect(res.status).to.equal(200);
      expect(res.body.name).to.equal('Updated');
      expect(res.body.version).to.equal(cr.body.version + 1);
    });

    it('rejects stale version (409)', async () => {
      const cr = await authed().post(`/api/projects/${fix.projectId}/analytics/saved-queries`).send(minimalSliceQuery());
      await authed().put(`/api/projects/${fix.projectId}/analytics/saved-queries/${cr.body.id}`).send({ name: 'First', version: cr.body.version });
      const res = await authed().put(`/api/projects/${fix.projectId}/analytics/saved-queries/${cr.body.id}`).send({ name: 'Second', version: cr.body.version });
      expect(res.status).to.be.oneOf([400, 409]);
    });

    it('rejects missing version (400)', async () => {
      const cr = await authed().post(`/api/projects/${fix.projectId}/analytics/saved-queries`).send(minimalSliceQuery());
      const res = await authed().put(`/api/projects/${fix.projectId}/analytics/saved-queries/${cr.body.id}`).send({ name: 'Updated' });
      expect(res.status).to.equal(400);
    });

    it('returns 404 for non-existent', async () => {
      const res = await authed().put(`/api/projects/${fix.projectId}/analytics/saved-queries/nonexistent`).send({ name: 'X', version: 1 });
      expect(res.status).to.equal(404);
    });
  });

  describe('delete', () => {
    it('deletes a query', async () => {
      const cr = await authed().post(`/api/projects/${fix.projectId}/analytics/saved-queries`).send(minimalSliceQuery());
      const res = await authed().delete(`/api/projects/${fix.projectId}/analytics/saved-queries/${cr.body.id}`).send({ version: cr.body.version });
      expect(res.status).to.be.oneOf([200, 204]);
      const getRes = await authed().get(`/api/projects/${fix.projectId}/analytics/saved-queries/${cr.body.id}`);
      expect(getRes.status).to.equal(404);
    });

    it('returns 404 for non-existent', async () => {
      const res = await authed().delete(`/api/projects/${fix.projectId}/analytics/saved-queries/nonexistent`).send({ version: 1 });
      expect(res.status).to.equal(404);
    });
  });
});
