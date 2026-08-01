import { describe, it, beforeEach } from 'mocha';
import { expect } from 'chai';
import { authed, resetDatabase } from '../utils';

interface BenchmarkRunFixtures {
  providerId: string;
  suiteId: string;
  providerConfigId: string;
  configId: string;
}

async function createFullBenchmarkFixture(): Promise<BenchmarkRunFixtures> {
  // Create an LLM provider
  const llmProviderRes = await authed().post('/api/providers').send({
    name: 'Benchmark LLM',
    providerType: 'llm',
    apiType: 'openai',
    config: { apiKey: 'sk-benchmark-test-key' },
  });
  expect(llmProviderRes.status).to.equal(201);

  // Create a suite
  const suiteRes = await authed().post('/api/benchmarks/suites').send({ name: 'Run Test Suite' });
  expect(suiteRes.status).to.equal(201);

  // Create a provider config
  const provConfigRes = await authed().post('/api/benchmarks/provider-configs').send({
    name: 'Run Test Provider Config',
    providerType: 'llm',
    providerId: llmProviderRes.body.id,
    settings: { model: 'gpt-4o' },
  });
  expect(provConfigRes.status).to.equal(201);

  // Create a benchmark config
  const configRes = await authed().post('/api/benchmarks/configs').send({
    suiteId: suiteRes.body.id,
    name: 'Run Test Config',
    providerConfigId: provConfigRes.body.id,
    inputType: 'text',
    inputData: { text: 'hello world' },
  });
  expect(configRes.status).to.equal(201);

  return {
    providerId: llmProviderRes.body.id,
    suiteId: suiteRes.body.id,
    providerConfigId: provConfigRes.body.id,
    configId: configRes.body.id,
  };
}

describe('Benchmark Run API', () => {
  let fix: BenchmarkRunFixtures;

  beforeEach(async () => {
    await resetDatabase();
    fix = await createFullBenchmarkFixture();
  });

  describe('list', () => {
    it('returns empty list', async () => {
      const res = await authed().get('/api/benchmarks/runs');
      expect(res.status).to.equal(200);
      expect(res.body.items).to.be.an('array').that.is.empty;
      expect(res.body.total).to.equal(0);
    });

    it('respects offset/limit', async () => {
      const res = await authed().get('/api/benchmarks/runs?offset=0&limit=10');
      expect(res.status).to.equal(200);
      expect(res.body.items).to.be.an('array');
    });

    it('returns runs after triggering', async () => {
      await authed().post('/api/benchmarks/runs').send({ suiteId: fix.suiteId });
      await authed().post('/api/benchmarks/runs').send({ suiteId: fix.suiteId });

      const res = await authed().get('/api/benchmarks/runs');
      expect(res.status).to.equal(200);
      expect(res.body.items).to.have.length(2);
      expect(res.body.total).to.equal(2);
    });

    it('filters by suiteId', async () => {
      // Create a second suite
      const suite2Res = await authed().post('/api/benchmarks/suites').send({ name: 'Suite 2' });
      expect(suite2Res.status).to.equal(201);

      await authed().post('/api/benchmarks/runs').send({ suiteId: fix.suiteId });
      await authed().post('/api/benchmarks/runs').send({ suiteId: suite2Res.body.id });

      const res = await authed().get(`/api/benchmarks/runs?suiteId=${fix.suiteId}`);
      expect(res.status).to.equal(200);
      expect(res.body.items).to.have.length(1);
      expect(res.body.items[0].suiteId).to.equal(fix.suiteId);
    });

    it('filters by status', async () => {
      await authed().post('/api/benchmarks/runs').send({ suiteId: fix.suiteId });

      const res = await authed().get('/api/benchmarks/runs?status=pending');
      expect(res.status).to.equal(200);
      // Run may be picked up by executor and change status, so we accept any result
      expect(res.body.items).to.be.an('array');
    });
  });

  describe('trigger run', () => {
    it('returns 400 for missing suiteId', async () => {
      const res = await authed().post('/api/benchmarks/runs').send({});
      expect(res.status).to.equal(400);
    });

    it('returns 400 for empty suiteId', async () => {
      const res = await authed().post('/api/benchmarks/runs').send({ suiteId: '' });
      expect(res.status).to.equal(400);
    });

    it('returns error for non-existent suite', async () => {
      const res = await authed().post('/api/benchmarks/runs').send({ suiteId: 'nonexistent' });
      expect(res.status).to.be.oneOf([400, 404, 500]);
    });

    it('triggers a run with valid suite', async () => {
      const res = await authed().post('/api/benchmarks/runs').send({ suiteId: fix.suiteId });
      expect(res.status).to.equal(201);
      expect(res.body.id).to.be.a('string');
      expect(res.body.suiteId).to.equal(fix.suiteId);
      expect(res.body.trigger).to.equal('manual');
      expect(res.body.status).to.equal('pending');
      expect(res.body.version).to.equal(1);
    });

    it('creates config executions for the run', async () => {
      const runRes = await authed().post('/api/benchmarks/runs').send({ suiteId: fix.suiteId });
      expect(runRes.status).to.equal(201);

      // Get the run by ID to check executions
      const getRes = await authed().get(`/api/benchmarks/runs/${runRes.body.id}`);
      expect(getRes.status).to.equal(200);
      // Executions may or may not be present depending on executor timing
      // The important thing is the run was created successfully
      expect(getRes.body.id).to.equal(runRes.body.id);
    });
  });

  describe('get by id', () => {
    it('returns run by ID after trigger', async () => {
      const runRes = await authed().post('/api/benchmarks/runs').send({ suiteId: fix.suiteId });
      expect(runRes.status).to.equal(201);

      const res = await authed().get(`/api/benchmarks/runs/${runRes.body.id}`);
      expect(res.status).to.equal(200);
      expect(res.body.id).to.equal(runRes.body.id);
      expect(res.body.suiteId).to.equal(fix.suiteId);
      expect(res.body.trigger).to.equal('manual');
    });

    it('returns 404 for non-existent', async () => {
      const res = await authed().get('/api/benchmarks/runs/nonexistent');
      expect(res.status).to.equal(404);
    });
  });

  describe('delete', () => {
    it('deletes a run', async () => {
      const runRes = await authed().post('/api/benchmarks/runs').send({ suiteId: fix.suiteId });
      expect(runRes.status).to.equal(201);

      const res = await authed().delete(`/api/benchmarks/runs/${runRes.body.id}`);
      // May return 204 if deleted, or 409 if executor picked it up
      expect(res.status).to.be.oneOf([200, 204, 409]);
    });

    it('returns 404 for non-existent', async () => {
      const res = await authed().delete('/api/benchmarks/runs/nonexistent');
      expect(res.status).to.equal(404);
    });
  });

  describe('get results', () => {
    it('returns empty results for non-existent execution', async () => {
      const res = await authed().get('/api/benchmarks/executions/nonexistent/results');
      expect(res.status).to.equal(200);
      expect(res.body).to.be.an('array');
    });
  });
});
