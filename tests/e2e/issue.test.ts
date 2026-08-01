import { describe, it, beforeEach } from 'mocha';
import { expect } from 'chai';
import { authed, resetDatabase } from '../utils';
import { createProjectWithAgent } from '../fixtures';

interface Fixture { projectId: string; agentId: string; }

function minimalIssue(projectId: string) {
  return {
    projectId,
    environment: 'production',
    buildVersion: '1.0.0',
    severity: 'high',
    category: 'bug',
    bugDescription: 'Something broke',
    expectedBehaviour: 'Should work correctly',
    status: 'open',
  };
}

describe('Issue API', () => {
  let fix: Fixture;

  beforeEach(async () => {
    await resetDatabase();
    fix = await createProjectWithAgent();
  });

  describe('list', () => {
    it('returns empty list', async () => {
      const res = await authed().get('/api/issues');
      expect(res.status).to.equal(200);
      expect(res.body.items).to.be.an('array').that.is.empty;
      expect(res.body.total).to.equal(0);
    });

    it('returns issues after creation', async () => {
      await authed().post('/api/issues').send({ ...minimalIssue(fix.projectId), bugDescription: 'A' });
      await authed().post('/api/issues').send({ ...minimalIssue(fix.projectId), bugDescription: 'B' });
      const res = await authed().get('/api/issues');
      expect(res.body.items).to.have.length(2);
    });
  });

  describe('create', () => {
    it('creates with minimal fields', async () => {
      const res = await authed().post('/api/issues').send(minimalIssue(fix.projectId));
      expect(res.status).to.equal(201);
      expect(res.body.id).to.be.a('number');
    });

    it('creates with optional fields', async () => {
      const res = await authed().post('/api/issues').send({
        ...minimalIssue(fix.projectId),
        stage: 'stage-1',
        conversationId: 'conv-1',
        eventIndex: 5,
        userId: 'user-1',
        comments: 'extra notes',
      });
      expect(res.status).to.equal(201);
      expect(res.body.stage).to.equal('stage-1');
      expect(res.body.conversationId).to.equal('conv-1');
      expect(res.body.eventIndex).to.equal(5);
    });

    it('rejects missing projectId (400)', async () => {
      const p = minimalIssue(fix.projectId);
      delete p.projectId;
      const res = await authed().post('/api/issues').send(p);
      expect(res.status).to.equal(400);
    });

    it('rejects missing severity (400)', async () => {
      const p = minimalIssue(fix.projectId);
      delete p.severity;
      const res = await authed().post('/api/issues').send(p);
      expect(res.status).to.equal(400);
    });

    it('rejects missing bugDescription (400)', async () => {
      const p = minimalIssue(fix.projectId);
      delete p.bugDescription;
      const res = await authed().post('/api/issues').send(p);
      expect(res.status).to.equal(400);
    });

    it('rejects missing status (400)', async () => {
      const p = minimalIssue(fix.projectId);
      delete p.status;
      const res = await authed().post('/api/issues').send(p);
      expect(res.status).to.equal(400);
    });
  });

  describe('get by id', () => {
    it('returns issue by ID', async () => {
      const cr = await authed().post('/api/issues').send(minimalIssue(fix.projectId));
      const res = await authed().get(`/api/issues/${cr.body.id}`);
      expect(res.status).to.equal(200);
      expect(res.body.id).to.equal(cr.body.id);
    });

    it('returns 404 for non-existent', async () => {
      const res = await authed().get('/api/issues/99999');
      expect(res.status).to.equal(404);
    });
  });

  describe('update', () => {
    it('updates status', async () => {
      const cr = await authed().post('/api/issues').send(minimalIssue(fix.projectId));
      const res = await authed().put(`/api/issues/${cr.body.id}`).send({ status: 'resolved' });
      expect(res.status).to.equal(200);
      expect(res.body.status).to.equal('resolved');
    });

    it('updates severity', async () => {
      const cr = await authed().post('/api/issues').send(minimalIssue(fix.projectId));
      const res = await authed().put(`/api/issues/${cr.body.id}`).send({ severity: 'critical' });
      expect(res.status).to.equal(200);
      expect(res.body.severity).to.equal('critical');
    });

    it('updates multiple fields', async () => {
      const cr = await authed().post('/api/issues').send(minimalIssue(fix.projectId));
      const res = await authed().put(`/api/issues/${cr.body.id}`).send({
        status: 'in-progress',
        severity: 'medium',
        comments: 'investigating',
      });
      expect(res.status).to.equal(200);
      expect(res.body.status).to.equal('in-progress');
      expect(res.body.severity).to.equal('medium');
    });

    it('returns 404 for non-existent', async () => {
      const res = await authed().put('/api/issues/99999').send({ status: 'closed' });
      expect(res.status).to.equal(404);
    });
  });

  describe('delete', () => {
    it('deletes an issue', async () => {
      const cr = await authed().post('/api/issues').send(minimalIssue(fix.projectId));
      const res = await authed().delete(`/api/issues/${cr.body.id}`);
      expect(res.status).to.be.oneOf([200, 204]);
      const getRes = await authed().get(`/api/issues/${cr.body.id}`);
      expect(getRes.status).to.equal(404);
    });

    it('returns 404 for non-existent', async () => {
      const res = await authed().delete('/api/issues/99999');
      expect(res.status).to.equal(404);
    });
  });

  describe('audit logs', () => {
    it('returns audit logs after creation', async () => {
      const cr = await authed().post('/api/issues').send(minimalIssue(fix.projectId));
      const res = await authed().get(`/api/issues/${cr.body.id}/audit-logs`);
      expect(res.status).to.equal(200);
      expect(res.body).to.be.an('array');
      expect(res.body.length).to.be.greaterThanOrEqual(1);
    });
  });

  describe('pagination and filtering', () => {
    it('respects offset/limit', async () => {
      for (let i = 0; i < 3; i++) {
        await authed().post('/api/issues').send({ ...minimalIssue(fix.projectId), bugDescription: `Issue ${i}` });
      }
      const res = await authed().get('/api/issues?offset=1&limit=1');
      expect(res.body.items).to.have.length(1);
      expect(res.body.total).to.equal(3);
    });

    it('filters by status', async () => {
      await authed().post('/api/issues').send({ ...minimalIssue(fix.projectId), status: 'open' });
      await authed().post('/api/issues').send({ ...minimalIssue(fix.projectId), status: 'closed' });
      const res = await authed().get('/api/issues?filters[status]=open');
      expect(res.body.items).to.have.length(1);
    });

    it('searches by text', async () => {
      await authed().post('/api/issues').send({ ...minimalIssue(fix.projectId), bugDescription: 'Alpha failure' });
      await authed().post('/api/issues').send({ ...minimalIssue(fix.projectId), bugDescription: 'Beta failure' });
      const res = await authed().get('/api/issues?textSearch=alpha');
      expect(res.body.items).to.have.length(1);
    });
  });
});
