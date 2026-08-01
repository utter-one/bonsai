import { describe, it, beforeEach } from 'mocha';
import { expect } from 'chai';
import { authed, resetDatabase } from '../utils';
import { createProjectWithAgent } from '../fixtures';

interface Fixture {
  projectId: string;
  agentId: string;
  stageId: string;
  scenarioId: string;
  testerId: string;
}

async function createFullFixture(): Promise<Fixture> {
  const { projectId, agentId } = await createProjectWithAgent();

  // Create a stage for the scenario
  const stage = await authed().post(`/api/projects/${projectId}/stages`).send({
    name: 'Test Stage',
    prompt: 'You are a test stage.',
    llmProviderId: 'openai',
    llmSettings: { provider: 'openai', model: 'gpt-4', temperature: 0.7 },
    agentId,
  });

  // Create a scenario
  const scenario = await authed().post(`/api/projects/${projectId}/scenarios`).send({
    name: 'Test Scenario',
    language: 'en-US',
    startingStageId: stage.body.id,
    maxTurns: 10,
  });

  // Create a tester persona
  const tester = await authed().post(`/api/projects/${projectId}/testers`).send({
    name: 'Test Tester',
    persona: 'You are a test user.',
    language: 'en-US',
  });

  return {
    projectId,
    agentId,
    stageId: stage.body.id,
    scenarioId: scenario.body.id,
    testerId: tester.body.id,
  };
}

describe('Scenario Run API', () => {
  let fix: Fixture;

  beforeEach(async () => {
    await resetDatabase();
    fix = await createFullFixture();
  });

  describe('list', () => {
    it('returns empty list', async () => {
      const res = await authed().get(`/api/projects/${fix.projectId}/scenario-runs`);
      expect(res.status).to.equal(200);
      expect(res.body.items).to.be.an('array').that.is.empty;
      expect(res.body.total).to.equal(0);
    });

    it('returns runs after creation', async () => {
      await authed().post(`/api/projects/${fix.projectId}/scenario-runs`).send({
        scenarioId: fix.scenarioId,
        testers: { [fix.testerId]: 1 },
      });
      const res = await authed().get(`/api/projects/${fix.projectId}/scenario-runs`);
      expect(res.body.items).to.have.length(1);
      expect(res.body.total).to.equal(1);
    });
  });

  describe('create', () => {
    it('creates with minimal fields', async () => {
      const res = await authed().post(`/api/projects/${fix.projectId}/scenario-runs`).send({
        scenarioId: fix.scenarioId,
        testers: { [fix.testerId]: 1 },
      });
      expect(res.status).to.equal(201);
      expect(res.body.id).to.be.a('string');
      expect(res.body.projectId).to.equal(fix.projectId);
      expect(res.body.scenarioId).to.equal(fix.scenarioId);
      expect(res.body.status).to.equal('queued');
      expect(res.body.totalConversations).to.equal(1);
    });

    it('creates with multiple testers', async () => {
      const res = await authed().post(`/api/projects/${fix.projectId}/scenario-runs`).send({
        scenarioId: fix.scenarioId,
        testers: { [fix.testerId]: 3 },
      });
      expect(res.status).to.equal(201);
      expect(res.body.totalConversations).to.equal(3);
    });

    it('creates with metadata', async () => {
      const res = await authed().post(`/api/projects/${fix.projectId}/scenario-runs`).send({
        scenarioId: fix.scenarioId,
        testers: { [fix.testerId]: 1 },
        metadata: { source: 'api-test', runType: 'manual' },
      });
      expect(res.status).to.equal(201);
      expect(res.body.metadata).to.deep.equal({ source: 'api-test', runType: 'manual' });
    });

    it('rejects missing scenarioId (400)', async () => {
      const res = await authed().post(`/api/projects/${fix.projectId}/scenario-runs`).send({
        testers: { [fix.testerId]: 1 },
      });
      expect(res.status).to.equal(400);
    });

    it('rejects missing testers (400)', async () => {
      const res = await authed().post(`/api/projects/${fix.projectId}/scenario-runs`).send({
        scenarioId: fix.scenarioId,
      });
      expect(res.status).to.equal(400);
    });

    it('rejects empty testers map (400)', async () => {
      const res = await authed().post(`/api/projects/${fix.projectId}/scenario-runs`).send({
        scenarioId: fix.scenarioId,
        testers: {},
      });
      expect(res.status).to.equal(400);
    });

    it('creates run even with non-existent scenario (validated at execution time)', async () => {
      const res = await authed().post(`/api/projects/${fix.projectId}/scenario-runs`).send({
        scenarioId: 'nonexistent',
        testers: { [fix.testerId]: 1 },
      });
      expect(res.status).to.equal(201);
      expect(res.body.scenarioId).to.equal('nonexistent');
    });
  });

  describe('get by id', () => {
    it('returns run by ID', async () => {
      const cr = await authed().post(`/api/projects/${fix.projectId}/scenario-runs`).send({
        scenarioId: fix.scenarioId,
        testers: { [fix.testerId]: 1 },
      });
      const res = await authed().get(`/api/projects/${fix.projectId}/scenario-runs/${cr.body.id}`);
      expect(res.status).to.equal(200);
      expect(res.body.id).to.equal(cr.body.id);
    });

    it('returns 404 for non-existent', async () => {
      const res = await authed().get(`/api/projects/${fix.projectId}/scenario-runs/nonexistent`);
      expect(res.status).to.equal(404);
    });
  });

  describe('cancel', () => {
    it('cancels a queued or in_progress run', async () => {
      const cr = await authed().post(`/api/projects/${fix.projectId}/scenario-runs`).send({
        scenarioId: fix.scenarioId,
        testers: { [fix.testerId]: 1 },
      });
      const res = await authed().post(`/api/projects/${fix.projectId}/scenario-runs/${cr.body.id}/cancel`);
      // May return 200 (cancelled) or 409 (already terminal if executor picked it up)
      expect(res.status).to.be.oneOf([200, 409]);
      if (res.status === 200) {
        expect(res.body.status).to.equal('cancelled');
      }
    });

    it('returns 404 for non-existent run', async () => {
      const res = await authed().post(`/api/projects/${fix.projectId}/scenario-runs/nonexistent/cancel`);
      expect(res.status).to.equal(404);
    });

    it('returns 409 for already terminal run', async () => {
      const cr = await authed().post(`/api/projects/${fix.projectId}/scenario-runs`).send({
        scenarioId: fix.scenarioId,
        testers: { [fix.testerId]: 1 },
      });
      // Cancel first (may succeed or fail if executor picked it up)
      const firstCancel = await authed().post(`/api/projects/${fix.projectId}/scenario-runs/${cr.body.id}/cancel`);
      // Try to cancel again - should always be 409 now
      const res = await authed().post(`/api/projects/${fix.projectId}/scenario-runs/${cr.body.id}/cancel`);
      expect(res.status).to.equal(409);
    });
  });

  describe('delete', () => {
    it('deletes a terminal run', async () => {
      const cr = await authed().post(`/api/projects/${fix.projectId}/scenario-runs`).send({
        scenarioId: fix.scenarioId,
        testers: { [fix.testerId]: 1 },
      });
      // Cancel first to make it terminal (may already be terminal if executor ran it)
      await authed().post(`/api/projects/${fix.projectId}/scenario-runs/${cr.body.id}/cancel`);
      // Wait briefly for status to propagate
      await new Promise(r => setTimeout(r, 200));
      const res = await authed().delete(`/api/projects/${fix.projectId}/scenario-runs/${cr.body.id}`);
      expect(res.status).to.be.oneOf([200, 204]);
      const getRes = await authed().get(`/api/projects/${fix.projectId}/scenario-runs/${cr.body.id}`);
      expect(getRes.status).to.equal(404);
    });

    it('returns 404 for non-existent', async () => {
      const res = await authed().delete(`/api/projects/${fix.projectId}/scenario-runs/nonexistent`);
      expect(res.status).to.equal(404);
    });

    it('returns 409 for non-terminal run', async () => {
      const cr = await authed().post(`/api/projects/${fix.projectId}/scenario-runs`).send({
        scenarioId: fix.scenarioId,
        testers: { [fix.testerId]: 1 },
      });
      const res = await authed().delete(`/api/projects/${fix.projectId}/scenario-runs/${cr.body.id}`);
      expect(res.status).to.equal(409);
    });
  });

  describe('scheduler status', () => {
    it('returns scheduler status', async () => {
      const res = await authed().get('/api/scenario-runs/scheduler');
      expect(res.status).to.equal(200);
      expect(res.body.enabled).to.be.a('boolean');
    });

    it('can update scheduler status', async () => {
      const initial = await authed().get('/api/scenario-runs/scheduler');
      const newVal = !initial.body.enabled;
      const res = await authed().put('/api/scenario-runs/scheduler').send({ enabled: newVal });
      expect(res.status).to.equal(200);
      expect(res.body.enabled).to.equal(newVal);
    });

    it('rejects invalid body', async () => {
      const res = await authed().put('/api/scenario-runs/scheduler').send({ enabled: 'yes' });
      expect(res.status).to.equal(400);
    });
  });
});
