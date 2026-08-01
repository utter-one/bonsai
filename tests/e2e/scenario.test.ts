import { describe, it, beforeEach } from 'mocha';
import { expect } from 'chai';
import { authed, resetDatabase } from '../utils';
import { createProjectWithAgent } from '../fixtures';

interface Fixture { projectId: string; agentId: string; }

function minimalScenario(stageId: string) {
  return {
    name: 'Test Scenario',
    language: 'en-US',
    startingStageId: stageId,
    maxTurns: 10,
  };
}

describe('Scenario API', () => {
  let fix: Fixture;
  let stageId: string;

  beforeEach(async () => {
    await resetDatabase();
    fix = await createProjectWithAgent();
    // create a stage for startingStageId
    const stage = await authed().post(`/api/projects/${fix.projectId}/stages`).send({
      name: 'Test Stage',
      prompt: 'You are a test stage.',
      llmProviderId: 'openai',
      llmSettings: {
        provider: 'openai',
        model: 'gpt-4',
        temperature: 0.7,
      },
      agentId: fix.agentId,
    });
    stageId = stage.body.id;
  });

  describe('list', () => {
    it('returns empty list', async () => {
      const res = await authed().get(`/api/projects/${fix.projectId}/scenarios`);
      expect(res.status).to.equal(200);
      expect(res.body.items).to.be.an('array').that.is.empty;
    });

    it('returns scenarios after creation', async () => {
      await authed().post(`/api/projects/${fix.projectId}/scenarios`).send({ ...minimalScenario(stageId), name: 'A' });
      const res = await authed().get(`/api/projects/${fix.projectId}/scenarios`);
      expect(res.body.items).to.have.length(1);
    });
  });

  describe('create', () => {
    it('creates with minimal fields', async () => {
      const res = await authed().post(`/api/projects/${fix.projectId}/scenarios`).send(minimalScenario(stageId));
      expect(res.status).to.equal(201);
      expect(res.body.id).to.be.a('string');
      expect(res.body.version).to.equal(1);
    });

    it('creates with full config', async () => {
      const res = await authed().post(`/api/projects/${fix.projectId}/scenarios`).send({
        ...minimalScenario(stageId),
        description: 'A full scenario',
        endingStageIds: [stageId],
        personaCanHangUp: true,
        conversationOpener: 'Hello!',
        tags: ['primary'],
      });
      expect(res.status).to.equal(201);
      expect(res.body.description).to.equal('A full scenario');
      expect(res.body.endingStageIds).to.deep.equal([stageId]);
      expect(res.body.personaCanHangUp).to.equal(true);
    });

    it('rejects missing name (400)', async () => {
      const p = minimalScenario(stageId);
      delete p.name;
      const res = await authed().post(`/api/projects/${fix.projectId}/scenarios`).send(p);
      expect(res.status).to.equal(400);
    });

    it('rejects missing language (400)', async () => {
      const p = minimalScenario(stageId);
      delete p.language;
      const res = await authed().post(`/api/projects/${fix.projectId}/scenarios`).send(p);
      expect(res.status).to.equal(400);
    });

    it('rejects missing startingStageId (400)', async () => {
      const p = minimalScenario(stageId);
      delete p.startingStageId;
      const res = await authed().post(`/api/projects/${fix.projectId}/scenarios`).send(p);
      expect(res.status).to.equal(400);
    });

    it('rejects missing maxTurns (400)', async () => {
      const p = minimalScenario(stageId);
      delete p.maxTurns;
      const res = await authed().post(`/api/projects/${fix.projectId}/scenarios`).send(p);
      expect(res.status).to.equal(400);
    });
  });

  describe('get by id', () => {
    it('returns scenario by ID', async () => {
      const cr = await authed().post(`/api/projects/${fix.projectId}/scenarios`).send(minimalScenario(stageId));
      const res = await authed().get(`/api/projects/${fix.projectId}/scenarios/${cr.body.id}`);
      expect(res.status).to.equal(200);
      expect(res.body.id).to.equal(cr.body.id);
    });

    it('returns 404 for non-existent', async () => {
      const res = await authed().get(`/api/projects/${fix.projectId}/scenarios/nonexistent`);
      expect(res.status).to.equal(404);
    });
  });

  describe('update', () => {
    it('updates name', async () => {
      const cr = await authed().post(`/api/projects/${fix.projectId}/scenarios`).send(minimalScenario(stageId));
      const res = await authed().put(`/api/projects/${fix.projectId}/scenarios/${cr.body.id}`).send({ name: 'Updated', version: cr.body.version });
      expect(res.status).to.equal(200);
      expect(res.body.name).to.equal('Updated');
      expect(res.body.version).to.equal(cr.body.version + 1);
    });

    it('rejects stale version (409)', async () => {
      const cr = await authed().post(`/api/projects/${fix.projectId}/scenarios`).send(minimalScenario(stageId));
      await authed().put(`/api/projects/${fix.projectId}/scenarios/${cr.body.id}`).send({ name: 'First', version: cr.body.version });
      const res = await authed().put(`/api/projects/${fix.projectId}/scenarios/${cr.body.id}`).send({ name: 'Second', version: cr.body.version });
      expect(res.status).to.be.oneOf([400, 409]);
    });

    it('rejects missing version (400)', async () => {
      const cr = await authed().post(`/api/projects/${fix.projectId}/scenarios`).send(minimalScenario(stageId));
      const res = await authed().put(`/api/projects/${fix.projectId}/scenarios/${cr.body.id}`).send({ name: 'Updated' });
      expect(res.status).to.equal(400);
    });

    it('returns 404 for non-existent', async () => {
      const res = await authed().put(`/api/projects/${fix.projectId}/scenarios/nonexistent`).send({ name: 'X', version: 1 });
      expect(res.status).to.equal(404);
    });
  });

  describe('delete', () => {
    it('deletes a scenario', async () => {
      const cr = await authed().post(`/api/projects/${fix.projectId}/scenarios`).send(minimalScenario(stageId));
      const res = await authed().delete(`/api/projects/${fix.projectId}/scenarios/${cr.body.id}`).send({ version: cr.body.version });
      expect(res.status).to.be.oneOf([200, 204]);
      const getRes = await authed().get(`/api/projects/${fix.projectId}/scenarios/${cr.body.id}`);
      expect(getRes.status).to.equal(404);
    });

    it('returns 404 for non-existent', async () => {
      const res = await authed().delete(`/api/projects/${fix.projectId}/scenarios/nonexistent`).send({ version: 1 });
      expect(res.status).to.equal(404);
    });
  });

  describe('audit logs', () => {
    it('returns audit logs after creation', async () => {
      const cr = await authed().post(`/api/projects/${fix.projectId}/scenarios`).send(minimalScenario(stageId));
      const res = await authed().get(`/api/projects/${fix.projectId}/scenarios/${cr.body.id}/audit-logs`);
      expect(res.status).to.equal(200);
      expect(res.body).to.be.an('array');
      expect(res.body.length).to.be.greaterThanOrEqual(1);
    });
  });

  describe('pagination and filtering', () => {
    it('respects offset/limit', async () => {
      for (let i = 0; i < 3; i++) {
        await authed().post(`/api/projects/${fix.projectId}/scenarios`).send({ ...minimalScenario(stageId), name: `S${i}` });
      }
      const res = await authed().get(`/api/projects/${fix.projectId}/scenarios?offset=1&limit=1`);
      expect(res.body.items).to.have.length(1);
      expect(res.body.total).to.equal(3);
    });



    it('searches by name', async () => {
      await authed().post(`/api/projects/${fix.projectId}/scenarios`).send({ ...minimalScenario(stageId), name: 'Alpha' });
      await authed().post(`/api/projects/${fix.projectId}/scenarios`).send({ ...minimalScenario(stageId), name: 'Beta' });
      const res = await authed().get(`/api/projects/${fix.projectId}/scenarios?textSearch=alpha`);
      expect(res.body.items).to.have.length(1);
    });
  });
});
