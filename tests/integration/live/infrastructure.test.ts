import 'reflect-metadata';
import { expect } from 'chai';
import { MockLlmProvider } from './mockLlmProvider';
import { EventCollectorClientConnection } from './eventCollectorClientConnection';

describe('MockLlmProvider', () => {
  let mock: MockLlmProvider;

  beforeEach(() => {
    mock = new MockLlmProvider();
  });

  it('returns queued responses in order', async () => {
    mock.queueResponse('First');
    mock.queueResponse('Second');

    const r1 = await mock.generate([]);
    const r2 = await mock.generate([]);

    expect(r1.content[0].text).to.equal('First');
    expect(r2.content[0].text).to.equal('Second');
  });

  it('falls back to last response when queue exhausted', async () => {
    mock.queueResponse('Last');

    const r1 = await mock.generate([]);
    const r2 = await mock.generate([]);
    const r3 = await mock.generate([]);

    expect(r1.content[0].text).to.equal('Last');
    expect(r2.content[0].text).to.equal('Last');
    expect(r3.content[0].text).to.equal('Last');
  });

  it('returns empty response when no responses queued', async () => {
    const r = await mock.generate([]);
    expect(r.content[0].text).to.equal('');
  });

  it('captures calls for prompt verification', async () => {
    mock.queueResponse('Hi');

    await mock.generate([{ role: 'system', content: 'Be nice' }]);

    expect(mock.calls.length).to.equal(1);
    expect(mock.calls[0][0].content).to.equal('Be nice');
  });

  it('supports structured results via queueResult', async () => {
    mock.queueResult({
      id: 'custom',
      content: [{ contentType: 'text', text: 'Custom' }],
      role: 'assistant',
      finishReason: 'tool_calls',
      usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
    });

    const r = await mock.generate([]);
    expect(r.id).to.equal('custom');
    expect(r.finishReason).to.equal('tool_calls');
  });

  it('fires streaming callbacks', async () => {
    mock.queueResponse('Streamed');

    let chunkReceived = false;
    let completed = false;

    mock.setOnChunk(async (chunk) => {
      chunkReceived = true;
      expect(chunk.content).to.equal('Streamed');
    });
    mock.setOnGenerationCompleted(async () => {
      completed = true;
    });

    await mock.generateStream([]);

    expect(chunkReceived).to.be.true;
    expect(completed).to.be.true;
  });

  it('resets state cleanly', async () => {
    mock.queueResponse('Before');
    await mock.generate([]);

    mock.reset();

    const r = await mock.generate([]);
    expect(r.content[0].text).to.equal('');
    expect(mock.calls.length).to.equal(1); // calls tracked after reset
    expect(mock.initialized).to.be.false;
  });

  it('supports moderation override', async () => {
    mock.moderationFlagged = true;
    mock.moderationCategories = ['violence'];

    const result = await mock.moderateUserInput('test');
    expect(result.flagged).to.be.true;
    expect(result.categories).to.deep.equal(['violence']);
  });

  it('implements enumerateModels', async () => {
    const models = await mock.enumerateModels();
    expect(models.length).to.be.greaterThan(0);
    expect(models[0].id).to.equal('mock-model');
  });

  it('tracks init and cleanup state', async () => {
    expect(mock.isInitialized()).to.be.false;
    await mock.init();
    expect(mock.isInitialized()).to.be.true;
    await mock.cleanup();
    expect(mock.isInitialized()).to.be.false;
  });
});

describe('EventCollectorClientConnection', () => {
  let collector: EventCollectorClientConnection;

  beforeEach(() => {
    collector = new EventCollectorClientConnection();
  });

  it('captures all messages', async () => {
    await collector.sendMessage({ type: 'conversation_event', conversationId: 'c1', eventType: 'conversation_start', eventData: {} });
    await collector.sendMessage({ type: 'end_ai_generation_output', conversationId: 'c1', outputTurnId: 't1', fullText: 'Hello', role: 'assistant' });

    expect(collector.messages.length).to.equal(2);
  });

  it('provides aiResponses accessor', async () => {
    await collector.sendMessage({ type: 'end_ai_generation_output', conversationId: 'c1', outputTurnId: 't1', fullText: 'Hi', role: 'assistant' });
    await collector.sendMessage({ type: 'end_ai_generation_output', conversationId: 'c1', outputTurnId: 't2', fullText: 'Bye', role: 'assistant' });

    expect(collector.aiResponses).to.deep.equal(['Hi', 'Bye']);
  });

  it('provides conversationEvents accessor', async () => {
    await collector.sendMessage({ type: 'conversation_event', conversationId: 'c1', eventType: 'classification', eventData: {} });
    await collector.sendMessage({ type: 'end_ai_generation_output', conversationId: 'c1', outputTurnId: 't1', fullText: 'Hi', role: 'assistant' });

    expect(collector.conversationEvents.length).to.equal(1);
    expect(collector.conversationEvents[0].eventType).to.equal('classification');
  });

  it('detects terminal events', async () => {
    await collector.sendMessage({ type: 'conversation_event', conversationId: 'c1', eventType: 'conversation_end', eventData: {} });

    expect(collector.terminalEvent).to.equal('conversation_end');
  });

  it('returns null terminal event when conversation is active', async () => {
    await collector.sendMessage({ type: 'conversation_event', conversationId: 'c1', eventType: 'conversation_start', eventData: {} });

    expect(collector.terminalEvent).to.be.null;
  });

  it('supports getEventsByType', async () => {
    await collector.sendMessage({ type: 'conversation_event', conversationId: 'c1', eventType: 'message', eventData: {} });
    await collector.sendMessage({ type: 'conversation_event', conversationId: 'c1', eventType: 'message', eventData: {} });
    await collector.sendMessage({ type: 'conversation_event', conversationId: 'c1', eventType: 'classification', eventData: {} });

    expect(collector.getEventsByType('message').length).to.equal(2);
    expect(collector.getEventsByType('classification').length).to.equal(1);
    expect(collector.getEventsByType('nonexistent').length).to.equal(0);
  });

  it('resets cleanly', async () => {
    await collector.sendMessage({ type: 'conversation_event', conversationId: 'c1', eventType: 'message', eventData: {} });
    collector.reset();

    expect(collector.messages.length).to.equal(0);
  });

  it('implements IClientConnection.close', async () => {
    // Should not throw
    await collector.close();
  });
});
