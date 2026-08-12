import 'reflect-metadata';
import { describe, it, beforeEach } from 'mocha';
import { expect } from 'chai';
import { TesterClientConnection } from '../../../src/services/testing/TesterClientConnection';
import { ConversationTerminatedError } from '../../../src/errors';

describe('TesterClientConnection', () => {
  let connection: TesterClientConnection;

  beforeEach(() => {
    connection = new TesterClientConnection();
  });

  describe('connectionType', () => {
    it('is set to testing', () => {
      expect(connection.connectionType).to.equal('testing');
    });
  });

  describe('hasPendingResponse', () => {
    it('returns false initially', () => {
      expect(connection.hasPendingResponse()).to.be.false;
    });

    it('returns true after end_ai_generation_output is sent', async () => {
      await connection.sendMessage({
        type: 'end_ai_generation_output',
        fullText: 'Hello there',
      });

      expect(connection.hasPendingResponse()).to.be.true;
    });

    it('returns false after buffered response is consumed', async () => {
      await connection.sendMessage({
        type: 'end_ai_generation_output',
        fullText: 'Hello there',
      });

      const text = await connection.waitForAiResponse();

      expect(text).to.equal('Hello there');
      expect(connection.hasPendingResponse()).to.be.false;
    });
  });

  describe('waitForAiResponse', () => {
    it('returns buffered text immediately', async () => {
      await connection.sendMessage({
        type: 'end_ai_generation_output',
        fullText: 'Hello there',
      });

      const text = await connection.waitForAiResponse();

      expect(text).to.equal('Hello there');
    });

    it('resolves when text arrives after waiting', async () => {
      const promise = connection.waitForAiResponse();

      // Send message after waiting has started
      await connection.sendMessage({
        type: 'end_ai_generation_output',
        fullText: 'Delayed response',
      });

      const text = await promise;

      expect(text).to.equal('Delayed response');
    });

    it('rejects with ConversationTerminatedError for terminal events', async () => {
      const promise = connection.waitForAiResponse();

      await connection.sendMessage({
        type: 'conversation_event',
        conversationId: 'conv_1',
        eventType: 'conversation_end',
        eventData: {},
      });

      try {
        await promise;
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).to.be.instanceOf(ConversationTerminatedError);
        expect((error as ConversationTerminatedError).terminalEvent).to.equal('conversation_end');
      }
    });

    it('rejects immediately if terminal event already received', async () => {
      await connection.sendMessage({
        type: 'conversation_event',
        conversationId: 'conv_1',
        eventType: 'conversation_aborted',
        eventData: {},
      });

      try {
        await connection.waitForAiResponse();
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).to.be.instanceOf(ConversationTerminatedError);
        expect((error as ConversationTerminatedError).terminalEvent).to.equal('conversation_aborted');
      }
    });

    it('rejects for conversation_failed terminal event', async () => {
      await connection.sendMessage({
        type: 'conversation_event',
        conversationId: 'conv_1',
        eventType: 'conversation_failed',
        eventData: {},
      });

      try {
        await connection.waitForAiResponse();
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).to.be.instanceOf(ConversationTerminatedError);
        expect((error as ConversationTerminatedError).terminalEvent).to.equal('conversation_failed');
      }
    });
  });

  describe('getTerminalEventType', () => {
    it('returns null initially', () => {
      expect(connection.getTerminalEventType()).to.be.null;
    });

    it('returns terminal event type after receiving it', async () => {
      await connection.sendMessage({
        type: 'conversation_event',
        conversationId: 'conv_1',
        eventType: 'conversation_end',
        eventData: {},
      });

      expect(connection.getTerminalEventType()).to.equal('conversation_end');
    });

    it('does not set terminal event for non-terminal events', async () => {
      await connection.sendMessage({
        type: 'conversation_event',
        conversationId: 'conv_1',
        eventType: 'classification',
        eventData: {},
      });

      expect(connection.getTerminalEventType()).to.be.null;
    });
  });

  describe('sendMessage with non-terminal events', () => {
    it('ignores non-terminal conversation events', async () => {
      await connection.sendMessage({
        type: 'conversation_event',
        conversationId: 'conv_1',
        eventType: 'execution_plan',
        eventData: {},
      });

      expect(connection.hasPendingResponse()).to.be.false;
      expect(connection.getTerminalEventType()).to.be.null;
    });
  });

  describe('multiple responses', () => {
    it('handles multiple sequential responses', async () => {
      await connection.sendMessage({
        type: 'end_ai_generation_output',
        fullText: 'First response',
      });

      const text1 = await connection.waitForAiResponse();
      expect(text1).to.equal('First response');

      await connection.sendMessage({
        type: 'end_ai_generation_output',
        fullText: 'Second response',
      });

      const text2 = await connection.waitForAiResponse();
      expect(text2).to.equal('Second response');
    });

    it('handles interleaved messages', async () => {
      await connection.sendMessage({
        type: 'end_ai_generation_output',
        fullText: 'Response 1',
      });

      await connection.sendMessage({
        type: 'conversation_event',
        conversationId: 'conv_1',
        eventType: 'classification',
        eventData: {},
      });

      const text = await connection.waitForAiResponse();
      expect(text).to.equal('Response 1');
    });
  });

  describe('close', () => {
    it('is a no-op that resolves immediately', async () => {
      await connection.close();
      // Should not throw
    });
  });
});
