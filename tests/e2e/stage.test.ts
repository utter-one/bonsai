import { describe, it, beforeEach } from 'mocha';
import { expect } from 'chai';
import { authed, resetDatabase } from '../utils';

// ── Fixtures ──────────────────────────────────────────────────────────
const MINIMAL_PROJECT = {
  name: 'Test Project',
  acceptVoice: false,
  generateVoice: false,
  sampleCopyConfig: {},
  recordingConfig: { enabled: false },
};

const MINIMAL_AGENT = {
  name: 'Test Agent',
  prompt: 'You are a helpful assistant.',
};

/** Create a project + agent pair so stages have valid references */
async function createProjectWithAgent() {
  const projectRes = await authed().post('/api/projects').send(MINIMAL_PROJECT);
  const agentRes = await authed()
    .post(`/api/projects/${projectRes.body.id}/agents`)
    .send(MINIMAL_AGENT);
  return { projectId: projectRes.body.id, agentId: agentRes.body.id };
}

// Minimal valid stage payload (needs project + agent to exist)
function minimalStagePayload(agentId: string) {
  return {
    name: 'Test Stage',
    prompt: 'You are a helpful stage.',
    llmProviderId: 'openai',
    llmSettings: {
      provider: 'openai',
      model: 'gpt-4',
      temperature: 0.7,
    },
    agentId,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────
describe('Stage API', () => {
  let projectId: string;
  let agentId: string;

  beforeEach(async () => {
    await resetDatabase();
    ({ projectId, agentId } = await createProjectWithAgent());
  });

  describe('GET /api/projects/:projectId/stages', () => {
    it('should return empty list when no stages exist', async () => {
      const res = await authed().get(`/api/projects/${projectId}/stages`);
      expect(res.status).to.equal(200);
      expect(res.body.items).to.be.an('array').that.is.empty;
      expect(res.body.total).to.equal(0);
    });

    it('should return stages after creation', async () => {
      await authed().post(`/api/projects/${projectId}/stages`).send({ ...minimalStagePayload(agentId), name: 'Stage A' });
      await authed().post(`/api/projects/${projectId}/stages`).send({ ...minimalStagePayload(agentId), name: 'Stage B' });

      const res = await authed().get(`/api/projects/${projectId}/stages`);
      expect(res.status).to.equal(200);
      expect(res.body.items).to.have.length(2);
      expect(res.body.total).to.equal(2);
    });
  });

  describe('POST /api/projects/:projectId/stages', () => {
    it('should create a stage with minimal fields', async () => {
      const res = await authed().post(`/api/projects/${projectId}/stages`).send(minimalStagePayload(agentId));
      expect(res.status).to.equal(201);
      expect(res.body.id).to.be.a('string');
      expect(res.body.name).to.equal('Test Stage');
      expect(res.body.version).to.equal(1);
      expect(res.body.projectId).to.equal(projectId);
    });

    it('should create a stage with auto-generated ID', async () => {
      const payload = minimalStagePayload(agentId);
      delete payload.id;
      const res = await authed().post(`/api/projects/${projectId}/stages`).send(payload);
      expect(res.status).to.equal(201);
      expect(res.body.id).to.be.a('string');
    });

    it('should create a stage with full configuration', async () => {
      const res = await authed().post(`/api/projects/${projectId}/stages`).send({
        ...minimalStagePayload(agentId),
        name: 'Full Stage',
        description: 'A test stage with full config',
        enterBehavior: 'await_user_input',
        useKnowledge: true,
        knowledgeTags: ['greeting'],
        useGlobalActions: false,
        tags: ['test', 'primary'],
        metadata: { env: 'test' },
      });
      expect(res.status).to.equal(201);
      expect(res.body.name).to.equal('Full Stage');
      expect(res.body.description).to.equal('A test stage with full config');
      expect(res.body.enterBehavior).to.equal('await_user_input');
      expect(res.body.useKnowledge).to.equal(true);
      expect(res.body.tags).to.deep.equal(['test', 'primary']);
    });

    it('should reject with 400 when name is missing', async () => {
      const payload = minimalStagePayload(agentId);
      delete payload.name;
      const res = await authed().post(`/api/projects/${projectId}/stages`).send(payload);
      expect(res.status).to.equal(400);
    });

    it('should reject with 400 when prompt is missing', async () => {
      const payload = minimalStagePayload(agentId);
      delete payload.prompt;
      const res = await authed().post(`/api/projects/${projectId}/stages`).send(payload);
      expect(res.status).to.equal(400);
    });

    it('should reject with 404 for non-existent agentId', async () => {
      const res = await authed().post(`/api/projects/${projectId}/stages`).send({
        ...minimalStagePayload(agentId),
        agentId: 'nonexistent-agent',
      });
      expect(res.status).to.equal(404);
    });
  });

  describe('GET /api/projects/:projectId/stages/:id', () => {
    it('should return a stage by ID', async () => {
      const createRes = await authed()
        .post(`/api/projects/${projectId}/stages`)
        .send({ ...minimalStagePayload(agentId), name: 'Lookup Stage' });
      const stageId = createRes.body.id;

      const res = await authed().get(`/api/projects/${projectId}/stages/${stageId}`);
      expect(res.status).to.equal(200);
      expect(res.body.id).to.equal(stageId);
      expect(res.body.name).to.equal('Lookup Stage');
    });

    it('should return 404 for non-existent stage', async () => {
      const res = await authed().get(`/api/projects/${projectId}/stages/nonexistent-id`);
      expect(res.status).to.equal(404);
    });
  });

  describe('PUT /api/projects/:projectId/stages/:id', () => {
    it('should update stage name', async () => {
      const createRes = await authed()
        .post(`/api/projects/${projectId}/stages`)
        .send(minimalStagePayload(agentId));
      const { id, version } = createRes.body;

      const res = await authed().put(`/api/projects/${projectId}/stages/${id}`).send({ name: 'Updated Stage', version });
      expect(res.status).to.equal(200);
      expect(res.body.name).to.equal('Updated Stage');
      expect(res.body.version).to.equal(version + 1);
    });

    it('should update stage prompt', async () => {
      const createRes = await authed()
        .post(`/api/projects/${projectId}/stages`)
        .send(minimalStagePayload(agentId));
      const { id, version } = createRes.body;

      const res = await authed().put(`/api/projects/${projectId}/stages/${id}`).send({ prompt: 'New system prompt', version });
      expect(res.status).to.equal(200);
      expect(res.body.prompt).to.equal('New system prompt');
    });

    it('should reject with stale version (optimistic lock)', async () => {
      const createRes = await authed()
        .post(`/api/projects/${projectId}/stages`)
        .send(minimalStagePayload(agentId));
      const { id, version } = createRes.body;

      // First update succeeds
      await authed().put(`/api/projects/${projectId}/stages/${id}`).send({ name: 'First Update', version });

      // Second update with old version should fail
      const res = await authed().put(`/api/projects/${projectId}/stages/${id}`).send({ name: 'Second Update', version });
      expect(res.status).to.be.oneOf([400, 409]);
    });

    it('should reject without version field', async () => {
      const createRes = await authed()
        .post(`/api/projects/${projectId}/stages`)
        .send(minimalStagePayload(agentId));

      const res = await authed().put(`/api/projects/${projectId}/stages/${createRes.body.id}`).send({ name: 'Updated' });
      expect(res.status).to.equal(400);
    });

    it('should return 404 for non-existent stage', async () => {
      const res = await authed().put(`/api/projects/${projectId}/stages/nonexistent-id`).send({ name: 'Updated', version: 1 });
      expect(res.status).to.equal(404);
    });
  });

  describe('DELETE /api/projects/:projectId/stages/:id', () => {
    it('should delete a stage', async () => {
      const createRes = await authed()
        .post(`/api/projects/${projectId}/stages`)
        .send(minimalStagePayload(agentId));
      const { id, version } = createRes.body;

      const res = await authed().delete(`/api/projects/${projectId}/stages/${id}`).send({ version });
      expect(res.status).to.be.oneOf([200, 204]);

      // Verify it's gone
      const getRes = await authed().get(`/api/projects/${projectId}/stages/${id}`);
      expect(getRes.status).to.equal(404);
    });

    it('should return 404 when deleting non-existent stage', async () => {
      const res = await authed().delete(`/api/projects/${projectId}/stages/nonexistent-id`).send({ version: 1 });
      expect(res.status).to.equal(404);
    });

    it('should reject delete with stale version', async () => {
      const createRes = await authed()
        .post(`/api/projects/${projectId}/stages`)
        .send(minimalStagePayload(agentId));
      const { id } = createRes.body;

      // Bump version first
      await authed().put(`/api/projects/${projectId}/stages/${id}`).send({ name: 'Bump', version: 1 });

      // Delete with old version should fail
      const res = await authed().delete(`/api/projects/${projectId}/stages/${id}`).send({ version: 1 });
      expect(res.status).to.be.oneOf([400, 409]);
    });
  });

  describe('POST /api/projects/:projectId/stages/:id/clone', () => {
    it('should clone a stage with auto-generated name', async () => {
      const createRes = await authed()
        .post(`/api/projects/${projectId}/stages`)
        .send({ ...minimalStagePayload(agentId), name: 'Original Stage' });
      const stageId = createRes.body.id;

      const res = await authed().post(`/api/projects/${projectId}/stages/${stageId}/clone`).send({});
      expect(res.status).to.equal(201);
      expect(res.body.id).to.not.equal(stageId);
      expect(res.body.name).to.equal('Original Stage (Clone)');
      expect(res.body.version).to.equal(1);
    });

    it('should clone a stage with custom name', async () => {
      const createRes = await authed()
        .post(`/api/projects/${projectId}/stages`)
        .send({ ...minimalStagePayload(agentId), name: 'Original Stage' });
      const stageId = createRes.body.id;

      const res = await authed().post(`/api/projects/${projectId}/stages/${stageId}/clone`).send({ name: 'Custom Clone' });
      expect(res.status).to.equal(201);
      expect(res.body.name).to.equal('Custom Clone');
      expect(res.body.prompt).to.equal('You are a helpful stage.');
    });

    it('should return 404 when cloning non-existent stage', async () => {
      const res = await authed().post(`/api/projects/${projectId}/stages/nonexistent-id/clone`).send({});
      expect(res.status).to.equal(404);
    });
  });

  describe('GET /api/projects/:projectId/stages/:id/audit-logs', () => {
    it('should return audit logs for a stage', async () => {
      const createRes = await authed()
        .post(`/api/projects/${projectId}/stages`)
        .send(minimalStagePayload(agentId));
      const stageId = createRes.body.id;

      const res = await authed().get(`/api/projects/${projectId}/stages/${stageId}/audit-logs`);
      expect(res.status).to.equal(200);
      expect(res.body).to.be.an('array');
      // Should have at least the creation log
      expect(res.body.length).to.be.greaterThanOrEqual(1);
    });

    it('should return audit logs with entries after update', async () => {
      const createRes = await authed()
        .post(`/api/projects/${projectId}/stages`)
        .send(minimalStagePayload(agentId));
      const { id } = createRes.body;

      // Perform an update to generate another audit entry
      await authed().put(`/api/projects/${projectId}/stages/${id}`).send({ name: 'Updated', version: 1 });

      const res = await authed().get(`/api/projects/${projectId}/stages/${id}/audit-logs`);
      expect(res.status).to.equal(200);
      expect(res.body.length).to.be.greaterThanOrEqual(2);
    });
  });

  describe('pagination and filtering', () => {
    it('should respect pagination offset and limit', async () => {
      // Create 3 stages
      for (let i = 0; i < 3; i++) {
        await authed().post(`/api/projects/${projectId}/stages`).send({ ...minimalStagePayload(agentId), name: `Stage ${i}` });
      }

      const res = await authed().get(`/api/projects/${projectId}/stages?offset=1&limit=1`);
      expect(res.status).to.equal(200);
      expect(res.body.items).to.have.length(1);
      expect(res.body.total).to.equal(3);
      expect(res.body.offset).to.equal(1);
      expect(res.body.limit).to.equal(1);
    });

    it('should filter by tags', async () => {
      await authed().post(`/api/projects/${projectId}/stages`).send({ ...minimalStagePayload(agentId), name: 'Tagged Stage', tags: ['important'] });
      await authed().post(`/api/projects/${projectId}/stages`).send({ ...minimalStagePayload(agentId), name: 'Untagged Stage' });

      const res = await authed().get(`/api/projects/${projectId}/stages?filters[tags]=important`);
      expect(res.status).to.equal(200);
      expect(res.body.items).to.have.length(1);
      expect(res.body.items[0].name).to.equal('Tagged Stage');
    });

    it('should search by name text', async () => {
      await authed().post(`/api/projects/${projectId}/stages`).send({ ...minimalStagePayload(agentId), name: 'Alpha Stage' });
      await authed().post(`/api/projects/${projectId}/stages`).send({ ...minimalStagePayload(agentId), name: 'Beta Stage' });

      const res = await authed().get(`/api/projects/${projectId}/stages?textSearch=alpha`);
      expect(res.status).to.equal(200);
      expect(res.body.items).to.have.length(1);
      expect(res.body.items[0].name).to.equal('Alpha Stage');
    });
  });
});
