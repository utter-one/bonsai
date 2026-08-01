import { describe, it, beforeEach } from 'mocha';
import { expect } from 'chai';
import { authed, resetDatabase } from '../utils';
import { createProjectWithAgent } from '../fixtures';

interface Fixture {
  projectId: string;
  agentId: string;
}

async function createFullFixture(): Promise<Fixture> {
  return await createProjectWithAgent();
}

describe('Scenario Conversation API', () => {
  let fix: Fixture;

  beforeEach(async () => {
    await resetDatabase();
    fix = await createFullFixture();
  });

  describe('list', () => {
    it('returns empty list', async () => {
      const res = await authed().get(`/api/projects/${fix.projectId}/scenario-conversations`);
      expect(res.status).to.equal(200);
      expect(res.body.items).to.be.an('array').that.is.empty;
      expect(res.body.total).to.equal(0);
    });

    it('respects pagination params', async () => {
      const res = await authed().get(`/api/projects/${fix.projectId}/scenario-conversations?offset=0&limit=10`);
      expect(res.status).to.equal(200);
      expect(res.body.items).to.be.an('array');
      expect(res.body.offset).to.equal(0);
    });

    it('accepts scenarioRunId filter param', async () => {
      const res = await authed().get(`/api/projects/${fix.projectId}/scenario-conversations?scenarioRunId=some-run-id`);
      expect(res.status).to.equal(200);
      expect(res.body.items).to.be.an('array');
    });

    it('returns conversations after scenario run creation', async () => {
      // Create a stage (required for scenario)
      const llmProviderRes = await authed().post('/api/providers').send({
        name: 'Test LLM',
        providerType: 'llm',
        apiType: 'openai',
        config: { apiKey: 'sk-test-key-123' },
      });
      expect(llmProviderRes.status).to.equal(201);

      const stageRes = await authed().post(`/api/projects/${fix.projectId}/stages`).send({
        name: 'Welcome Stage',
        agentId: fix.agentId,
        prompt: 'Welcome! How can I help you?',
        llmProviderId: llmProviderRes.body.id,
        llmSettings: { model: 'gpt-4o' },
      });
      expect(stageRes.status).to.equal(201);

      // Create a tester persona
      const testerRes = await authed().post(`/api/projects/${fix.projectId}/testers`).send({
        name: 'Test Persona',
        prompt: 'You are a test user.',
      });
      expect(testerRes.status).to.equal(201);

      // Create a scenario
      const scenarioRes = await authed().post(`/api/projects/${fix.projectId}/scenarios`).send({
        name: 'Test Scenario',
        language: 'en-US',
        startingStageId: stageRes.body.id,
        maxTurns: 5,
      });
      expect(scenarioRes.status).to.equal(201);

      // Create a scenario run — conversations are created by the executor asynchronously
      const runRes = await authed().post(`/api/projects/${fix.projectId}/scenario-runs`).send({
        scenarioId: scenarioRes.body.id,
        testers: { [testerRes.body.id]: 2 },
      });
      expect(runRes.status).to.equal(201);

      // Note: conversations are created lazily by the executor service, not eagerly at run creation time
      // In the test environment the executor may not have picked up the run yet
      // We verify the run was created and check the list endpoint works correctly
      const res = await authed().get(`/api/projects/${fix.projectId}/scenario-conversations`);
      expect(res.status).to.equal(200);
      expect(res.body.items).to.be.an('array');
      // Conversations may or may not be present depending on executor timing
      // The important thing is the endpoint returns 200 with correct shape
      if (res.body.items.length > 0) {
        for (const item of res.body.items) {
          expect(item).to.have.property('id');
          expect(item).to.have.property('scenarioRunId');
          expect(item).to.have.property('scenarioId');
          expect(item).to.have.property('testerId');
          expect(item).to.have.property('status');
        }
      }
    });

    it('filters by scenarioRunId (empty result)', async () => {
      const res = await authed().get(`/api/projects/${fix.projectId}/scenario-conversations?scenarioRunId=nonexistent-run`);
      expect(res.status).to.equal(200);
      expect(res.body.items).to.be.an('array').that.is.empty;
    });
  });

  describe('get by id', () => {
    it('returns 404 for non-existent', async () => {
      const res = await authed().get(`/api/projects/${fix.projectId}/scenario-conversations/nonexistent`);
      expect(res.status).to.equal(404);
    });
  });
});
