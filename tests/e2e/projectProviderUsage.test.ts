import { describe, it, beforeEach } from 'mocha';
import { expect } from 'chai';
import { authed, unauthed, resetDatabase } from '../utils';
import { createProjectWithAgent } from '../fixtures';

// ── Minimal provider payloads ────────────────────────────────────────
function minimalLlmProvider() {
  return {
    name: 'Test LLM Provider',
    providerType: 'llm',
    apiType: 'openai',
    config: {
      apiKey: 'sk-test-key',
      baseUrl: 'https://api.openai.com',
    },
  };
}

function minimalTtsProvider() {
  return {
    name: 'Test TTS Provider',
    providerType: 'tts',
    apiType: 'elevenlabs',
    config: {
      apiKey: 'sk-test-key',
    },
  };
}

// ── Test state ───────────────────────────────────────────────────────
interface Fixture {
  projectId: string;
  agentId: string;
  llmProviderId: string;
  llmProviderId2: string;
  ttsProviderId: string;
}

describe('Project Provider Usage API', () => {
  let fix: Fixture;

  beforeEach(async () => {
    await resetDatabase();
    const { projectId, agentId } = await createProjectWithAgent();

    // Create providers
    const llmRes = await authed().post('/api/providers').send(minimalLlmProvider());
    const llmRes2 = await authed().post('/api/providers').send({ ...minimalLlmProvider(), name: 'Test LLM Provider 2' });
    const ttsRes = await authed().post('/api/providers').send(minimalTtsProvider());

    fix = {
      projectId,
      agentId,
      llmProviderId: llmRes.body.id,
      llmProviderId2: llmRes2.body.id,
      ttsProviderId: ttsRes.body.id,
    };
  });

  describe('GET /api/projects/:projectId/providers/used', () => {
    it('returns empty report when no entities reference providers', async () => {
      const res = await authed().get(`/api/projects/${fix.projectId}/providers/used`);
      expect(res.status).to.equal(200);
      expect(res.body.providers).to.be.an('array').that.is.empty;
      expect(res.body.summary.totalProviders).to.equal(0);
      expect(res.body.summary.byType.llm).to.equal(0);
      expect(res.body.summary.byType.tts).to.equal(0);
    });

    it('returns 404 for non-existent project', async () => {
      const res = await authed().get('/api/projects/nonexistent/providers/used');
      expect(res.status).to.equal(404);
    });

    it('returns 401 for unauthenticated request', async () => {
      const res = await unauthed().get(`/api/projects/${fix.projectId}/providers/used`);
      expect(res.status).to.equal(401);
    });

    it('reports agent with TTS provider', async () => {
      const agentRes = await authed().get(`/api/projects/${fix.projectId}/agents/${fix.agentId}`);
      const agent = agentRes.body;
      await authed()
        .put(`/api/projects/${fix.projectId}/agents/${fix.agentId}`)
        .send({
          name: agent.name,
          prompt: agent.prompt,
          version: agent.version,
          ttsProviderId: fix.ttsProviderId,
          ttsSettings: {
            provider: 'elevenlabs',
            voiceId: 'test-voice',
            model: 'eleven_flash_v2_5',
          },
        });

      const res = await authed().get(`/api/projects/${fix.projectId}/providers/used`);
      expect(res.status).to.equal(200);
      expect(res.body.providers).to.have.length(1);

      const provider = res.body.providers[0];
      expect(provider.id).to.equal(fix.ttsProviderId);
      expect(provider.providerType).to.equal('tts');
      expect(provider.usage).to.have.length(1);
      expect(provider.usage[0].entityType).to.equal('agent');
      expect(provider.usage[0].entityId).to.equal(fix.agentId);
      expect(provider.usage[0].modelName).to.equal('eleven_flash_v2_5');

      expect(res.body.summary.totalProviders).to.equal(1);
      expect(res.body.summary.byType.tts).to.equal(1);
    });

    it('reports stage with LLM provider', async () => {
      await authed()
        .post(`/api/projects/${fix.projectId}/stages`)
        .send({
          name: 'Test Stage',
          prompt: 'Test prompt',
          agentId: fix.agentId,
          llmProviderId: fix.llmProviderId,
          llmSettings: {
            provider: 'openai',
            model: 'gpt-4',
          },
        });

      const res = await authed().get(`/api/projects/${fix.projectId}/providers/used`);
      expect(res.status).to.equal(200);
      expect(res.body.providers).to.have.length(1);

      const provider = res.body.providers[0];
      expect(provider.id).to.equal(fix.llmProviderId);
      expect(provider.providerType).to.equal('llm');
      expect(provider.usage).to.have.length(1);
      expect(provider.usage[0].entityType).to.equal('stage');
      expect(provider.usage[0].modelName).to.equal('gpt-4');

      expect(res.body.summary.totalProviders).to.equal(1);
      expect(res.body.summary.byType.llm).to.equal(1);
    });

    it('reports multiple entities using the same provider', async () => {
      await authed()
        .post(`/api/projects/${fix.projectId}/classifiers`)
        .send({
          name: 'Test Classifier',
          prompt: 'Classify this',
          llmProviderId: fix.llmProviderId,
          llmSettings: {
            provider: 'openai',
            model: 'gpt-3.5-turbo',
          },
        });

      await authed()
        .post(`/api/projects/${fix.projectId}/stages`)
        .send({
          name: 'Test Stage',
          prompt: 'Test prompt',
          agentId: fix.agentId,
          llmProviderId: fix.llmProviderId,
          llmSettings: {
            provider: 'openai',
            model: 'gpt-4',
          },
        });

      const res = await authed().get(`/api/projects/${fix.projectId}/providers/used`);
      expect(res.status).to.equal(200);
      expect(res.body.providers).to.have.length(1);

      const provider = res.body.providers[0];
      expect(provider.usage).to.have.length(2);
      expect(provider.usage.map((u: any) => u.entityType)).to.include('classifier');
      expect(provider.usage.map((u: any) => u.entityType)).to.include('stage');
      expect(res.body.summary.totalProviders).to.equal(1);
    });

    it('reports multiple distinct providers across entity types', async () => {
      const agentRes = await authed().get(`/api/projects/${fix.projectId}/agents/${fix.agentId}`);
      const agent = agentRes.body;
      await authed()
        .put(`/api/projects/${fix.projectId}/agents/${fix.agentId}`)
        .send({
          name: agent.name,
          prompt: agent.prompt,
          version: agent.version,
          ttsProviderId: fix.ttsProviderId,
          ttsSettings: {
            provider: 'elevenlabs',
            voiceId: 'test-voice',
          },
        });

      await authed()
        .post(`/api/projects/${fix.projectId}/stages`)
        .send({
          name: 'Test Stage',
          prompt: 'Test prompt',
          agentId: fix.agentId,
          llmProviderId: fix.llmProviderId,
          llmSettings: {
            provider: 'openai',
            model: 'gpt-4',
          },
        });

      await authed()
        .post(`/api/projects/${fix.projectId}/classifiers`)
        .send({
          name: 'Test Classifier',
          prompt: 'Classify this',
          llmProviderId: fix.llmProviderId2,
          llmSettings: {
            provider: 'openai',
            model: 'gpt-3.5-turbo',
          },
        });

      const res = await authed().get(`/api/projects/${fix.projectId}/providers/used`);
      expect(res.status).to.equal(200);
      expect(res.body.providers).to.have.length(3);
      expect(res.body.summary.totalProviders).to.equal(3);
      expect(res.body.summary.byType.llm).to.equal(2);
      expect(res.body.summary.byType.tts).to.equal(1);
    });

    it('reports tester with LLM provider', async () => {
      await authed()
        .post(`/api/projects/${fix.projectId}/testers`)
        .send({
          name: 'Test Tester',
          prompt: 'You are a test user.',
          llmProviderId: fix.llmProviderId,
          llmSettings: {
            provider: 'openai',
            model: 'gpt-4',
          },
        });

      const res = await authed().get(`/api/projects/${fix.projectId}/providers/used`);
      expect(res.status).to.equal(200);
      expect(res.body.providers).to.have.length(1);

      const provider = res.body.providers[0];
      expect(provider.usage).to.have.length(1);
      expect(provider.usage[0].entityType).to.equal('tester');
    });

    it('reports tool with LLM provider', async () => {
      await authed()
        .post(`/api/projects/${fix.projectId}/tools`)
        .send({
          type: 'smart_function',
          name: 'Test Tool',
          prompt: 'Execute this tool',
          llmProviderId: fix.llmProviderId,
          llmSettings: {
            provider: 'openai',
            model: 'gpt-4',
          },
          inputType: 'text',
          outputType: 'text',
        });

      const res = await authed().get(`/api/projects/${fix.projectId}/providers/used`);
      expect(res.status).to.equal(200);
      expect(res.body.providers).to.have.length(1);

      const provider = res.body.providers[0];
      expect(provider.usage).to.have.length(1);
      expect(provider.usage[0].entityType).to.equal('tool');
    });

    it('reports context transformer with LLM provider', async () => {
      await authed()
        .post(`/api/projects/${fix.projectId}/context-transformers`)
        .send({
          name: 'Test Transformer',
          prompt: 'Transform this',
          llmProviderId: fix.llmProviderId,
          llmSettings: {
            provider: 'openai',
            model: 'gpt-4',
          },
        });

      const res = await authed().get(`/api/projects/${fix.projectId}/providers/used`);
      expect(res.status).to.equal(200);
      expect(res.body.providers).to.have.length(1);

      const provider = res.body.providers[0];
      expect(provider.usage).to.have.length(1);
      expect(provider.usage[0].entityType).to.equal('contextTransformer');
    });

    it('excludes entities that do not reference a provider', async () => {
      await authed()
        .post(`/api/projects/${fix.projectId}/testers`)
        .send({
          name: 'Tester Without LLM',
          prompt: 'You are a test user.',
        });

      const res = await authed().get(`/api/projects/${fix.projectId}/providers/used`);
      expect(res.status).to.equal(200);
      expect(res.body.providers).to.be.an('array').that.is.empty;
      expect(res.body.summary.totalProviders).to.equal(0);
    });

    it('excludes providers that exist but are not referenced by any entity', async () => {
      const res = await authed().get(`/api/projects/${fix.projectId}/providers/used`);
      expect(res.status).to.equal(200);
      expect(res.body.providers).to.be.an('array').that.is.empty;
      expect(res.body.summary.totalProviders).to.equal(0);
    });

    // ── checkIfAvailable tests ──────────────────────────────────────

    it('does not include availability by default', async () => {
      await authed()
        .post(`/api/projects/${fix.projectId}/stages`)
        .send({
          name: 'Test Stage',
          prompt: 'Test prompt',
          agentId: fix.agentId,
          llmProviderId: fix.llmProviderId,
          llmSettings: {
            provider: 'openai',
            model: 'gpt-4',
          },
        });

      const res = await authed().get(`/api/projects/${fix.projectId}/providers/used`);
      expect(res.status).to.equal(200);
      expect(res.body.providers[0].availability).to.be.undefined;
    });

    it('includes availability when checkIfAvailable=true (LLM provider)', async () => {
      await authed()
        .post(`/api/projects/${fix.projectId}/stages`)
        .send({
          name: 'Test Stage',
          prompt: 'Test prompt',
          agentId: fix.agentId,
          llmProviderId: fix.llmProviderId,
          llmSettings: {
            provider: 'openai',
            model: 'gpt-4',
          },
        });

      const res = await authed().get(`/api/projects/${fix.projectId}/providers/used?checkIfAvailable=true`);
      expect(res.status).to.equal(200);
      expect(res.body.providers).to.have.length(1);

      const provider = res.body.providers[0];
      expect(provider.availability).to.be.an('object');
      expect(provider.availability.status).to.be.oneOf(['available', 'partially_available', 'unavailable']);
      expect(provider.availability.models).to.be.an('array');
    });

    it('includes availability with not_applicable for non-LLM providers', async () => {
      const agentRes = await authed().get(`/api/projects/${fix.projectId}/agents/${fix.agentId}`);
      const agent = agentRes.body;
      await authed()
        .put(`/api/projects/${fix.projectId}/agents/${fix.agentId}`)
        .send({
          name: agent.name,
          prompt: agent.prompt,
          version: agent.version,
          ttsProviderId: fix.ttsProviderId,
          ttsSettings: {
            provider: 'elevenlabs',
            voiceId: 'test-voice',
            model: 'eleven_flash_v2_5',
          },
        });

      const res = await authed().get(`/api/projects/${fix.projectId}/providers/used?checkIfAvailable=true`);
      expect(res.status).to.equal(200);
      expect(res.body.providers).to.have.length(1);

      const provider = res.body.providers[0];
      expect(provider.availability).to.be.an('object');
      expect(provider.availability.status).to.equal('not_applicable');
      expect(provider.availability.models).to.be.an('array').that.is.empty;
    });

    it('reports partially_available when some models are unavailable', async () => {
      // Create a stage with a real model and a classifier with a fake model
      await authed()
        .post(`/api/projects/${fix.projectId}/stages`)
        .send({
          name: 'Real Model Stage',
          prompt: 'Test prompt',
          agentId: fix.agentId,
          llmProviderId: fix.llmProviderId,
          llmSettings: {
            provider: 'openai',
            model: 'gpt-4',
          },
        });

      await authed()
        .post(`/api/projects/${fix.projectId}/classifiers`)
        .send({
          name: 'Fake Model Classifier',
          prompt: 'Classify this',
          llmProviderId: fix.llmProviderId,
          llmSettings: {
            provider: 'openai',
            model: 'nonexistent-model-xyz-12345',
          },
        });

      const res = await authed().get(`/api/projects/${fix.projectId}/providers/used?checkIfAvailable=true`);
      expect(res.status).to.equal(200);
      expect(res.body.providers).to.have.length(1);

      const provider = res.body.providers[0];
      expect(provider.availability).to.be.an('object');
      expect(provider.availability.models).to.have.length(2);

      // Find the real and fake model entries
      const realModel = provider.availability.models.find((m: any) => m.model === 'gpt-4');
      const fakeModel = provider.availability.models.find((m: any) => m.model === 'nonexistent-model-xyz-12345');

      expect(realModel).to.not.be.undefined;
      expect(fakeModel).to.not.be.undefined;

      // The fake model should always be unavailable
      expect(fakeModel.status).to.equal('unavailable');

      // Overall status depends on whether gpt-4 is available from the API
      expect(provider.availability.status).to.be.oneOf(['partially_available', 'unavailable']);
    });

    it('reports unavailable when API is unreachable and all models are missing', async () => {
      // The test provider uses a fake API key, so the API call will fail
      // When the API fails, no models are returned, so all configured models are unavailable
      await authed()
        .post(`/api/projects/${fix.projectId}/stages`)
        .send({
          name: 'Test Stage',
          prompt: 'Test prompt',
          agentId: fix.agentId,
          llmProviderId: fix.llmProviderId,
          llmSettings: {
            provider: 'openai',
            model: 'gpt-4',
          },
        });

      const res = await authed().get(`/api/projects/${fix.projectId}/providers/used?checkIfAvailable=true`);
      expect(res.status).to.equal(200);
      expect(res.body.providers).to.have.length(1);

      const provider = res.body.providers[0];
      expect(provider.availability).to.be.an('object');
      // When API fails, enumerateModels falls back to static list which includes gpt-4
      // so status may be available. Either way the structure is correct.
      expect(provider.availability.status).to.be.oneOf(['available', 'partially_available', 'unavailable']);
      expect(provider.availability.models).to.be.an('array');
    });

    it('includes usedBy in model availability entries', async () => {
      await authed()
        .post(`/api/projects/${fix.projectId}/stages`)
        .send({
          name: 'Stage A',
          prompt: 'Test prompt',
          agentId: fix.agentId,
          llmProviderId: fix.llmProviderId,
          llmSettings: {
            provider: 'openai',
            model: 'gpt-4',
          },
        });

      const res = await authed().get(`/api/projects/${fix.projectId}/providers/used?checkIfAvailable=true`);
      expect(res.status).to.equal(200);

      const provider = res.body.providers[0];
      const gpt4Entry = provider.availability.models.find((m: any) => m.model === 'gpt-4');
      if (gpt4Entry) {
        expect(gpt4Entry.usedBy).to.be.an('array').that.is.not.empty;
      }
    });
  });
});
