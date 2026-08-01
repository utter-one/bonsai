import { describe, it, beforeEach } from 'mocha';
import { expect } from 'chai';
import { authed, resetDatabase } from '../utils';
import { createProjectWithAgent } from '../fixtures';

interface Fixture { projectId: string; agentId: string; }

describe('Migration API', () => {
  let fix: Fixture;

  beforeEach(async () => {
    await resetDatabase();
    fix = await createProjectWithAgent();
  });

  describe('preview', () => {
    it('returns preview with all entity types', async () => {
      const res = await authed().get('/api/migration/preview');
      expect(res.status).to.equal(200);
      expect(res.body).to.have.property('totalCount');
      expect(res.body).to.have.property('providers');
      expect(res.body).to.have.property('projects');
      expect(res.body).to.have.property('agents');
      expect(res.body).to.have.property('stages');
      expect(res.body.projects).to.be.an('array');
      expect(res.body.agents).to.be.an('array');
    });

    it('preview includes created project', async () => {
      const res = await authed().get('/api/migration/preview');
      expect(res.status).to.equal(200);
      expect(res.body.projects).to.have.length(1);
      expect(res.body.projects[0].id).to.equal(fix.projectId);
    });

    it('preview with projectIds filter', async () => {
      const res = await authed().get(`/api/migration/preview?projectIds=${fix.projectId}`);
      expect(res.status).to.equal(200);
      expect(res.body.projects).to.have.length(1);
      expect(res.body.projects[0].id).to.equal(fix.projectId);
    });

    it('preview with non-existent projectId returns empty', async () => {
      const res = await authed().get('/api/migration/preview?projectIds=nonexistent');
      expect(res.status).to.equal(200);
      expect(res.body.projects).to.have.length(0);
    });
  });

  describe('export', () => {
    it('returns export bundle', async () => {
      const res = await authed().get('/api/migration/export');
      expect(res.status).to.equal(200);
      expect(res.body).to.have.property('exportedAt');
      expect(res.body).to.have.property('restSchemaHash');
      expect(res.body).to.have.property('providers');
      expect(res.body).to.have.property('projects');
      expect(res.body.projects).to.be.an('array');
    });

    it('export includes project and agents', async () => {
      const res = await authed().get('/api/migration/export');
      expect(res.status).to.equal(200);
      expect(res.body.projects).to.have.length(1);
      expect(res.body.agents).to.have.length(1);
    });

    it('export with projectIds filter', async () => {
      const res = await authed().get(`/api/migration/export?projectIds=${fix.projectId}`);
      expect(res.status).to.equal(200);
      expect(res.body.projects).to.have.length(1);
    });

    it('export with non-existent projectId returns empty projects', async () => {
      const res = await authed().get('/api/migration/export?projectIds=nonexistent');
      expect(res.status).to.equal(200);
      expect(res.body.projects).to.have.length(0);
    });

    it('export includes all entity type arrays', async () => {
      const res = await authed().get('/api/migration/export');
      expect(res.status).to.equal(200);
      expect(res.body).to.have.property('stages').that.is.an('array');
      expect(res.body).to.have.property('classifiers').that.is.an('array');
      expect(res.body).to.have.property('contextTransformers').that.is.an('array');
      expect(res.body).to.have.property('tools').that.is.an('array');
      expect(res.body).to.have.property('globalActions').that.is.an('array');
      expect(res.body).to.have.property('guardrails').that.is.an('array');
    });
  });
});
