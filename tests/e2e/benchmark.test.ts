import { describe, it, beforeEach } from 'mocha';
import { expect } from 'chai';
import { authed, resetDatabase } from '../utils';

async function createLlmProvider() {
  const res = await authed().post('/api/providers').send({
    name: 'Benchmark LLM',
    providerType: 'llm',
    apiType: 'openai',
    config: { apiKey: 'sk-benchmark-test-key' },
  });
  expect(res.status).to.equal(201);
  return res.body.id;
}

async function createTtsProvider() {
  const res = await authed().post('/api/providers').send({
    name: 'Benchmark TTS',
    providerType: 'tts',
    apiType: 'elevenlabs',
    config: { apiKey: 'tts-test-key' },
  });
  expect(res.status).to.equal(201);
  return res.body.id;
}

async function createAsrProvider() {
  const res = await authed().post('/api/providers').send({
    name: 'Benchmark ASR',
    providerType: 'asr',
    apiType: 'deepgram',
    config: { apiKey: 'asr-test-key' },
  });
  expect(res.status).to.equal(201);
  return res.body.id;
}

interface BenchmarkFixtures {
  llmProviderId: string;
  ttsProviderId: string;
  asrProviderId: string;
}

async function createBenchmarkProviders(): Promise<BenchmarkFixtures> {
  return {
    llmProviderId: await createLlmProvider(),
    ttsProviderId: await createTtsProvider(),
    asrProviderId: await createAsrProvider(),
  };
}

describe('Benchmark Config API', () => {
  let fix: BenchmarkFixtures;

  beforeEach(async () => {
    await resetDatabase();
    fix = await createBenchmarkProviders();
  });

  describe('create', () => {
    it('returns 400 for missing suiteId', async () => {
      const res = await authed().post('/api/benchmarks/configs').send({
        name: 'Test Config',
        providerConfigId: 'nonexistent',
        inputType: 'text',
        inputData: { text: 'hello' },
      });
      expect(res.status).to.equal(400);
    });

    it('returns 400 for missing providerConfigId', async () => {
      const res = await authed().post('/api/benchmarks/configs').send({
        suiteId: 'nonexistent',
        name: 'Test Config',
        inputType: 'text',
        inputData: { text: 'hello' },
      });
      expect(res.status).to.equal(400);
    });

    it('returns 400 for missing inputType', async () => {
      const res = await authed().post('/api/benchmarks/configs').send({
        suiteId: 'nonexistent',
        name: 'Test Config',
        providerConfigId: 'nonexistent',
        inputData: { text: 'hello' },
      });
      expect(res.status).to.equal(400);
    });

    it('returns 400 for missing inputData', async () => {
      const res = await authed().post('/api/benchmarks/configs').send({
        suiteId: 'nonexistent',
        name: 'Test Config',
        providerConfigId: 'nonexistent',
        inputType: 'text',
      });
      expect(res.status).to.equal(400);
    });

    it('creates with minimal fields', async () => {
      // Create a suite first
      const suiteRes = await authed().post('/api/benchmarks/suites').send({ name: 'Test Suite' });
      expect(suiteRes.status).to.equal(201);

      // Create a provider config first
      const provConfigRes = await authed().post('/api/benchmarks/provider-configs').send({
        name: 'Test Provider Config',
        providerType: 'llm',
        providerId: fix.llmProviderId,
        settings: { model: 'gpt-4o' },
      });
      expect(provConfigRes.status).to.equal(201);

      const res = await authed().post('/api/benchmarks/configs').send({
        suiteId: suiteRes.body.id,
        name: 'Test Config',
        providerConfigId: provConfigRes.body.id,
        inputType: 'text',
        inputData: { text: 'hello world' },
      });
      expect(res.status).to.equal(201);
      expect(res.body.id).to.be.a('string');
      expect(res.body.version).to.equal(1);
      expect(res.body.suiteId).to.equal(suiteRes.body.id);
      expect(res.body.providerConfigId).to.equal(provConfigRes.body.id);
      expect(res.body.inputType).to.equal('text');
      expect(res.body.repeats).to.equal(3); // default
    });

    it('creates with full config including repeats', async () => {
      const suiteRes = await authed().post('/api/benchmarks/suites').send({ name: 'Full Suite' });
      expect(suiteRes.status).to.equal(201);

      const provConfigRes = await authed().post('/api/benchmarks/provider-configs').send({
        name: 'Full Provider Config',
        providerType: 'llm',
        providerId: fix.llmProviderId,
        settings: { model: 'gpt-4o' },
      });
      expect(provConfigRes.status).to.equal(201);

      const res = await authed().post('/api/benchmarks/configs').send({
        suiteId: suiteRes.body.id,
        name: 'Full Config',
        description: 'A thorough test case',
        providerConfigId: provConfigRes.body.id,
        inputType: 'messages',
        inputData: { messages: [{ role: 'user', content: 'Hello' }] },
        repeats: 10,
      });
      expect(res.status).to.equal(201);
      expect(res.body.description).to.equal('A thorough test case');
      expect(res.body.repeats).to.equal(10);
      expect(res.body.inputType).to.equal('messages');
    });
  });

  describe('get by id', () => {
    it('returns 404 for non-existent', async () => {
      const res = await authed().get('/api/benchmarks/configs/nonexistent');
      expect(res.status).to.equal(404);
    });

    it('returns config by ID after creation', async () => {
      const suiteRes = await authed().post('/api/benchmarks/suites').send({ name: 'Suite' });
      expect(suiteRes.status).to.equal(201);

      const provConfigRes = await authed().post('/api/benchmarks/provider-configs').send({
        name: 'Prov Config',
        providerType: 'llm',
        providerId: fix.llmProviderId,
        settings: { model: 'gpt-4o' },
      });
      expect(provConfigRes.status).to.equal(201);

      const createRes = await authed().post('/api/benchmarks/configs').send({
        suiteId: suiteRes.body.id,
        name: 'Get Me',
        providerConfigId: provConfigRes.body.id,
        inputType: 'text',
        inputData: { text: 'find me' },
      });
      expect(createRes.status).to.equal(201);

      const res = await authed().get(`/api/benchmarks/configs/${createRes.body.id}`);
      expect(res.status).to.equal(200);
      expect(res.body.id).to.equal(createRes.body.id);
      expect(res.body.name).to.equal('Get Me');
    });
  });

  describe('update', () => {
    it('updates name', async () => {
      const suiteRes = await authed().post('/api/benchmarks/suites').send({ name: 'Suite' });
      const provConfigRes = await authed().post('/api/benchmarks/provider-configs').send({
        name: 'Prov Config',
        providerType: 'llm',
        providerId: fix.llmProviderId,
        settings: { model: 'gpt-4o' },
      });
      const createRes = await authed().post('/api/benchmarks/configs').send({
        suiteId: suiteRes.body.id,
        name: 'Original',
        providerConfigId: provConfigRes.body.id,
        inputType: 'text',
        inputData: { text: 'hello' },
      });
      expect(createRes.status).to.equal(201);

      const res = await authed().put(`/api/benchmarks/configs/${createRes.body.id}`).send({
        name: 'Updated Name',
        version: createRes.body.version,
      });
      expect(res.status).to.equal(200);
      expect(res.body.name).to.equal('Updated Name');
      expect(res.body.version).to.equal(createRes.body.version + 1);
    });

    it('updates repeats', async () => {
      const suiteRes = await authed().post('/api/benchmarks/suites').send({ name: 'Suite' });
      const provConfigRes = await authed().post('/api/benchmarks/provider-configs').send({
        name: 'Prov Config',
        providerType: 'llm',
        providerId: fix.llmProviderId,
        settings: { model: 'gpt-4o' },
      });
      const createRes = await authed().post('/api/benchmarks/configs').send({
        suiteId: suiteRes.body.id,
        name: 'Config',
        providerConfigId: provConfigRes.body.id,
        inputType: 'text',
        inputData: { text: 'hello' },
      });
      expect(createRes.status).to.equal(201);

      const res = await authed().put(`/api/benchmarks/configs/${createRes.body.id}`).send({
        repeats: 20,
        version: createRes.body.version,
      });
      expect(res.status).to.equal(200);
      expect(res.body.repeats).to.equal(20);
    });

    it('rejects stale version (409)', async () => {
      const suiteRes = await authed().post('/api/benchmarks/suites').send({ name: 'Suite' });
      const provConfigRes = await authed().post('/api/benchmarks/provider-configs').send({
        name: 'Prov Config',
        providerType: 'llm',
        providerId: fix.llmProviderId,
        settings: { model: 'gpt-4o' },
      });
      const createRes = await authed().post('/api/benchmarks/configs').send({
        suiteId: suiteRes.body.id,
        name: 'Config',
        providerConfigId: provConfigRes.body.id,
        inputType: 'text',
        inputData: { text: 'hello' },
      });
      expect(createRes.status).to.equal(201);

      await authed().put(`/api/benchmarks/configs/${createRes.body.id}`).send({
        name: 'First',
        version: createRes.body.version,
      });
      const res = await authed().put(`/api/benchmarks/configs/${createRes.body.id}`).send({
        name: 'Second',
        version: createRes.body.version,
      });
      expect(res.status).to.be.oneOf([400, 409]);
    });

    it('rejects missing version (400)', async () => {
      const suiteRes = await authed().post('/api/benchmarks/suites').send({ name: 'Suite' });
      const provConfigRes = await authed().post('/api/benchmarks/provider-configs').send({
        name: 'Prov Config',
        providerType: 'llm',
        providerId: fix.llmProviderId,
        settings: { model: 'gpt-4o' },
      });
      const createRes = await authed().post('/api/benchmarks/configs').send({
        suiteId: suiteRes.body.id,
        name: 'Config',
        providerConfigId: provConfigRes.body.id,
        inputType: 'text',
        inputData: { text: 'hello' },
      });
      expect(createRes.status).to.equal(201);

      const res = await authed().put(`/api/benchmarks/configs/${createRes.body.id}`).send({
        name: 'Updated',
      });
      expect(res.status).to.equal(400);
    });

    it('returns 404 for non-existent', async () => {
      const res = await authed().put('/api/benchmarks/configs/nonexistent').send({ name: 'X', version: 1 });
      expect(res.status).to.equal(404);
    });
  });

  describe('delete', () => {
    it('deletes a config', async () => {
      const suiteRes = await authed().post('/api/benchmarks/suites').send({ name: 'Suite' });
      const provConfigRes = await authed().post('/api/benchmarks/provider-configs').send({
        name: 'Prov Config',
        providerType: 'llm',
        providerId: fix.llmProviderId,
        settings: { model: 'gpt-4o' },
      });
      const createRes = await authed().post('/api/benchmarks/configs').send({
        suiteId: suiteRes.body.id,
        name: 'Delete Me',
        providerConfigId: provConfigRes.body.id,
        inputType: 'text',
        inputData: { text: 'hello' },
      });
      expect(createRes.status).to.equal(201);

      const res = await authed().delete(`/api/benchmarks/configs/${createRes.body.id}`);
      expect(res.status).to.be.oneOf([200, 204]);

      const getRes = await authed().get(`/api/benchmarks/configs/${createRes.body.id}`);
      expect(getRes.status).to.equal(404);
    });

    it('returns 404 for non-existent', async () => {
      const res = await authed().delete('/api/benchmarks/configs/nonexistent');
      expect(res.status).to.equal(404);
    });
  });

  describe('list via suite', () => {
    it('returns empty configs for new suite', async () => {
      const suiteRes = await authed().post('/api/benchmarks/suites').send({ name: 'Empty Suite' });
      expect(suiteRes.status).to.equal(201);

      const res = await authed().get(`/api/benchmarks/suites/${suiteRes.body.id}/configs`);
      expect(res.status).to.equal(200);
      expect(res.body.items).to.be.an('array').that.is.empty;
    });

    it('returns configs after creation', async () => {
      const suiteRes = await authed().post('/api/benchmarks/suites').send({ name: 'Suite' });
      expect(suiteRes.status).to.equal(201);

      const provConfigRes = await authed().post('/api/benchmarks/provider-configs').send({
        name: 'Prov Config',
        providerType: 'llm',
        providerId: fix.llmProviderId,
        settings: { model: 'gpt-4o' },
      });
      expect(provConfigRes.status).to.equal(201);

      await authed().post('/api/benchmarks/configs').send({
        suiteId: suiteRes.body.id,
        name: 'Config A',
        providerConfigId: provConfigRes.body.id,
        inputType: 'text',
        inputData: { text: 'a' },
      });
      await authed().post('/api/benchmarks/configs').send({
        suiteId: suiteRes.body.id,
        name: 'Config B',
        providerConfigId: provConfigRes.body.id,
        inputType: 'text',
        inputData: { text: 'b' },
      });

      const res = await authed().get(`/api/benchmarks/suites/${suiteRes.body.id}/configs`);
      expect(res.status).to.equal(200);
      expect(res.body.items).to.have.length(2);
    });
  });
});

describe('Benchmark Provider Config API', () => {
  let fix: BenchmarkFixtures;

  beforeEach(async () => {
    await resetDatabase();
    fix = await createBenchmarkProviders();
  });

  describe('list', () => {
    it('returns empty list', async () => {
      const res = await authed().get('/api/benchmarks/provider-configs');
      expect(res.status).to.equal(200);
      expect(res.body.items).to.be.an('array');
      expect(res.body.total).to.equal(0);
    });

    it('returns configs after creation', async () => {
      await authed().post('/api/benchmarks/provider-configs').send({
        name: 'Config A',
        providerType: 'llm',
        providerId: fix.llmProviderId,
        settings: { model: 'gpt-4o' },
      });
      await authed().post('/api/benchmarks/provider-configs').send({
        name: 'Config B',
        providerType: 'tts',
        providerId: fix.ttsProviderId,
        settings: { voice: 'default' },
      });
      const res = await authed().get('/api/benchmarks/provider-configs');
      expect(res.status).to.equal(200);
      expect(res.body.items).to.have.length(2);
    });
  });

  describe('create', () => {
    it('creates LLM provider config with minimal fields', async () => {
      const res = await authed().post('/api/benchmarks/provider-configs').send({
        name: 'Test LLM Config',
        providerType: 'llm',
        providerId: fix.llmProviderId,
        settings: { model: 'gpt-4o' },
      });
      expect(res.status).to.equal(201);
      expect(res.body.id).to.be.a('string');
      expect(res.body.version).to.equal(1);
      expect(res.body.name).to.equal('Test LLM Config');
      expect(res.body.providerType).to.equal('llm');
      expect(res.body.providerId).to.equal(fix.llmProviderId);
      expect(res.body.settings).to.deep.equal({ model: 'gpt-4o' });
    });

    it('creates TTS provider config', async () => {
      const res = await authed().post('/api/benchmarks/provider-configs').send({
        name: 'Test TTS Config',
        providerType: 'tts',
        providerId: fix.ttsProviderId,
        settings: { voice: 'alloy' },
      });
      expect(res.status).to.equal(201);
      expect(res.body.providerType).to.equal('tts');
    });

    it('creates ASR provider config', async () => {
      const res = await authed().post('/api/benchmarks/provider-configs').send({
        name: 'Test ASR Config',
        providerType: 'asr',
        providerId: fix.asrProviderId,
        settings: { language: 'en' },
      });
      expect(res.status).to.equal(201);
      expect(res.body.providerType).to.equal('asr');
    });

    it('creates with providerSettings', async () => {
      const res = await authed().post('/api/benchmarks/provider-configs').send({
        name: 'Full Config',
        providerType: 'llm',
        providerId: fix.llmProviderId,
        settings: { model: 'gpt-4o' },
        providerSettings: { temperature: 0.7, maxTokens: 100 },
      });
      expect(res.status).to.equal(201);
      expect(res.body.providerSettings).to.deep.equal({ temperature: 0.7, maxTokens: 100 });
    });

    it('rejects missing name (400)', async () => {
      const res = await authed().post('/api/benchmarks/provider-configs').send({
        providerType: 'llm',
        providerId: 'nonexistent',
        settings: { model: 'gpt-4o' },
      });
      expect(res.status).to.equal(400);
    });

    it('rejects missing providerType (400)', async () => {
      const res = await authed().post('/api/benchmarks/provider-configs').send({
        name: 'Test',
        providerId: 'nonexistent',
        settings: { model: 'gpt-4o' },
      });
      expect(res.status).to.equal(400);
    });

    it('rejects missing settings (400)', async () => {
      const res = await authed().post('/api/benchmarks/provider-configs').send({
        name: 'Test',
        providerType: 'llm',
        providerId: 'nonexistent',
      });
      expect(res.status).to.equal(400);
    });

    it('rejects invalid providerType (400)', async () => {
      const res = await authed().post('/api/benchmarks/provider-configs').send({
        name: 'Test',
        providerType: 'invalid_type',
        providerId: 'nonexistent',
        settings: { model: 'gpt-4o' },
      });
      expect(res.status).to.equal(400);
    });
  });

  describe('get by id', () => {
    it('returns config by ID', async () => {
      const cr = await authed().post('/api/benchmarks/provider-configs').send({
        name: 'Get Me',
        providerType: 'llm',
        providerId: fix.llmProviderId,
        settings: { model: 'gpt-4o' },
      });
      expect(cr.status).to.equal(201);

      const res = await authed().get(`/api/benchmarks/provider-configs/${cr.body.id}`);
      expect(res.status).to.equal(200);
      expect(res.body.id).to.equal(cr.body.id);
      expect(res.body.name).to.equal('Get Me');
    });

    it('returns 404 for non-existent', async () => {
      const res = await authed().get('/api/benchmarks/provider-configs/nonexistent');
      expect(res.status).to.equal(404);
    });
  });

  describe('update', () => {
    it('updates name', async () => {
      const cr = await authed().post('/api/benchmarks/provider-configs').send({
        name: 'Original',
        providerType: 'llm',
        providerId: fix.llmProviderId,
        settings: { model: 'gpt-4o' },
      });
      expect(cr.status).to.equal(201);

      const res = await authed().put(`/api/benchmarks/provider-configs/${cr.body.id}`).send({
        name: 'Updated',
        version: cr.body.version,
      });
      expect(res.status).to.equal(200);
      expect(res.body.name).to.equal('Updated');
      expect(res.body.version).to.equal(cr.body.version + 1);
    });

    it('updates settings', async () => {
      const cr = await authed().post('/api/benchmarks/provider-configs').send({
        name: 'Config',
        providerType: 'llm',
        providerId: fix.llmProviderId,
        settings: { model: 'gpt-4o' },
      });
      expect(cr.status).to.equal(201);

      const res = await authed().put(`/api/benchmarks/provider-configs/${cr.body.id}`).send({
        settings: { model: 'claude-3.5' },
        version: cr.body.version,
      });
      expect(res.status).to.equal(200);
      expect(res.body.settings).to.deep.equal({ model: 'claude-3.5' });
    });

    it('rejects stale version (409)', async () => {
      const cr = await authed().post('/api/benchmarks/provider-configs').send({
        name: 'Config',
        providerType: 'llm',
        providerId: fix.llmProviderId,
        settings: { model: 'gpt-4o' },
      });
      expect(cr.status).to.equal(201);

      await authed().put(`/api/benchmarks/provider-configs/${cr.body.id}`).send({
        name: 'First',
        version: cr.body.version,
      });
      const res = await authed().put(`/api/benchmarks/provider-configs/${cr.body.id}`).send({
        name: 'Second',
        version: cr.body.version,
      });
      expect(res.status).to.be.oneOf([400, 409]);
    });

    it('rejects missing version (400)', async () => {
      const cr = await authed().post('/api/benchmarks/provider-configs').send({
        name: 'Config',
        providerType: 'llm',
        providerId: fix.llmProviderId,
        settings: { model: 'gpt-4o' },
      });
      expect(cr.status).to.equal(201);

      const res = await authed().put(`/api/benchmarks/provider-configs/${cr.body.id}`).send({
        name: 'Updated',
      });
      expect(res.status).to.equal(400);
    });

    it('returns 404 for non-existent', async () => {
      const res = await authed().put('/api/benchmarks/provider-configs/nonexistent').send({ name: 'X', version: 1 });
      expect(res.status).to.equal(404);
    });
  });

  describe('delete', () => {
    it('deletes a provider config', async () => {
      const cr = await authed().post('/api/benchmarks/provider-configs').send({
        name: 'Delete Me',
        providerType: 'llm',
        providerId: fix.llmProviderId,
        settings: { model: 'gpt-4o' },
      });
      expect(cr.status).to.equal(201);

      const res = await authed().delete(`/api/benchmarks/provider-configs/${cr.body.id}`);
      expect(res.status).to.be.oneOf([200, 204]);

      const getRes = await authed().get(`/api/benchmarks/provider-configs/${cr.body.id}`);
      expect(getRes.status).to.equal(404);
    });

    it('returns 404 for non-existent', async () => {
      const res = await authed().delete('/api/benchmarks/provider-configs/nonexistent');
      expect(res.status).to.equal(404);
    });
  });

  describe('pagination', () => {
    it('respects offset/limit', async () => {
      for (let i = 0; i < 3; i++) {
        await authed().post('/api/benchmarks/provider-configs').send({
          name: `Config ${i}`,
          providerType: 'llm',
          providerId: fix.llmProviderId,
          settings: { model: 'gpt-4o' },
        });
      }
      const res = await authed().get('/api/benchmarks/provider-configs?offset=1&limit=1');
      expect(res.status).to.equal(200);
      expect(res.body.items).to.have.length(1);
      expect(res.body.total).to.equal(3);
    });
  });
});
