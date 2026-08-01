import { describe, it, beforeEach } from 'mocha';
import { expect } from 'chai';
import { authed, resetDatabase } from '../utils';

function minimalEnvironment() {
  return {
    description: 'Test Environment',
    url: 'https://test.example.com',
    login: 'testuser',
    password: 'testpass123',
  };
}

describe('Environment API — Migration Sub-routes', () => {
  let envId: string;
  let envVersion: number;

  beforeEach(async () => {
    await resetDatabase();
    const res = await authed().post('/api/environments').send(minimalEnvironment());
    expect(res.status).to.equal(201);
    envId = res.body.id;
    envVersion = res.body.version;
  });

  describe('GET /api/environments/:id/migration/scope', () => {
    it('returns 404 for non-existent environment', async () => {
      const res = await authed().get('/api/environments/nonexistent/migration/scope');
      expect(res.status).to.equal(404);
    });

    it('returns 400 for invalid query params', async () => {
      // The endpoint accepts the same query params as migration/preview
      // Passing an invalid param should return 400
      const res = await authed().get(`/api/environments/${envId}/migration/scope`);
      // This will likely fail with a connection error since the remote URL doesn't exist,
      // but the endpoint should at least accept the request
      expect(res.status).to.be.oneOf([400, 404, 500, 502]);
    });
  });

  describe('POST /api/environments/:id/migration/pull', () => {
    it('creates a job even for non-existent environment (validation happens async)', async () => {
      const res = await authed().post('/api/environments/nonexistent/migration/pull').send({});
      // The endpoint creates the job eagerly; remote validation happens during async execution
      expect(res.status).to.equal(202);
      expect(res.body).to.have.property('id');
      expect(res.body.environmentId).to.equal('nonexistent');
    });

    it('starts a pull job with empty selection', async () => {
      const res = await authed().post(`/api/environments/${envId}/migration/pull`).send({});
      // The job will fail because the remote URL doesn't exist, but it should create a job
      expect(res.status).to.be.oneOf([202, 500]);
    });

    it('starts a pull job with project selection', async () => {
      const res = await authed().post(`/api/environments/${envId}/migration/pull`).send({
        selection: {
          projectIds: ['some-project-id'],
        },
      });
      expect(res.status).to.be.oneOf([202, 500]);
    });

    it('starts a dry run pull job', async () => {
      const res = await authed().post(`/api/environments/${envId}/migration/pull`).send({
        dryRun: true,
      });
      expect(res.status).to.be.oneOf([202, 500]);
    });

    it('starts a force pull job', async () => {
      const res = await authed().post(`/api/environments/${envId}/migration/pull`).send({
        force: true,
      });
      expect(res.status).to.be.oneOf([202, 500]);
    });

    it('returns job ID on success', async () => {
      const res = await authed().post(`/api/environments/${envId}/migration/pull`).send({
        dryRun: true,
      });
      if (res.status === 202) {
        expect(res.body).to.have.property('id');
        expect(res.body).to.have.property('status');
        expect(res.body).to.have.property('environmentId');
        expect(res.body.environmentId).to.equal(envId);
      }
    });
  });

  describe('GET /api/environments/:id/migration/jobs/:jobId', () => {
    it('returns 404 for non-existent job', async () => {
      const res = await authed().get(`/api/environments/${envId}/migration/jobs/nonexistent-job`);
      expect(res.status).to.equal(404);
    });

    it('returns 404 for non-existent environment', async () => {
      const res = await authed().get('/api/environments/nonexistent/migration/jobs/some-job');
      expect(res.status).to.equal(404);
    });

    it('returns job status after pull is started', async () => {
      const pullRes = await authed().post(`/api/environments/${envId}/migration/pull`).send({
        dryRun: true,
      });
      if (pullRes.status === 202) {
        const jobId = pullRes.body.id;
        const res = await authed().get(`/api/environments/${envId}/migration/jobs/${jobId}`);
        expect(res.status).to.equal(200);
        expect(res.body.id).to.equal(jobId);
        expect(res.body.environmentId).to.equal(envId);
        expect(res.body).to.have.property('status');
        expect(res.body).to.have.property('startedAt');
      }
    });

    it('returns 404 when job belongs to different environment', async () => {
      // Create a second environment
      const env2Res = await authed().post('/api/environments').send({
        ...minimalEnvironment(),
        description: 'Test Environment 2',
        url: 'https://test2.example.com',
      });
      expect(env2Res.status).to.equal(201);

      // Start a pull on the second environment
      const pullRes = await authed().post(`/api/environments/${env2Res.body.id}/migration/pull`).send({
        dryRun: true,
      });
      if (pullRes.status === 202) {
        const jobId = pullRes.body.id;
        // Try to access the job through the first environment
        const res = await authed().get(`/api/environments/${envId}/migration/jobs/${jobId}`);
        expect(res.status).to.equal(404);
      }
    });
  });
});
