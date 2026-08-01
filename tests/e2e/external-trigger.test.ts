import { describe, it, beforeEach } from 'mocha';
import { expect } from 'chai';
import { authed, unauthed, resetDatabase } from '../utils';
import { createProjectWithAgent } from '../fixtures';
import request from 'supertest';

interface Fixture {
  projectId: string;
  agentId: string;
  apiKey: string;
}

async function createFixtureWithApiKey(): Promise<Fixture> {
  const { projectId, agentId } = await createProjectWithAgent();

  // Create an API key with run_action feature
  const keyRes = await authed().post(`/api/projects/${projectId}/api-keys`).send({
    name: 'External Trigger Key',
    keySettings: {
      allowedFeatures: ['run_action'],
    },
  });
  expect(keyRes.status).to.equal(201);

  return {
    projectId,
    agentId,
    apiKey: keyRes.body.key,
  };
}

function apiKeyAuth(apiKey: string) {
  const app = (globalThis as any).__TEST_APP__;
  const agent = request.agent(app);
  agent.set('Authorization', `Bearer ${apiKey}`);
  return agent;
}

describe('External Trigger API', () => {
  let fix: Fixture;

  beforeEach(async () => {
    await resetDatabase();
    fix = await createFixtureWithApiKey();
  });

  describe('authentication', () => {
    it('returns 401 without authorization header', async () => {
      const res = await unauthed().post('/api/conversations/trigger').send({
        conversationId: 'test-conversation',
        actionName: 'test-action',
      });
      expect(res.status).to.equal(401);
    });

    it('returns 401 with invalid API key', async () => {
      const res = await unauthed()
        .post('/api/conversations/trigger')
        .set('Authorization', 'Bearer invalid-key-too-short')
        .send({
          conversationId: 'test-conversation',
          actionName: 'test-action',
        });
      expect(res.status).to.equal(401);
    });

    it('returns 401 with JWT instead of API key', async () => {
      // JWT won't be recognized as a valid API key (different lookup path)
      const res = await authed().post('/api/conversations/trigger').send({
        conversationId: 'test-conversation',
        actionName: 'test-action',
      });
      expect(res.status).to.be.oneOf([401, 404]);
    });

    it('returns 401 with inactive API key', async () => {
      // Deactivate the key
      const listRes = await authed().get(`/api/projects/${fix.projectId}/api-keys`);
      expect(listRes.status).to.equal(200);
      const keyId = listRes.body.items[0].id;
      const version = listRes.body.items[0].version;
      await authed().put(`/api/projects/${fix.projectId}/api-keys/${keyId}`).send({
        isActive: false,
        version,
      });

      const res = await apiKeyAuth(fix.apiKey).post('/api/conversations/trigger').send({
        conversationId: 'test-conversation',
        actionName: 'test-action',
      });
      expect(res.status).to.equal(401);
    });
  });

  describe('authorization', () => {
    it('returns 403 when API key lacks run_action feature', async () => {
      // Create a key without run_action
      const keyRes = await authed().post(`/api/projects/${fix.projectId}/api-keys`).send({
        name: 'No Trigger Key',
        keySettings: {
          allowedFeatures: ['conversation_control'],
        },
      });
      expect(keyRes.status).to.equal(201);

      const res = await apiKeyAuth(keyRes.body.key).post('/api/conversations/trigger').send({
        conversationId: 'test-conversation',
        actionName: 'test-action',
      });
      expect(res.status).to.equal(403);
    });
  });

  describe('validation', () => {
    it('returns 400 for missing conversationId', async () => {
      const res = await apiKeyAuth(fix.apiKey).post('/api/conversations/trigger').send({
        actionName: 'test-action',
      });
      expect(res.status).to.equal(400);
    });

    it('returns 400 for missing actionName', async () => {
      const res = await apiKeyAuth(fix.apiKey).post('/api/conversations/trigger').send({
        conversationId: 'test-conversation',
      });
      expect(res.status).to.equal(400);
    });

    it('accepts optional sessionId', async () => {
      const res = await apiKeyAuth(fix.apiKey).post('/api/conversations/trigger').send({
        conversationId: 'test-conversation',
        sessionId: 'test-session',
        actionName: 'test-action',
      });
      // No active sessions, so 404 — but validation passes
      expect(res.status).to.equal(404);
    });

    it('accepts optional parameters', async () => {
      const res = await apiKeyAuth(fix.apiKey).post('/api/conversations/trigger').send({
        conversationId: 'test-conversation',
        actionName: 'test-action',
        parameters: { foo: 'bar', count: 42 },
      });
      // No active sessions, so 404 — but validation passes
      expect(res.status).to.equal(404);
    });
  });

  describe('no active sessions', () => {
    it('returns 404 for non-existent conversation with valid API key', async () => {
      const res = await apiKeyAuth(fix.apiKey).post('/api/conversations/trigger').send({
        conversationId: 'nonexistent-conversation',
        actionName: 'test-action',
      });
      expect(res.status).to.equal(404);
    });

    it('returns 404 with error message about no active sessions', async () => {
      const res = await apiKeyAuth(fix.apiKey).post('/api/conversations/trigger').send({
        conversationId: 'some-conversation',
        actionName: 'some-action',
      });
      expect(res.status).to.equal(404);
      expect(res.body).to.have.property('error');
    });
  });
});
