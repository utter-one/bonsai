import { describe, it, expect, vi } from 'vitest';
import { TesterClientConnection } from '../../../src/services/testing/TesterClientConnection';
import type { CALOutputMessage } from '../../../src/channels/messages';
import { ConversationTerminatedError } from '../../../src/errors';

function createAiOutputMessage(text: string): CALOutputMessage {
  return {
    type: 'end_ai_generation_output',
    outputTurnId: 'turn-1',
    fullText: text,
  };
}

function createConversationEventMessage(eventType: string): CALOutputMessage {
  return {
    type: 'conversation_event',
    eventType,
    eventData: null,
  };
}

describe('TesterClientConnection', () => {
  describe('connectionType', () => {
    it('is testing', () => {
      const conn = new TesterClientConnection();
      expect(conn.connectionType).toBe('testing');
    });
  });

  describe('sendMessage with end_ai_generation_output', () => {
    it('resolves pending waitForAiResponse immediately', async () => {
      const conn = new TesterClientConnection();
      const waitPromise = conn.waitForAiResponse();
      await conn.sendMessage(createAiOutputMessage('Hello world'));
      const text = await waitPromise;
      expect(text).toBe('Hello world');
    });

    it('buffers text when no waiter is pending', async () => {
      const conn = new TesterClientConnection();
      await conn.sendMessage(createAiOutputMessage('Buffered response'));
      expect(conn.hasPendingResponse()).toBe(true);
      const text = await conn.waitForAiResponse();
      expect(text).toBe('Buffered response');
      expect(conn.hasPendingResponse()).toBe(false);
    });

    it('buffers second message when two arrive before wait', async () => {
      const conn = new TesterClientConnection();
      await conn.sendMessage(createAiOutputMessage('First'));
      await conn.sendMessage(createAiOutputMessage('Second'));
      expect(conn.hasPendingResponse()).toBe(true);
      const text = await conn.waitForAiResponse();
      expect(text).toBe('Second');
    });

    it('preserves message ordering for sequential send and wait', async () => {
      const conn = new TesterClientConnection();
      await conn.sendMessage(createAiOutputMessage('Response 1'));
      expect(await conn.waitForAiResponse()).toBe('Response 1');
      await conn.sendMessage(createAiOutputMessage('Response 2'));
      expect(await conn.waitForAiResponse()).toBe('Response 2');
    });
  });

  describe('sendMessage with terminal conversation_event', () => {
    it('rejects pending waitForAiResponse with ConversationTerminatedError', async () => {
      const conn = new TesterClientConnection();
      const waitPromise = conn.waitForAiResponse();
      await conn.sendMessage(createConversationEventMessage('conversation_end'));
      await expect(waitPromise).rejects.toThrow(ConversationTerminatedError);
    });

    it('sets terminal event type for conversation_aborted', async () => {
      const conn = new TesterClientConnection();
      await conn.sendMessage(createConversationEventMessage('conversation_aborted'));
      expect(conn.getTerminalEventType()).toBe('conversation_aborted');
    });

    it('sets terminal event type for conversation_failed', async () => {
      const conn = new TesterClientConnection();
      await conn.sendMessage(createConversationEventMessage('conversation_failed'));
      expect(conn.getTerminalEventType()).toBe('conversation_failed');
    });

    it('does not set terminal event for non-terminal events', async () => {
      const conn = new TesterClientConnection();
      const nonTerminal: CALOutputMessage = {
        type: 'conversation_event',
        eventType: 'user_turn_start',
        eventData: null,
      };
      await conn.sendMessage(nonTerminal);
      expect(conn.getTerminalEventType()).toBe(null);
    });
  });

  describe('waitForAiResponse', () => {
    it('resolves immediately with buffered text', async () => {
      const conn = new TesterClientConnection();
      await conn.sendMessage(createAiOutputMessage('Pre-buffered'));
      const result = await conn.waitForAiResponse();
      expect(result).toBe('Pre-buffered');
    });

    it('rejects immediately when conversation already terminated', async () => {
      const conn = new TesterClientConnection();
      await conn.sendMessage(createConversationEventMessage('conversation_end'));
      await expect(conn.waitForAiResponse()).rejects.toThrow(
        'Conversation terminated with event: conversation_end'
      );
    });

    it('preserves terminal event type in error', async () => {
      const conn = new TesterClientConnection();
      await conn.sendMessage(createConversationEventMessage('conversation_failed'));
      try {
        await conn.waitForAiResponse();
        expect.unreachable('should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ConversationTerminatedError);
        expect((error as ConversationTerminatedError).terminalEvent).toBe('conversation_failed');
      }
    });

    it('clears buffer after consumption', async () => {
      const conn = new TesterClientConnection();
      await conn.sendMessage(createAiOutputMessage('Text'));
      expect(conn.hasPendingResponse()).toBe(true);
      await conn.waitForAiResponse();
      expect(conn.hasPendingResponse()).toBe(false);
    });
  });

  describe('hasPendingResponse', () => {
    it('returns false initially', () => {
      const conn = new TesterClientConnection();
      expect(conn.hasPendingResponse()).toBe(false);
    });

    it('returns true after ai output message', async () => {
      const conn = new TesterClientConnection();
      await conn.sendMessage(createAiOutputMessage('Text'));
      expect(conn.hasPendingResponse()).toBe(true);
    });

    it('returns false after buffer is consumed', async () => {
      const conn = new TesterClientConnection();
      await conn.sendMessage(createAiOutputMessage('Text'));
      await conn.waitForAiResponse();
      expect(conn.hasPendingResponse()).toBe(false);
    });
  });

  describe('getTerminalEventType', () => {
    it('returns null initially', () => {
      const conn = new TesterClientConnection();
      expect(conn.getTerminalEventType()).toBe(null);
    });

    it('remains null after non-terminal events', async () => {
      const conn = new TesterClientConnection();
      const nonTerminal: CALOutputMessage = {
        type: 'conversation_event',
        eventType: 'ai_turn_start',
        eventData: null,
      };
      await conn.sendMessage(nonTerminal);
      expect(conn.getTerminalEventType()).toBe(null);
    });
  });

  describe('close', () => {
    it('is a no-op that resolves successfully', async () => {
      const conn = new TesterClientConnection();
      await expect(conn.close()).resolves.toBeUndefined();
    });
  });
});
