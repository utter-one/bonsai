import 'reflect-metadata';
import { expect } from 'chai';
import { db } from '../../../src/db';
import { providerCallLogs } from '../../../src/db/schema';
import { eq } from 'drizzle-orm';
import { CallLogger } from '../../../src/services/monitoring/CallLogger';
import { ProviderCallRecorder, getProviderCallRecorder } from '../../../src/services/monitoring/ProviderCallRecorder';
import { ConversationTestHarness } from './conversationTestHarness';
import { authed } from '../../utils';

/**
 * P1-03 integration: a mock-provider conversation must produce correctly
 * attributed provider_call_logs rows through the real instrumentation path
 * (LlmProviderBase template wrappers + MonitoringContext + CallLogger).
 */
describe('Provider call instrumentation (P1-03)', () => {
  let harness: ConversationTestHarness;

  beforeEach(async () => {
    harness = new ConversationTestHarness();
  });

  afterEach(async () => {
    await harness.teardown();
  });

  it('mock conversation with classifier produces >=4 attributed provider_call_logs rows with streaming fields', async () => {
    await harness.setup({
      name: 'Welcome',
      prompt: 'You are a helpful assistant.',
      llmSettings: { provider: 'openai', model: 'gpt-4', temperature: 0.7 },
      actions: {
        __on_enter: {
          name: 'On Enter',
          triggerOnUserInput: false,
          triggerOnClientCommand: false,
          parameters: [],
          effects: [
            { type: 'generate_response', responseMode: 'generated' },
          ],
        },
        greet: {
          name: 'Greet',
          triggerOnUserInput: true,
          triggerOnClientCommand: false,
          parameters: [],
          effects: [
            { type: 'generate_response', responseMode: 'generated' },
          ],
        },
      },
    });

    // Classifier + stage wiring so sendInput runs an llm.classify call
    const classifierRes = await authed()
      .post(`/api/projects/${harness.projectId}/classifiers`)
      .send({
        name: 'Test Classifier',
        prompt: 'Classify the input.',
        llmProviderId: harness._providerId,
        llmSettings: { provider: 'openai', model: 'gpt-4', temperature: 0.7 },
      });
    expect(classifierRes.status).to.equal(201);
    const classifierId = classifierRes.body.id;

    const stageUpdate = await authed()
      .put(`/api/projects/${harness.projectId}/stages/${harness.stageId}`)
      .send({ defaultClassifierId: classifierId, version: 1 });
    expect(stageUpdate.status).to.equal(200);

    await harness.rePrepare();

    // LLM call queue:
    //  1. on_enter generate_response        -> llm.generate
    //  2. input 1 classifier                -> llm.classify
    //  3. input 1 greet generate_response   -> llm.generate
    //  4. input 2 classifier                -> llm.classify
    //  5. input 2 greet generate_response   -> llm.generate
    harness.mockLlm.queueResponse('Welcome! How can I help you?');
    harness.mockLlm.queueResponse('{"actions": {"greet": {}}}');
    harness.mockLlm.queueResponse('Hello there!');
    harness.mockLlm.queueResponse('{"actions": {"greet": {}}}');
    harness.mockLlm.queueResponse('Hi again!');

    await harness.start();
    expect(harness.events.aiResponses).to.include('Welcome! How can I help you?');

    await harness.sendInput('Hi');
    await harness.sendInput('Hi again');

    // Drain the buffered call-log rows so the DB assertions see them.
    // NOTE: the harness's `container.reset()` in teardown breaks tsyringe
    // singleton caching (post-reset resolves create fresh instances), so we
    // flush the CallLogger held by the cached recorder — the same instance
    // the instrumentation wrote to — rather than a fresh container resolve.
    const recorder = getProviderCallRecorder() as ProviderCallRecorder;
    const callLogger = (recorder as unknown as { callLogger: CallLogger }).callLogger;
    await callLogger.flushNow();

    const rows = await db.select().from(providerCallLogs)
      .where(eq(providerCallLogs.conversationId, harness.conversationId));

    expect(rows.length).to.be.gte(4);

    const operations = rows.map(r => r.operation);
    expect(operations.filter(o => o === 'llm.generate').length).to.be.gte(3);
    expect(operations.filter(o => o === 'llm.classify').length).to.be.gte(2);

    // Every row correctly attributed (context propagation from ConversationRunner)
    for (const row of rows) {
      expect(row.providerId).to.equal(harness._providerId);
      expect(row.projectId).to.equal(harness.projectId);
      expect(row.conversationId).to.equal(harness.conversationId);
      expect(row.providerType).to.equal('llm');
      expect(row.apiType).to.equal('openai');
      expect(row.ok).to.equal(true);
      expect(row.model).to.equal('gpt-4');
    }

    // Streaming phase fields populated on completion rows (generateStream path)
    const completionRows = rows.filter(r => r.operation === 'llm.generate');
    for (const row of completionRows) {
      expect(row.metrics).to.be.an('object');
      expect(row.metrics?.chunksCount).to.be.gte(1);
      expect(row.metrics?.finishReason).to.equal('stop');
      expect(row.metrics?.ttftMs).to.be.a('number').and.to.be.gte(0);
      expect(row.metrics?.tokensPrompt).to.equal(10);
      expect(row.metrics?.tokensCompletion).to.equal(5);
    }
  });
});
