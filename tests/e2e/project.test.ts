import { describe, it, beforeEach } from 'mocha';
import { expect } from 'chai';
import { authed, resetDatabase } from '../utils';

// Minimal valid project payload (includes all required fields)
const MINIMAL_PROJECT = {
  name: 'Test Project',
  acceptVoice: false, // skip ASR config requirement
  generateVoice: false, // skip TTS config requirement
  sampleCopyConfig: {},
  recordingConfig: { enabled: false },
};

describe('Project API', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  describe('GET /api/projects', () => {
    it('should return empty list when no projects exist', async () => {
      const res = await authed().get('/api/projects');
      expect(res.status).to.equal(200);
      expect(res.body.items).to.be.an('array').that.is.empty;
      expect(res.body.total).to.equal(0);
    });

    it('should return projects after creation', async () => {
      await authed().post('/api/projects').send({ ...MINIMAL_PROJECT, name: 'Project A' });
      await authed().post('/api/projects').send({ ...MINIMAL_PROJECT, name: 'Project B' });

      const res = await authed().get('/api/projects');
      expect(res.status).to.equal(200);
      expect(res.body.items).to.have.length(2);
      expect(res.body.total).to.equal(2);
    });
  });

  describe('POST /api/projects', () => {
    it('should create a project with minimal fields', async () => {
      const res = await authed().post('/api/projects').send(MINIMAL_PROJECT);
      expect(res.status).to.equal(201);
      expect(res.body.id).to.be.a('string');
      expect(res.body.name).to.equal('Test Project');
      expect(res.body.version).to.be.a('number');
    });

    it('should create a project with full configuration', async () => {
      const res = await authed().post('/api/projects').send({
        ...MINIMAL_PROJECT,
        name: 'Full Project',
        description: 'A test project with full config',
        timezone: 'Europe/Warsaw',
        languageCode: 'pl-PL',
        autoCreateUsers: true,
        conversationTimeoutSeconds: 300,
        constants: { greeting: 'Cześć' },
        metadata: { env: 'test' },
      });
      expect(res.status).to.equal(201);
      expect(res.body.name).to.equal('Full Project');
      expect(res.body.description).to.equal('A test project with full config');
      expect(res.body.timezone).to.equal('Europe/Warsaw');
      expect(res.body.languageCode).to.equal('pl-PL');
      expect(res.body.autoCreateUsers).to.equal(true);
      expect(res.body.conversationTimeoutSeconds).to.equal(300);
    });

    it('should reject with 400 when name is missing', async () => {
      const res = await authed().post('/api/projects').send({
        sampleCopyConfig: {},
        recordingConfig: { enabled: false },
      });
      expect(res.status).to.equal(400);
    });

    it('should reject with 400 when name is empty', async () => {
      const res = await authed().post('/api/projects').send({
        ...MINIMAL_PROJECT,
        name: '',
      });
      expect(res.status).to.equal(400);
    });
  });

  describe('GET /api/projects/:id', () => {
    it('should return a project by ID', async () => {
      const createRes = await authed().post('/api/projects').send({ ...MINIMAL_PROJECT, name: 'Lookup Project' });
      const projectId = createRes.body.id;

      const res = await authed().get(`/api/projects/${projectId}`);
      expect(res.status).to.equal(200);
      expect(res.body.id).to.equal(projectId);
      expect(res.body.name).to.equal('Lookup Project');
    });

    it('should return 404 for non-existent project', async () => {
      const res = await authed().get('/api/projects/nonexistent-id');
      expect(res.status).to.equal(404);
    });
  });

  describe('PUT /api/projects/:id', () => {
    it('should update project name', async () => {
      const createRes = await authed().post('/api/projects').send(MINIMAL_PROJECT);
      const { id, version } = createRes.body;

      const res = await authed().put(`/api/projects/${id}`).send({ name: 'Updated Name', version });
      expect(res.status).to.equal(200);
      expect(res.body.name).to.equal('Updated Name');
      expect(res.body.version).to.equal(version + 1);
    });

    it('should reject with stale version (optimistic lock)', async () => {
      const createRes = await authed().post('/api/projects').send({ ...MINIMAL_PROJECT, name: 'Lock Test' });
      const { id, version } = createRes.body;

      // First update succeeds
      await authed().put(`/api/projects/${id}`).send({ name: 'First Update', version });

      // Second update with old version should fail
      const res = await authed().put(`/api/projects/${id}`).send({ name: 'Second Update', version });
      expect(res.status).to.be.oneOf([400, 409]); // implementation may return either
    });

    it('should reject without version field', async () => {
      const createRes = await authed().post('/api/projects').send({ ...MINIMAL_PROJECT, name: 'No Version Test' });

      const res = await authed().put(`/api/projects/${createRes.body.id}`).send({ name: 'Updated' });
      expect(res.status).to.equal(400);
    });
  });

  describe('DELETE /api/projects/:id', () => {
    it('should delete a project', async () => {
      const createRes = await authed().post('/api/projects').send({ ...MINIMAL_PROJECT, name: 'Delete Me' });
      const projectId = createRes.body.id;

      const res = await authed().delete(`/api/projects/${projectId}`);
      expect(res.status).to.be.oneOf([200, 204]);

      // Verify it's gone
      const getRes = await authed().get(`/api/projects/${projectId}`);
      expect(getRes.status).to.equal(404);
    });

    it('should return 404 when deleting non-existent project', async () => {
      const res = await authed().delete('/api/projects/nonexistent-id');
      expect(res.status).to.equal(404);
    });
  });

  describe('POST /api/projects/:id/archive', () => {
    it('should archive a project', async () => {
      const createRes = await authed().post('/api/projects').send({ ...MINIMAL_PROJECT, name: 'Archive Me' });
      const { id, version } = createRes.body;

      const res = await authed().post(`/api/projects/${id}/archive`).send({ version });
      expect(res.status).to.equal(200);
      expect(res.body.archivedAt).to.be.a('string');

      // Should not appear in active list
      const listRes = await authed().get('/api/projects');
      const found = listRes.body.items.find((p: any) => p.id === id);
      expect(found).to.be.undefined;
    });
  });

  describe('POST /api/projects/:id/unarchive', () => {
    it('should unarchive a previously archived project', async () => {
      const createRes = await authed().post('/api/projects').send({ ...MINIMAL_PROJECT, name: 'Unarchive Me' });
      const { id, version } = createRes.body;

      // Archive first
      const archiveRes = await authed().post(`/api/projects/${id}/archive`).send({ version });

      // Unarchive
      const unarchiveRes = await authed().post(`/api/projects/${id}/unarchive`).send({ version: archiveRes.body.version });
      expect(unarchiveRes.status).to.equal(200);
      expect(unarchiveRes.body.archivedAt).to.be.null;

      // Should appear in active list again
      const listRes = await authed().get('/api/projects');
      const found = listRes.body.items.find((p: any) => p.id === id);
      expect(found).to.not.be.undefined;
    });
  });

  describe('archived filter', () => {
    it('should return archived projects when archived=true', async () => {
      // Create and archive a project
      const createRes = await authed().post('/api/projects').send({ ...MINIMAL_PROJECT, name: 'Archived Project' });
      await authed().post(`/api/projects/${createRes.body.id}/archive`).send({ version: createRes.body.version });

      // Create an active project
      await authed().post('/api/projects').send({ ...MINIMAL_PROJECT, name: 'Active Project' });

      const res = await authed().get('/api/projects?archived=true');
      expect(res.status).to.equal(200);
      expect(res.body.items).to.have.length(1);
      expect(res.body.items[0].name).to.equal('Archived Project');
    });
  });
});
