import { describe, it, beforeEach } from 'mocha';
import { expect } from 'chai';
import { authed, resetDatabase } from '../utils';
import { createProjectWithAgent } from '../fixtures';
import { db } from '../../src/db/index';
import { conversations, conversationEvents } from '../../src/db/schema';

interface ConversationFixture {
  projectId: string;
  agentId: string;
  stageId: string;
  userId: string;
  conversationId: string;
}

async function createConversationFixture(): Promise<ConversationFixture> {
  const { projectId, agentId } = await createProjectWithAgent();

  // Create an LLM provider for the stage
  const llmProviderRes = await authed().post('/api/providers').send({
    name: 'Test LLM',
    providerType: 'llm',
    apiType: 'openai',
    config: { apiKey: 'sk-test-key-123' },
  });
  expect(llmProviderRes.status).to.equal(201);

  // Create a stage
  const stageRes = await authed().post(`/api/projects/${projectId}/stages`).send({
    name: 'Test Stage',
    agentId,
    prompt: 'You are a helpful assistant.',
    llmProviderId: llmProviderRes.body.id,
    llmSettings: { model: 'gpt-4o' },
  });
  expect(stageRes.status).to.equal(201);

  // Create a user (required for conversations)
  const userRes = await authed().post(`/api/projects/${projectId}/users`).send({
    profile: { name: 'Test User' },
  });
  expect(userRes.status).to.equal(201);

  // Insert a conversation directly via DB (create endpoint is not exposed)
  const conversationId = `conv_test_${Date.now()}`;
  await db.insert(conversations).values({
    id: conversationId,
    projectId,
    userId: userRes.body.id,
    sessionId: `session_test_${Date.now()}`,
    stageId: stageRes.body.id,
    startingStageId: stageRes.body.id,
    status: 'initialized',
    direction: 'incoming',
  });

  return {
    projectId,
    agentId,
    stageId: stageRes.body.id,
    userId: userRes.body.id,
    conversationId,
  };
}

describe('Conversation API', () => {
  let fix: ConversationFixture;

  beforeEach(async () => {
    await resetDatabase();
    fix = await createConversationFixture();
  });

  describe('list', () => {
    it('returns conversations after creation', async () => {
      const res = await authed().get(`/api/projects/${fix.projectId}/conversations`);
      expect(res.status).to.equal(200);
      expect(res.body.items).to.have.length.greaterThanOrEqual(1);
    });

    it('respects pagination params', async () => {
      const res = await authed().get(`/api/projects/${fix.projectId}/conversations?offset=0&limit=10`);
      expect(res.status).to.equal(200);
      expect(res.body.offset).to.equal(0);
    });

    it('respects offset/limit with multiple conversations', async () => {
      // Insert additional conversations
      for (let i = 0; i < 2; i++) {
        await db.insert(conversations).values({
          id: `conv_extra_${i}`,
          projectId: fix.projectId,
          userId: fix.userId,
          sessionId: `session_extra_${i}`,
          stageId: fix.stageId,
          startingStageId: fix.stageId,
          status: 'initialized',
          direction: 'incoming',
        });
      }

      const res = await authed().get(`/api/projects/${fix.projectId}/conversations?offset=1&limit=1`);
      expect(res.status).to.equal(200);
      expect(res.body.items).to.have.length(1);
    });
  });

  describe('get by id', () => {
    it('returns conversation by ID', async () => {
      const res = await authed().get(`/api/projects/${fix.projectId}/conversations/${fix.conversationId}`);
      expect(res.status).to.equal(200);
      expect(res.body.id).to.equal(fix.conversationId);
      expect(res.body.projectId).to.equal(fix.projectId);
      expect(res.body.userId).to.equal(fix.userId);
      expect(res.body.stageId).to.equal(fix.stageId);
    });

    it('returns 404 for non-existent', async () => {
      const res = await authed().get(`/api/projects/${fix.projectId}/conversations/nonexistent`);
      expect(res.status).to.equal(404);
    });
  });

  describe('events', () => {
    it('returns empty events for conversation without events', async () => {
      const res = await authed().get(`/api/projects/${fix.projectId}/conversations/${fix.conversationId}/events`);
      expect(res.status).to.equal(200);
      expect(res.body.items).to.be.an('array');
    });

    it('returns events after insertion', async () => {
      // Insert a conversation event directly via DB
      const eventId = `event_test_${Date.now()}`;
      await db.insert(conversationEvents).values({
        id: eventId,
        projectId: fix.projectId,
        conversationId: fix.conversationId,
        eventType: 'message',
        eventData: { role: 'user', text: 'Hello!', originalText: 'Hello!' },
        timestamp: new Date(),
      });

      const res = await authed().get(`/api/projects/${fix.projectId}/conversations/${fix.conversationId}/events`);
      expect(res.status).to.equal(200);
      expect(res.body.items).to.have.length.greaterThanOrEqual(1);
    });

    it('returns event by ID', async () => {
      const eventId = `event_by_id_${Date.now()}`;
      await db.insert(conversationEvents).values({
        id: eventId,
        projectId: fix.projectId,
        conversationId: fix.conversationId,
        eventType: 'message',
        eventData: { role: 'user', text: 'Find me!', originalText: 'Find me!' },
        timestamp: new Date(),
      });

      const res = await authed().get(`/api/projects/${fix.projectId}/conversations/${fix.conversationId}/events/${eventId}`);
      expect(res.status).to.equal(200);
      expect(res.body.id).to.equal(eventId);
    });

    it('returns 404 for non-existent conversation events', async () => {
      const res = await authed().get(`/api/projects/${fix.projectId}/conversations/nonexistent/events`);
      expect(res.status).to.equal(404);
    });

    it('returns 404 for non-existent event', async () => {
      const res = await authed().get(`/api/projects/${fix.projectId}/conversations/${fix.conversationId}/events/nonexistent`);
      expect(res.status).to.equal(404);
    });
  });

  describe('artifacts', () => {
    it('returns empty artifacts for conversation without artifacts', async () => {
      const res = await authed().get(`/api/projects/${fix.projectId}/conversations/${fix.conversationId}/artifacts`);
      expect(res.status).to.equal(200);
      expect(res.body.items).to.be.an('array');
    });

    it('returns 404 for non-existent conversation artifacts', async () => {
      const res = await authed().get(`/api/projects/${fix.projectId}/conversations/nonexistent/artifacts`);
      expect(res.status).to.equal(404);
    });

    it('returns 404 for non-existent artifact', async () => {
      const res = await authed().get(`/api/projects/${fix.projectId}/conversations/${fix.conversationId}/artifacts/nonexistent`);
      expect(res.status).to.equal(404);
    });

    it('returns 404 for artifact download', async () => {
      const res = await authed().get(`/api/projects/${fix.projectId}/conversations/${fix.conversationId}/artifacts/nonexistent/download`);
      expect(res.status).to.equal(404);
    });
  });

  describe('audit logs', () => {
    it('returns empty array for conversation without audit logs', async () => {
      const res = await authed().get(`/api/projects/${fix.projectId}/conversations/${fix.conversationId}/audit-logs`);
      expect(res.status).to.equal(200);
      expect(res.body).to.be.an('array');
    });

    it('returns empty array for non-existent conversation', async () => {
      const res = await authed().get(`/api/projects/${fix.projectId}/conversations/nonexistent/audit-logs`);
      expect(res.status).to.equal(200);
      expect(res.body).to.be.an('array').that.is.empty;
    });
  });

  describe('delete', () => {
    it('deletes an existing conversation', async () => {
      const res = await authed().delete(`/api/projects/${fix.projectId}/conversations/${fix.conversationId}`);
      expect(res.status).to.be.oneOf([200, 204]);

      const getRes = await authed().get(`/api/projects/${fix.projectId}/conversations/${fix.conversationId}`);
      expect(getRes.status).to.equal(404);
    });

    it('returns 404 for non-existent', async () => {
      const res = await authed().delete(`/api/projects/${fix.projectId}/conversations/nonexistent`);
      expect(res.status).to.equal(404);
    });
  });
});
