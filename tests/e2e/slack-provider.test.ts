import { describe, it, beforeEach } from 'mocha';
import { expect } from 'chai';
import { createHmac } from 'crypto';
import request from 'supertest';
import { authed, unauthed, resetDatabase } from '../utils';
import { createProjectWithAgent } from '../fixtures';

const SIGNING_SECRET = 'test-slack-signing-secret-0123456789';
const BOT_TOKEN = 'xoxb-test-bot-token';

function minimalSlackProvider() {
  return {
    name: 'Test Slack Provider',
    providerType: 'channel',
    apiType: 'slack',
    config: { botToken: BOT_TOKEN, signingSecret: SIGNING_SECRET },
  };
}

interface Fixture {
  projectId: string;
  agentId: string;
  apiKey: string;
  providerId: string;
}

async function createFixture(): Promise<Fixture> {
  const { projectId, agentId } = await createProjectWithAgent();

  const keyRes = await authed().post(`/api/projects/${projectId}/api-keys`).send({
    name: 'Slack Key',
    keySettings: { allowedFeatures: ['conversation_control', 'text_input'] },
  });
  expect(keyRes.status).to.equal(201);

  const providerRes = await authed().post('/api/providers').send(minimalSlackProvider());
  expect(providerRes.status).to.equal(201);

  return { projectId, agentId, apiKey: keyRes.body.key, providerId: providerRes.body.id };
}

/**
 * Sends a Slack-signed POST request. The HMAC is computed over the exact raw
 * JSON body that is sent, matching the host's signature verification.
 */
function signedWebhook(fix: Fixture, body: Record<string, unknown>, overrides: { signature?: string; timestamp?: string; apiKey?: string; channelProviderId?: string } = {}) {
  const app = (globalThis as any).__TEST_APP__;
  const apiKey = overrides.apiKey ?? fix.apiKey;
  const channelProviderId = overrides.channelProviderId ?? fix.providerId;
  const rawBody = JSON.stringify(body);
  const timestamp = overrides.timestamp ?? String(Math.floor(Date.now() / 1000));
  const baseString = `v0:${timestamp}:${rawBody}`;
  const expectedSignature = `v0=${createHmac('sha256', SIGNING_SECRET).update(baseString).digest('hex')}`;
  const signature = overrides.signature ?? expectedSignature;

  return request(app)
    .post(`/api/slack/webhook?apiKey=${apiKey}&channelProviderId=${channelProviderId}`)
    .set('Content-Type', 'application/json')
    .set('X-Slack-Request-Timestamp', timestamp)
    .set('X-Slack-Signature', signature)
    .send(rawBody);
}

describe('Slack Provider API', () => {
  let fix: Fixture;

  beforeEach(async () => {
    await resetDatabase();
    fix = await createFixture();
  });

  describe('create', () => {
    it('creates a slack channel provider', async () => {
      const res = await authed().post('/api/providers').send(minimalSlackProvider());
      expect(res.status).to.equal(201);
      expect(res.body.id).to.be.a('string');
      expect(res.body.version).to.equal(1);
      expect(res.body.apiType).to.equal('slack');
      // Sensitive fields are stored as secret references, not plaintext
      expect(res.body.config.botToken).to.match(/^@sec:/);
      expect(res.body.config.botToken).to.not.equal(BOT_TOKEN);
      expect(res.body.config.signingSecret).to.match(/^@sec:/);
      expect(res.body.config.signingSecret).to.not.equal(SIGNING_SECRET);
    });

    it('rejects config missing signingSecret (400)', async () => {
      const res = await authed().post('/api/providers').send({
        name: 'Broken Slack',
        providerType: 'channel',
        apiType: 'slack',
        config: { botToken: BOT_TOKEN },
      });
      expect(res.status).to.equal(400);
    });

    it('rejects config missing botToken (400)', async () => {
      const res = await authed().post('/api/providers').send({
        name: 'Broken Slack',
        providerType: 'channel',
        apiType: 'slack',
        config: { signingSecret: SIGNING_SECRET },
      });
      expect(res.status).to.equal(400);
    });

    it('rejects config with unknown field (400)', async () => {
      const res = await authed().post('/api/providers').send({
        ...minimalSlackProvider(),
        config: { botToken: BOT_TOKEN, signingSecret: SIGNING_SECRET, extra: 'nope' },
      });
      expect(res.status).to.equal(400);
    });

    it('applies default processing delays (0)', async () => {
      const res = await authed().post('/api/providers').send(minimalSlackProvider());
      expect(res.status).to.equal(201);
      expect(res.body.config.processingDelayMinMs).to.equal(0);
      expect(res.body.config.processingDelayMaxMs).to.equal(0);
    });

    it('defaults mode to events_api when omitted', async () => {
      const res = await authed().post('/api/providers').send(minimalSlackProvider());
      expect(res.status).to.equal(201);
      expect(res.body.config.mode).to.equal('events_api');
    });
  });

  describe('socket mode config', () => {
    it('creates a socket-mode provider, secretizing appToken but storing projectId plainly', async () => {
      const appToken = 'xapp-test-app-token';
      const res = await authed().post('/api/providers').send({
        name: 'Test Slack Socket Provider',
        providerType: 'channel',
        apiType: 'slack',
        config: { mode: 'socket_mode', botToken: BOT_TOKEN, signingSecret: SIGNING_SECRET, appToken, projectId: fix.projectId },
      });
      expect(res.status).to.equal(201);
      expect(res.body.config.mode).to.equal('socket_mode');
      expect(res.body.config.appToken).to.match(/^@sec:/);
      expect(res.body.config.appToken).to.not.equal(appToken);
      // projectId is not a secret: stored and returned as-is
      expect(res.body.config.projectId).to.equal(fix.projectId);
    });

    it('returns a socket-mode provider with mode and projectId intact on get by id', async () => {
      const createRes = await authed().post('/api/providers').send({
        name: 'Test Slack Socket Provider 2',
        providerType: 'channel',
        apiType: 'slack',
        config: { mode: 'socket_mode', botToken: BOT_TOKEN, signingSecret: SIGNING_SECRET, appToken: 'xapp-2', projectId: fix.projectId },
      });
      expect(createRes.status).to.equal(201);
      const getRes = await authed().get(`/api/providers/${createRes.body.id}`);
      expect(getRes.status).to.equal(200);
      expect(getRes.body.config.mode).to.equal('socket_mode');
      expect(getRes.body.config.projectId).to.equal(fix.projectId);
    });

    it('rejects a socket-mode provider missing projectId (400)', async () => {
      const res = await authed().post('/api/providers').send({
        name: 'Broken Slack Socket',
        providerType: 'channel',
        apiType: 'slack',
        config: { mode: 'socket_mode', botToken: BOT_TOKEN, signingSecret: SIGNING_SECRET, appToken: 'xapp-broken' },
      });
      expect(res.status).to.equal(400);
    });

    it('rejects a socket-mode provider with a non-existent projectId (400)', async () => {
      const res = await authed().post('/api/providers').send({
        name: 'Broken Slack Socket',
        providerType: 'channel',
        apiType: 'slack',
        config: { mode: 'socket_mode', botToken: BOT_TOKEN, signingSecret: SIGNING_SECRET, appToken: 'xapp-broken', projectId: 'proj_does_not_exist' },
      });
      expect(res.status).to.equal(400);
    });

    it('rejects a socket-mode provider pointing at an archived project (400)', async () => {
      const projectRes = await authed().post('/api/projects').send({ name: 'Archived Project', acceptVoice: false, generateVoice: false, sampleCopyConfig: {}, recordingConfig: { enabled: false } });
      expect(projectRes.status).to.equal(201);
      const archiveRes = await authed().post(`/api/projects/${projectRes.body.id}/archive`).send({ version: projectRes.body.version });
      expect(archiveRes.status).to.equal(200);
      const res = await authed().post('/api/providers').send({
        name: 'Broken Slack Socket',
        providerType: 'channel',
        apiType: 'slack',
        config: { mode: 'socket_mode', botToken: BOT_TOKEN, signingSecret: SIGNING_SECRET, appToken: 'xapp-broken', projectId: projectRes.body.id },
      });
      expect(res.status).to.equal(400);
    });
  });

  describe('get by id', () => {
    it('returns provider by ID', async () => {
      const res = await authed().get(`/api/providers/${fix.providerId}`);
      expect(res.status).to.equal(200);
      expect(res.body.id).to.equal(fix.providerId);
      expect(res.body.apiType).to.equal('slack');
    });

    it('returns 404 for non-existent', async () => {
      const res = await authed().get('/api/providers/nonexistent');
      expect(res.status).to.equal(404);
    });
  });

  describe('delete', () => {
    it('deletes a slack provider', async () => {
      const res = await authed().delete(`/api/providers/${fix.providerId}`).send({ version: 1 });
      expect(res.status).to.be.oneOf([200, 204]);
      const getRes = await authed().get(`/api/providers/${fix.providerId}`);
      expect(getRes.status).to.equal(404);
    });
  });

  describe('audit logs', () => {
    it('returns audit logs after creation', async () => {
      const res = await authed().get(`/api/providers/${fix.providerId}/audit-logs`);
      expect(res.status).to.equal(200);
      expect(res.body).to.be.an('array');
      expect(res.body.length).to.be.greaterThanOrEqual(1);
    });
  });

  describe('channel catalog', () => {
    it('lists the slack channel', async () => {
      const res = await authed().get('/api/channel-catalog');
      expect(res.status).to.equal(200);
      const types = res.body.channels.map((c: { type: string }) => c.type);
      expect(types).to.include('slack');
    });

    it('returns slack channel by type', async () => {
      const res = await authed().get('/api/channel-catalog/slack');
      expect(res.status).to.equal(200);
      expect(res.body.type).to.equal('slack');
      expect(res.body.capabilities.supportsTextInput).to.equal(true);
      expect(res.body.capabilities.supportsTextOutput).to.equal(true);
      expect(res.body.capabilities.supportsCommands).to.equal(false);
    });
  });

  describe('provider catalog', () => {
    it('lists the slack api type under channel providers', async () => {
      const res = await authed().get('/api/provider-catalog/channel');
      expect(res.status).to.equal(200);
      const apiTypes = res.body.providers.map((p: { apiType: string }) => p.apiType);
      expect(apiTypes).to.include('slack');
    });
  });

  describe('webhook security', () => {
    it('echoes the url_verification challenge with a valid signature', async () => {
      const res = await signedWebhook(fix, { type: 'url_verification', challenge: 'challenge-abc-123' });
      expect(res.status).to.equal(200);
      expect(res.body.challenge).to.equal('challenge-abc-123');
    });

    it('returns 401 for an invalid signature', async () => {
      const res = await signedWebhook(fix, { type: 'url_verification', challenge: 'challenge-abc-123' }, { signature: 'v0=deadbeef' });
      expect(res.status).to.equal(401);
    });

    it('returns 401 for a stale timestamp', async () => {
      const stale = String(Math.floor(Date.now() / 1000) - 600);
      const res = await signedWebhook(fix, { type: 'url_verification', challenge: 'challenge-abc-123' }, { timestamp: stale });
      expect(res.status).to.equal(401);
    });

    it('returns 401 for an invalid api key', async () => {
      const res = await signedWebhook(fix, { type: 'url_verification', challenge: 'x' }, { apiKey: 'not-a-real-key' });
      expect(res.status).to.equal(401);
    });

    it('returns 400 for a missing channelProviderId', async () => {
      const res = await unauthed()
        .post('/api/slack/webhook?apiKey=whatever')
        .send('{}');
      expect(res.status).to.equal(400);
    });

    it('returns 400 when the provider is not a slack channel provider', async () => {
      // Create a telegram provider and point the slack webhook query at it.
      const tgRes = await authed().post('/api/providers').send({
        name: 'Test Telegram Provider',
        providerType: 'channel',
        apiType: 'telegram',
        config: { botToken: '123:ABC' },
      });
      expect(tgRes.status).to.equal(201);
      const res = await signedWebhook(fix, { type: 'url_verification', challenge: 'x' }, { channelProviderId: tgRes.body.id });
      expect(res.status).to.equal(400);
    });

    it('ignores non-message event_callback payloads (200 no-op)', async () => {
      const res = await signedWebhook(fix, {
        type: 'event_callback',
        event_id: 'Ev123',
        event: { type: 'reaction_added', user: 'U123', item_user: 'U123', reaction: 'thumbsup', item: { type: 'message', channel: 'C123', ts: '111.222' }, ts: '111.333' },
      });
      expect(res.status).to.equal(200);
    });
  });
});
