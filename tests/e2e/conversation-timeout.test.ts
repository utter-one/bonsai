import { describe, it, beforeEach } from 'mocha';
import { expect } from 'chai';
import { and, eq } from 'drizzle-orm';
import { authed, resetDatabase } from '../utils';
import { db } from '../../src/db/index';
import { conversations, conversationEvents, globalActions } from '../../src/db/schema';
import type { Effect } from '../../src/types/actions';

const TIMEOUT_REASON = 'Conversation timed out due to inactivity';

type TimeoutSweeper = { processTimeouts(): Promise<void> };

/** App-world sweeper: the cron is minute-granular, so tests drive one pass explicitly. */
const sweeper = (): TimeoutSweeper => (globalThis as any).__TEST_CONVERSATION_TIMEOUT_SERVICE__ as TimeoutSweeper;

type FixtureOptions = {
  /** projects.conversation_timeout_seconds — 'disabled' omits the field so the column stays null */
  timeout?: number | 'disabled';
  status?: 'initialized' | 'awaiting_user_input' | 'finished';
  /** How far back to date last_activity_at */
  idleForMs?: number;
  stageVars?: Record<string, Record<string, any>>;
};

type Fixture = {
  projectId: string;
  agentId: string;
  stageId: string;
  userId: string;
  conversationId: string;
};

let counter = 0;

/** Project + agent + stage + user + a conversation dated `idleForMs` into the past. */
async function createFixture(options: FixtureOptions = {}): Promise<Fixture> {
  const { timeout: timeoutSeconds = 60, status = 'awaiting_user_input', idleForMs = 10 * 60 * 1000, stageVars } = options;

  const projectRes = await authed().post('/api/projects').send({
    name: `Timeout Project ${++counter}`,
    acceptVoice: false,
    generateVoice: false,
    sampleCopyConfig: {},
    recordingConfig: { enabled: false },
    ...(timeoutSeconds === 'disabled' ? {} : { conversationTimeoutSeconds: timeoutSeconds }),
  });
  expect(projectRes.status).to.equal(201);
  const projectId = projectRes.body.id as string;

  const agentRes = await authed().post(`/api/projects/${projectId}/agents`).send({
    name: 'Test Agent',
    prompt: 'You are a helpful assistant.',
  });
  expect(agentRes.status).to.equal(201);

  const llmProviderRes = await authed().post('/api/providers').send({
    name: `Timeout LLM ${counter}`,
    providerType: 'llm',
    apiType: 'openai',
    config: { apiKey: 'sk-test-key-123' },
  });
  expect(llmProviderRes.status).to.equal(201);

  const stageRes = await authed().post(`/api/projects/${projectId}/stages`).send({
    name: 'Test Stage',
    agentId: agentRes.body.id,
    prompt: 'You are a helpful assistant.',
    llmProviderId: llmProviderRes.body.id,
    llmSettings: { model: 'gpt-4o' },
  });
  expect(stageRes.status).to.equal(201);

  const userRes = await authed().post(`/api/projects/${projectId}/users`).send({ profile: { name: 'Test User' } });
  expect(userRes.status).to.equal(201);

  const stamp = `${Date.now()}_${counter}`;
  const conversationId = `conv_timeout_${stamp}`;
  const now = Date.now();
  await db.insert(conversations).values({
    id: conversationId,
    projectId,
    userId: userRes.body.id,
    sessionId: `session_${stamp}`,
    stageId: stageRes.body.id,
    startingStageId: stageRes.body.id,
    stageVars: stageVars ?? { [stageRes.body.id as string]: {} },
    status,
    direction: 'incoming',
    lastActivityAt: new Date(now - idleForMs),
  });

  return { projectId, agentId: agentRes.body.id, stageId: stageRes.body.id, userId: userRes.body.id, conversationId };
}

/** Registers the reserved `__conversation_abort` conversation-lifecycle global action. */
async function createAbortLifecycleAction(projectId: string, effects: Effect[]): Promise<void> {
  await db.insert(globalActions).values({
    id: '__conversation_abort',
    projectId,
    name: 'On conversation abort',
    effects,
  });
}

async function loadConversation(fix: Fixture) {
  return db.query.conversations.findFirst({
    where: and(eq(conversations.projectId, fix.projectId), eq(conversations.id, fix.conversationId)),
  });
}

async function loadEvents(fix: Fixture) {
  return db.query.conversationEvents.findMany({
    where: and(eq(conversationEvents.projectId, fix.projectId), eq(conversationEvents.conversationId, fix.conversationId)),
  });
}

/** Polls sweep passes until the predicate holds — the background cron may also be working on the row. */
async function waitFor(assertion: () => Promise<boolean>, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    await sweeper().processTimeouts();
    if (await assertion()) return;
    if (Date.now() > deadline) throw new Error('Timed out waiting for the conversation-timeout sweep');
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

describe('conversation timeout sweeper', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  describe('inactivity abort', () => {
    it('aborts a conversation idle past the project timeout', async () => {
      const fix = await createFixture();

      await waitFor(async () => (await loadConversation(fix))?.status === 'aborted');

      const conversation = await loadConversation(fix);
      expect(conversation?.status).to.equal('aborted');
      expect(conversation?.statusDetails).to.equal(TIMEOUT_REASON);
      expect(conversation?.endingStageId).to.equal(fix.stageId);

      const abortEvents = (await loadEvents(fix)).filter((e) => e.eventType === 'conversation_aborted');
      expect(abortEvents).to.have.lengthOf(1);
      expect(abortEvents[0].eventData).to.deep.include({ stageId: fix.stageId, reason: TIMEOUT_REASON });
    });

    it('does not touch conversations that are still active, unconfigured, or already terminal', async () => {
      const recentlyActive = await createFixture({ idleForMs: 1000 });
      const timeoutDisabled = await createFixture({ timeout: 'disabled' });
      const timeoutZero = await createFixture({ timeout: 0 });
      const alreadyFinished = await createFixture({ status: 'finished' });

      await sweeper().processTimeouts();
      await sweeper().processTimeouts();

      expect((await loadConversation(recentlyActive))?.status).to.equal('awaiting_user_input');
      expect((await loadConversation(timeoutDisabled))?.status).to.equal('awaiting_user_input');
      expect((await loadConversation(timeoutZero))?.status).to.equal('awaiting_user_input');
      expect((await loadConversation(alreadyFinished))?.status).to.equal('finished');

      const events = await db.query.conversationEvents.findMany({
        where: and(eq(conversationEvents.projectId, alreadyFinished.projectId), eq(conversationEvents.conversationId, alreadyFinished.conversationId)),
      });
      expect(events).to.have.lengthOf(0);
    });
  });

  describe('__conversation_abort lifecycle action', () => {
    it('runs the project abort action and persists the variables it modifies', async () => {
      const fix = await createFixture({ stageVars: { ['stage-unused']: {} } });
      await createAbortLifecycleAction(fix.projectId, [
        { type: 'modify_variables', modifications: [{ variableName: 'endCause', operation: 'set', value: 'timeout' }] },
      ]);

      await waitFor(async () => (await loadConversation(fix))?.status === 'aborted');

      const conversation = await loadConversation(fix);
      expect(conversation?.stageVars?.[fix.stageId]).to.deep.include({ endCause: 'timeout' });

      const events = await loadEvents(fix);
      const plan = events.find((e) => e.eventType === 'execution_plan');
      expect(plan, 'expected an execution_plan event from the lifecycle action').to.exist;
      expect((plan!.eventData as Record<string, any>).lifecycleContext).to.equal('conversation_abort');
      expect((plan!.eventData as Record<string, any>).actions).to.deep.equal(['On conversation abort']);
    });

    it('still aborts the conversation when no abort action is defined', async () => {
      const fix = await createFixture();

      await waitFor(async () => (await loadConversation(fix))?.status === 'aborted');

      const events = await loadEvents(fix);
      expect(events.some((e) => e.eventType === 'conversation_aborted')).to.equal(true);
      expect(events.some((e) => e.eventType === 'execution_plan')).to.equal(false);
    });

    it('emits exactly one conversation_aborted event across repeated sweeps', async () => {
      const fix = await createFixture();

      await waitFor(async () => (await loadConversation(fix))?.status === 'aborted');
      await sweeper().processTimeouts();
      await sweeper().processTimeouts();

      const abortEvents = (await loadEvents(fix)).filter((e) => e.eventType === 'conversation_aborted');
      expect(abortEvents).to.have.lengthOf(1);
    });
  });
});
