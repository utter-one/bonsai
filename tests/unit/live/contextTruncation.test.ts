import { describe, it } from 'mocha';
import { expect } from 'chai';
import { truncateMessagesToTokenBudget } from '../../../src/utils/contextTruncation';
import type { LlmMessage } from '../../../src/services/providers/llm/ILlmProvider';

function messages(...contents: string[]): LlmMessage[] {
  return contents.map((c, i) => ({
    role: i === 0 ? 'system' : (i % 2 === 1 ? 'user' : 'assistant'),
    content: c,
  }));
}

describe('truncateMessagesToTokenBudget', () => {
  describe('no truncation when cap is undefined', () => {
    it('returns messages unchanged', () => {
      const msgs = messages('system', 'hello', 'hi');
      const result = truncateMessagesToTokenBudget(msgs, undefined, undefined);
      expect(result.messages).to.have.length(3);
      expect(result.truncated).to.equal(false);
      expect(result.estimatedInputTokens).to.equal(undefined);
      expect(result.estimatedFinalInputTokens).to.equal(undefined);
    });
  });

  describe('no truncation when array is empty', () => {
    it('returns empty array', () => {
      const result = truncateMessagesToTokenBudget([], 100, undefined);
      expect(result.messages).to.have.length(0);
      expect(result.truncated).to.equal(false);
    });
  });

  describe('no truncation when within budget', () => {
    it('returns all messages when total is under cap', () => {
      const msgs = messages('system prompt', 'hi');
      const result = truncateMessagesToTokenBudget(msgs, 1000, undefined);
      expect(result.messages).to.have.length(2);
      expect(result.truncated).to.equal(false);
      expect(result.estimatedInputTokens).to.be.a('number');
      expect(result.estimatedFinalInputTokens).to.equal(result.estimatedInputTokens);
    });
  });

  describe('truncation behavior', () => {
    it('preserves system message at index 0', () => {
      const msgs = messages('system', 'user1', 'assistant1', 'user2', 'assistant2', 'user3');
      const result = truncateMessagesToTokenBudget(msgs, 10, undefined);
      expect(result.messages[0].content).to.equal('system');
      expect(result.messages[0].role).to.equal('system');
    });

    it('preserves last user message', () => {
      const msgs = messages('system', 'user1', 'assistant1', 'final user message');
      const result = truncateMessagesToTokenBudget(msgs, 15, undefined);
      const last = result.messages[result.messages.length - 1];
      expect(last.content).to.equal('final user message');
    });

    it('removes oldest history messages first', () => {
      const msgs = messages('system', 'old1', 'old2', 'old3', 'final');
      const result = truncateMessagesToTokenBudget(msgs, 3, undefined);
      expect(result.messages).to.not.include.satisfy((m: LlmMessage) => m.content === 'old1');
      expect(result.truncated).to.equal(true);
    });

    it('drops multiple messages when needed', () => {
      const msgs = messages('system', 'msg1 long text', 'msg2 long text', 'msg3 long text', 'final');
      const result = truncateMessagesToTokenBudget(msgs, 10, undefined);
      expect(result.truncated).to.equal(true);
      // Should have at least system + last
      expect(result.messages.length).to.be.at.least(2);
    });

    it('returns as-is when only system + last (cannot trim further)', () => {
      const msgs = messages('very long system message that exceeds budget on its own', 'final');
      const result = truncateMessagesToTokenBudget(msgs, 5, undefined);
      expect(result.messages).to.have.length(2);
      // When only system + last remain, truncated may be false since no actual trimming happened
      expect(result.messages[0].content).to.equal('very long system message that exceeds budget on its own');
      expect(result.messages[1].content).to.equal('final');
    });
  });

  describe('edge cases', () => {
    it('handles system + single user message (no middle to trim)', () => {
      const msgs = messages('system', 'user message');
      const result = truncateMessagesToTokenBudget(msgs, 5, undefined);
      expect(result.messages).to.have.length(2);
      expect(result.truncated).to.equal(false); // Cannot trim, returns as-is
    });

    it('handles single system message', () => {
      const msgs = messages('system only');
      const result = truncateMessagesToTokenBudget(msgs, 5, undefined);
      expect(result.messages).to.have.length(1);
    });

    it('reports correct original and final token estimates', () => {
      const msgs = messages('system', 'old message to remove', 'final');
      const result = truncateMessagesToTokenBudget(msgs, 10, undefined);
      expect(result.estimatedInputTokens).to.be.a('number');
      expect(result.estimatedFinalInputTokens).to.be.a('number');
      if (result.truncated) {
        expect(result.estimatedFinalInputTokens).to.be.lessThan(result.estimatedInputTokens);
      }
    });

    it('handles single message array', () => {
      const msgs: LlmMessage[] = [{ role: 'system', content: 'only message' }];
      const result = truncateMessagesToTokenBudget(msgs, 5, undefined);
      expect(result.messages).to.have.length(1);
      expect(result.truncated).to.equal(false);
    });

    it('handles array with only user messages (no system)', () => {
      const msgs: LlmMessage[] = [
        { role: 'user', content: 'first' },
        { role: 'assistant', content: 'reply' },
        { role: 'user', content: 'last' },
      ];
      const result = truncateMessagesToTokenBudget(msgs, 3, undefined);
      // First message is treated as system (preserved), last is preserved
      expect(result.messages.length).to.be.at.least(2);
    });

    it('keeps system + last even when last is assistant role', () => {
      const msgs: LlmMessage[] = [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'old' },
        { role: 'assistant', content: 'final assistant' },
      ];
      const result = truncateMessagesToTokenBudget(msgs, 2, undefined);
      expect(result.messages.length).to.be.at.least(2);
      expect(result.messages[0].role).to.equal('system');
      expect(result.messages[result.messages.length - 1].content).to.equal('final assistant');
    });

    it('preserves token estimates when no truncation needed', () => {
      const msgs = messages('system', 'hello');
      const result = truncateMessagesToTokenBudget(msgs, 1000, undefined);
      expect(result.truncated).to.equal(false);
      expect(result.estimatedInputTokens).to.equal(result.estimatedFinalInputTokens);
    });
  });

  describe('multi-modal content', () => {
    it('handles array content with text blocks', () => {
      const msgs: LlmMessage[] = [
        { role: 'system', content: 'system' },
        { role: 'user', content: [{ type: 'text', text: 'hello world' }] },
      ];
      const result = truncateMessagesToTokenBudget(msgs, 100, undefined);
      expect(result.truncated).to.equal(false);
    });

    it('ignores non-text content blocks for estimation', () => {
      const msgs: LlmMessage[] = [
        { role: 'system', content: 'system' },
        { role: 'user', content: [{ type: 'image', source: { type: 'url', url: 'http://example.com/img.png' }, mimeType: 'image/png' }] },
      ];
      // Should not crash
      const result = truncateMessagesToTokenBudget(msgs, 100, undefined);
      expect(result.messages).to.have.length(2);
    });
  });
});
