import { describe, it, before, beforeEach } from 'mocha';
import { expect } from 'chai';
import request from 'supertest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, type Server } from 'node:http';
import { authed, unauthed, resetDatabase } from '../utils';
import { setChannelApiBaseForTests, resetChannelApiBasesForTests } from '../../src/services/providers/connectionTest/channelStrategy';

const app = () => (globalThis as any).__TEST_APP__;

/**
 * Bind an ephemeral port and release it, so the returned base URL is a dead
 * endpoint (ECONNREFUSED) — a deterministic "network" failure with no vendor.
 */
async function deadBaseUrl(): Promise<string> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return `http://127.0.0.1:${port}`;
}

/** Create an operator with the given role(s) and return their JWT access token. */
async function createOperatorWithRole(roles: string[]): Promise<string> {
  const operatorId = `conn-test-${roles.join('+')}@example.com`;
  const createRes = await authed()
    .post('/api/operators')
    .send({ id: operatorId, name: `ConnTest ${roles.join('+')}`, roles, password: 'connpassword123' });
  if (createRes.status !== 201 && createRes.status !== 409) {
    throw new Error(`Failed to create operator: ${createRes.status} ${JSON.stringify(createRes.body)}`);
  }
  const loginRes = await unauthed().post('/api/auth/login').send({ id: operatorId, password: 'connpassword123' });
  expect(loginRes.status).to.equal(200);
  return loginRes.body.accessToken;
}

function tokenAgent(token: string) {
  const agent = request.agent(app());
  agent.set('Authorization', `Bearer ${token}`);
  return agent;
}

/** Create a saved provider row via the API and return its id (fresh id per call → unique cooldown key). */
async function createSavedProvider(body: { name: string; providerType: string; apiType: string; config: Record<string, unknown> }): Promise<string> {
  const res = await authed().post('/api/providers').send(body);
  expect(res.status).to.equal(201);
  return res.body.id as string;
}

async function freshTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'bonsai-conn-test-'));
}

describe('Provider connection test API (TPC-06)', () => {
  let supportAgent: ReturnType<typeof request.agent>;

  before(async () => {
    // The `support` role is the one without `provider:read` (viewer HAS it),
    // so it is the role that exercises the 403 RBAC path.
    supportAgent = tokenAgent(await createOperatorWithRole(['support']));
  });

  beforeEach(async () => {
    await resetDatabase();
  });

  describe('saved mode', () => {
    it('saved storage/local (temp dir) → 200 ok:true, protocol local-fs', async () => {
      const basePath = await freshTempDir();
      const id = await createSavedProvider({ name: 'Local Storage', providerType: 'storage', apiType: 'local', config: { basePath } });
      const res = await authed().post('/api/providers/test-connection').send({ providerId: id });
      expect(res.status).to.equal(200);
      expect(res.body.ok).to.equal(true);
      expect(res.body.providerType).to.equal('storage');
      expect(res.body.apiType).to.equal('local');
      expect(res.body.protocol).to.equal('local-fs');
      expect(res.body.phase).to.equal('first-data');
      expect(res.body.errorCode).to.equal(null);
      expect(res.body.latencyMs).to.be.a('number');
      await rm(basePath, { recursive: true, force: true });
    });

    it('saved llm/ollama against a dead port → 200 ok:false, errorCode network (never 500)', async () => {
      const baseUrl = await deadBaseUrl();
      const id = await createSavedProvider({ name: 'Ollama', providerType: 'llm', apiType: 'ollama', config: { baseUrl } });
      // Explicit model: skips the (failing) catalog enumeration on a dead port and
      // goes straight to the inference call, which is where the network error surfaces.
      const res = await authed().post('/api/providers/test-connection').send({ providerId: id, model: 'llama3' });
      expect(res.status).to.equal(200);
      expect(res.body.ok).to.equal(false);
      expect(res.body.errorCode).to.equal('network');
      expect(res.body.providerType).to.equal('llm');
    });

    it('non-existent providerId → 404', async () => {
      const res = await authed().post('/api/providers/test-connection').send({ providerId: 'prov_does_not_exist' });
      expect(res.status).to.equal(404);
    });

    it('rapid second call within 5 s → 429 with a Retry-After header', async () => {
      const basePath = await freshTempDir();
      const id = await createSavedProvider({ name: 'Local Storage', providerType: 'storage', apiType: 'local', config: { basePath } });
      const first = await authed().post('/api/providers/test-connection').send({ providerId: id });
      expect(first.status).to.equal(200);
      const second = await authed().post('/api/providers/test-connection').send({ providerId: id });
      expect(second.status).to.equal(429);
      expect(second.headers['retry-after']).to.be.a('string');
      await rm(basePath, { recursive: true, force: true });
    });

    it('saved test → audit row CONNECTION_TEST present with the result', async () => {
      const basePath = await freshTempDir();
      const id = await createSavedProvider({ name: 'Local Storage', providerType: 'storage', apiType: 'local', config: { basePath } });
      const res = await authed().post('/api/providers/test-connection').send({ providerId: id });
      expect(res.status).to.equal(200);

      const auditRes = await authed().get(`/api/providers/${id}/audit-logs`);
      expect(auditRes.status).to.equal(200);
      const row = auditRes.body.find((log: { action: string }) => log.action === 'CONNECTION_TEST');
      expect(row, 'expected a CONNECTION_TEST audit row').to.exist;
      expect(row.newEntity.ok).to.equal(true);
      expect(row.newEntity.providerType).to.equal('storage');
      await rm(basePath, { recursive: true, force: true });
    });
  });

  describe('channel (TPC-08)', () => {
    let server: Server;
    let baseUrl: string;

    before(async () => {
      // A local fake Telegram Bot API returning 401 for getMe (a well-formed
      // but invalid token). No real network — CI-safe.
      server = createServer((req, res) => {
        if (req.method === 'GET' && (req.url ?? '').includes('/getMe')) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error_code: 401, description: 'Unauthorized' }));
          return;
        }
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end('{}');
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      baseUrl = `http://127.0.0.1:${port}`;
    });

    after(async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    beforeEach(() => {
      // Point the app-world channel strategy at the local fake. The seam is
      // globalThis-backed so it crosses the tsx/ESM-vs-CJS module graph boundary.
      resetChannelApiBasesForTests();
      setChannelApiBaseForTests('telegram', baseUrl);
    });

    afterEach(() => {
      resetChannelApiBasesForTests();
    });

    it('saved telegram (bogus token, local fake 401) → 200 ok:false, errorCode auth, protocol http', async () => {
      const id = await createSavedProvider({ name: 'Telegram', providerType: 'channel', apiType: 'telegram', config: { botToken: '123:abc' } });
      const res = await authed().post('/api/providers/test-connection').send({ providerId: id });
      expect(res.status).to.equal(200);
      expect(res.body.ok).to.equal(false);
      expect(res.body.errorCode).to.equal('auth');
      expect(res.body.providerType).to.equal('channel');
      expect(res.body.apiType).to.equal('telegram');
      expect(res.body.protocol).to.equal('http');
      expect(res.body.phase).to.equal('auth');
    });

    it('draft telegram (bogus token, local fake 401) → 200 ok:false, errorCode auth (no saved row)', async () => {
      const res = await authed()
        .post('/api/providers/test-connection')
        .send({ providerType: 'channel', apiType: 'telegram', config: { botToken: '123:abc' } });
      expect(res.status).to.equal(200);
      expect(res.body.ok).to.equal(false);
      expect(res.body.errorCode).to.equal('auth');
      expect(res.body.providerType).to.equal('channel');
    });
  });

  describe('draft mode', () => {
    it('draft LLM without model → 400 (no saved row to enumerate a default from)', async () => {
      const res = await authed()
        .post('/api/providers/test-connection')
        .send({ providerType: 'llm', apiType: 'ollama', config: { baseUrl: 'http://127.0.0.1:11434' } });
      expect(res.status).to.equal(400);
    });

    it('draft ElevenLabs TTS without a voice → 400 (no safe default voice — the guard, not a vendor failure)', async () => {
      const res = await authed()
        .post('/api/providers/test-connection')
        .send({ providerType: 'tts', apiType: 'elevenlabs', config: { apiKey: 'bogus-key' } });
      expect(res.status).to.equal(400);
      expect(res.body.error).to.include('voice');
    });

    it('draft with an invalid config → 400 (create-schema validation)', async () => {
      // `ollama` config is a strictObject with only baseUrl/apiKey — `bogus` fails the union.
      const res = await authed()
        .post('/api/providers/test-connection')
        .send({ providerType: 'llm', apiType: 'ollama', config: { bogus: true } });
      expect(res.status).to.equal(400);
    });

    it('draft test → 200 ok:true and NO audit row (drafts are never persisted)', async () => {
      const basePath = await freshTempDir();
      const res = await authed()
        .post('/api/providers/test-connection')
        .send({ providerType: 'storage', apiType: 'local', config: { basePath } });
      expect(res.status).to.equal(200);
      expect(res.body.ok).to.equal(true);

      const auditRes = await authed().get('/api/audit-logs?filters[action]=CONNECTION_TEST&limit=100');
      expect(auditRes.status).to.equal(200);
      const rows = Array.isArray(auditRes.body) ? auditRes.body : auditRes.body.items;
      expect(rows, 'expected no CONNECTION_TEST audit rows for a draft test').to.have.length(0);
      await rm(basePath, { recursive: true, force: true });
    });
  });

  describe('payload validation', () => {
    it('both providerId and draft fields → 400 (saved XOR draft)', async () => {
      const res = await authed()
        .post('/api/providers/test-connection')
        .send({ providerId: 'prov_x', providerType: 'llm', apiType: 'ollama', config: { baseUrl: 'http://127.0.0.1:11434' } });
      expect(res.status).to.equal(400);
    });

    it('neither mode → 400', async () => {
      const res = await authed().post('/api/providers/test-connection').send({});
      expect(res.status).to.equal(400);
    });

    it('unsupported providerType → 400', async () => {
      const res = await authed()
        .post('/api/providers/test-connection')
        .send({ providerType: 'embeddings', apiType: 'openai', config: { apiKey: 'sk-x' } });
      expect(res.status).to.equal(400);
    });
  });

  describe('RBAC', () => {
    it('support role (no provider:read) → 403', async () => {
      const basePath = await freshTempDir();
      const res = await supportAgent
        .post('/api/providers/test-connection')
        .send({ providerType: 'storage', apiType: 'local', config: { basePath } });
      expect(res.status).to.equal(403);
      await rm(basePath, { recursive: true, force: true });
    });

    it('super_admin (has provider:read) → 200', async () => {
      const basePath = await freshTempDir();
      const res = await authed()
        .post('/api/providers/test-connection')
        .send({ providerType: 'storage', apiType: 'local', config: { basePath } });
      expect(res.status).to.equal(200);
      await rm(basePath, { recursive: true, force: true });
    });
  });
});
