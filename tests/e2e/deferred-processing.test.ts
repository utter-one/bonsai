import { describe, it, beforeEach } from 'mocha';
import { expect } from 'chai';
import { authed, resetDatabase } from '../utils';
import { createProjectWithAgent } from '../fixtures';
import { db } from '../../src/db/index';
import { deferredProcessing } from '../../src/db/schema';

interface Fixture {
  projectId: string;
  agentId: string;
  providerId: string;
}

async function createFixtureWithProvider(): Promise<Fixture> {
  const { projectId, agentId } = await createProjectWithAgent();

  // Create a channel provider for deferred processing entries
  const providerRes = await authed().post('/api/providers').send({
    name: 'Test SMTP Provider',
    providerType: 'channel',
    apiType: 'smtp_imap',
    config: {
      fromAddress: 'test@example.com',
      smtp: { host: 'smtp.example.com', port: 587, auth: { user: 'test@example.com', pass: 'pass' } },
      imap: { host: 'imap.example.com', port: 993, auth: { user: 'test@example.com', pass: 'pass' } },
    },
  });
  expect(providerRes.status).to.equal(201);

  return { projectId, agentId, providerId: providerRes.body.id };
}

describe('Deferred Processing API', () => {
  let fix: Fixture;

  beforeEach(async () => {
    await resetDatabase();
    fix = await createFixtureWithProvider();
  });

  describe('list', () => {
    it('returns empty list', async () => {
      const res = await authed().get(`/api/projects/${fix.projectId}/deferred-processing`);
      expect(res.status).to.equal(200);
      expect(res.body.items).to.be.an('array').that.is.empty;
      expect(res.body.total).to.equal(0);
    });

    it('returns entries after direct DB insertion', async () => {
      await db.insert(deferredProcessing).values({
        id: `deferred_test_${Date.now()}`,
        sessionId: `session_test_${Date.now()}`,
        providerId: fix.providerId,
        projectId: fix.projectId,
        conversationId: null,
        channelType: 'smtp_imap',
        processAt: new Date(Date.now() + 60000),
        message: { send_user_text_input: { text: 'Hello' } },
        status: 'pending',
        retryCount: 0,
      });

      const res = await authed().get(`/api/projects/${fix.projectId}/deferred-processing`);
      expect(res.status).to.equal(200);
      expect(res.body.items).to.have.length(1);
      expect(res.body.total).to.equal(1);
    });

    it('filters by status', async () => {
      await db.insert(deferredProcessing).values({
        id: `deferred_pending_${Date.now()}`,
        sessionId: `session_test_${Date.now()}`,
        providerId: fix.providerId,
        projectId: fix.projectId,
        conversationId: null,
        channelType: 'smtp_imap',
        processAt: new Date(Date.now() + 60000),
        message: { send_user_text_input: { text: 'Hello' } },
        status: 'pending',
        retryCount: 0,
      });

      const res = await authed().get(`/api/projects/${fix.projectId}/deferred-processing?status=pending`);
      expect(res.status).to.equal(200);
      expect(res.body.items).to.have.length(1);
    });

    it('returns empty for filtered status with no matches', async () => {
      const res = await authed().get(`/api/projects/${fix.projectId}/deferred-processing?status=failed`);
      expect(res.status).to.equal(200);
      expect(res.body.items).to.be.an('array').that.is.empty;
    });

    it('respects offset/limit', async () => {
      for (let i = 0; i < 3; i++) {
        await db.insert(deferredProcessing).values({
          id: `deferred_pag_${i}_${Date.now()}`,
          sessionId: `session_test_${Date.now()}`,
          providerId: fix.providerId,
          projectId: fix.projectId,
          conversationId: null,
          channelType: 'smtp_imap',
          processAt: new Date(Date.now() + 60000),
          message: { send_user_text_input: { text: `Msg ${i}` } },
          status: 'pending',
          retryCount: 0,
        });
      }

      const res = await authed().get(`/api/projects/${fix.projectId}/deferred-processing?offset=1&limit=1`);
      expect(res.status).to.equal(200);
      expect(res.body.items).to.have.length(1);
      expect(res.body.total).to.equal(3);
    });

    it('filters by channelType', async () => {
      await db.insert(deferredProcessing).values({
        id: `deferred_smtp_${Date.now()}`,
        sessionId: `session_test_${Date.now()}`,
        providerId: fix.providerId,
        projectId: fix.projectId,
        conversationId: null,
        channelType: 'smtp_imap',
        processAt: new Date(Date.now() + 60000),
        message: { send_user_text_input: { text: 'Hello' } },
        status: 'pending',
        retryCount: 0,
      });

      const res = await authed().get(`/api/projects/${fix.projectId}/deferred-processing?channelType=smtp_imap`);
      expect(res.status).to.equal(200);
      expect(res.body.items).to.have.length(1);
    });
  });

  describe('get by id', () => {
    it('returns entry by ID', async () => {
      const entryId = `deferred_get_${Date.now()}`;
      await db.insert(deferredProcessing).values({
        id: entryId,
        sessionId: `session_test_${Date.now()}`,
        providerId: fix.providerId,
        projectId: fix.projectId,
        conversationId: null,
        channelType: 'smtp_imap',
        processAt: new Date(Date.now() + 60000),
        message: { send_user_text_input: { text: 'Hello' } },
        status: 'pending',
        retryCount: 0,
      });

      const res = await authed().get(`/api/projects/${fix.projectId}/deferred-processing/${entryId}`);
      expect(res.status).to.equal(200);
      expect(res.body.id).to.equal(entryId);
      expect(res.body.projectId).to.equal(fix.projectId);
      expect(res.body.channelType).to.equal('smtp_imap');
    });

    it('returns 404 for non-existent entry', async () => {
      const res = await authed().get(`/api/projects/${fix.projectId}/deferred-processing/nonexistent`);
      expect(res.status).to.equal(404);
    });

    it('returns 404 for entry belonging to another project', async () => {
      // Create a second project
      const otherProjectRes = await authed().post('/api/projects').send({
        name: 'Other Project',
        acceptVoice: false,
        generateVoice: false,
        sampleCopyConfig: {},
        recordingConfig: { enabled: false },
      });
      expect(otherProjectRes.status).to.equal(201);

      const entryId = `deferred_other_${Date.now()}`;
      await db.insert(deferredProcessing).values({
        id: entryId,
        sessionId: `session_test_${Date.now()}`,
        providerId: fix.providerId,
        projectId: otherProjectRes.body.id,
        conversationId: null,
        channelType: 'smtp_imap',
        processAt: new Date(Date.now() + 60000),
        message: { send_user_text_input: { text: 'Hello' } },
        status: 'pending',
        retryCount: 0,
      });

      const res = await authed().get(`/api/projects/${fix.projectId}/deferred-processing/${entryId}`);
      expect(res.status).to.equal(404);
    });
  });

  describe('reschedule', () => {
    it('reschedules a pending entry', async () => {
      const entryId = `deferred_resched_${Date.now()}`;
      const originalProcessAt = new Date(Date.now() + 300000); // 5 min from now
      await db.insert(deferredProcessing).values({
        id: entryId,
        sessionId: `session_test_${Date.now()}`,
        providerId: fix.providerId,
        projectId: fix.projectId,
        conversationId: null,
        channelType: 'smtp_imap',
        processAt: originalProcessAt,
        message: { send_user_text_input: { text: 'Hello' } },
        status: 'pending',
        retryCount: 0,
      });

      const newProcessAt = new Date(Date.now() + 600000); // 10 min from now
      const res = await authed().post(`/api/projects/${fix.projectId}/deferred-processing/${entryId}/reschedule`).send({
        processAt: newProcessAt.toISOString(),
      });
      expect(res.status).to.equal(200);
      expect(res.body.id).to.equal(entryId);
    });

    it('accepts a past date to trigger immediate processing', async () => {
      const entryId = `deferred_immed_${Date.now()}`;
      await db.insert(deferredProcessing).values({
        id: entryId,
        sessionId: `session_test_${Date.now()}`,
        providerId: fix.providerId,
        projectId: fix.projectId,
        conversationId: null,
        channelType: 'smtp_imap',
        processAt: new Date(Date.now() + 300000),
        message: { send_user_text_input: { text: 'Hello' } },
        status: 'pending',
        retryCount: 0,
      });

      const pastDate = new Date(Date.now() - 1000);
      const res = await authed().post(`/api/projects/${fix.projectId}/deferred-processing/${entryId}/reschedule`).send({
        processAt: pastDate.toISOString(),
      });
      expect(res.status).to.equal(200);
    });

    it('returns 404 for non-existent entry', async () => {
      const res = await authed().post(`/api/projects/${fix.projectId}/deferred-processing/nonexistent/reschedule`).send({
        processAt: new Date().toISOString(),
      });
      expect(res.status).to.equal(404);
    });

    it('returns 400 for missing processAt', async () => {
      const entryId = `deferred_bad_${Date.now()}`;
      await db.insert(deferredProcessing).values({
        id: entryId,
        sessionId: `session_test_${Date.now()}`,
        providerId: fix.providerId,
        projectId: fix.projectId,
        conversationId: null,
        channelType: 'smtp_imap',
        processAt: new Date(Date.now() + 60000),
        message: { send_user_text_input: { text: 'Hello' } },
        status: 'pending',
        retryCount: 0,
      });

      const res = await authed().post(`/api/projects/${fix.projectId}/deferred-processing/${entryId}/reschedule`).send({});
      expect(res.status).to.equal(400);
    });
  });

  describe('cancel', () => {
    it('cancels a pending entry', async () => {
      const entryId = `deferred_cancel_${Date.now()}`;
      await db.insert(deferredProcessing).values({
        id: entryId,
        sessionId: `session_test_${Date.now()}`,
        providerId: fix.providerId,
        projectId: fix.projectId,
        conversationId: null,
        channelType: 'smtp_imap',
        processAt: new Date(Date.now() + 60000),
        message: { send_user_text_input: { text: 'Hello' } },
        status: 'pending',
        retryCount: 0,
      });

      const res = await authed().post(`/api/projects/${fix.projectId}/deferred-processing/${entryId}/cancel`).send({});
      expect(res.status).to.equal(200);
      expect(res.body.id).to.equal(entryId);
    });

    it('returns 404 for non-existent entry', async () => {
      const res = await authed().post(`/api/projects/${fix.projectId}/deferred-processing/nonexistent/cancel`).send({});
      expect(res.status).to.equal(404);
    });

    it('returns 404 for entry belonging to another project', async () => {
      // Create a second project
      const otherProjectRes = await authed().post('/api/projects').send({
        name: 'Other Project',
        acceptVoice: false,
        generateVoice: false,
        sampleCopyConfig: {},
        recordingConfig: { enabled: false },
      });
      expect(otherProjectRes.status).to.equal(201);

      const entryId = `deferred_cancel_other_${Date.now()}`;
      await db.insert(deferredProcessing).values({
        id: entryId,
        sessionId: `session_test_${Date.now()}`,
        providerId: fix.providerId,
        projectId: otherProjectRes.body.id,
        conversationId: null,
        channelType: 'smtp_imap',
        processAt: new Date(Date.now() + 60000),
        message: { send_user_text_input: { text: 'Hello' } },
        status: 'pending',
        retryCount: 0,
      });

      const res = await authed().post(`/api/projects/${fix.projectId}/deferred-processing/${entryId}/cancel`).send({});
      expect(res.status).to.equal(404);
    });
  });
});
