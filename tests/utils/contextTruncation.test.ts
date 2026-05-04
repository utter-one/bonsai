import { describe, it, expect, vi } from 'vitest';
import type { LlmMessage } from '../../src/services/providers/llm/ILlmProvider';

vi.mock('tokenx', () => ({
  estimateTokenCount: vi.fn((text: string) => Math.ceil(text.length / 4)),
}));

import { truncateMessagesToTokenBudget } from '../../src/utils/contextTruncation';

const makeMsg = (role: LlmMessage['role'], content: string): LlmMessage => ({ role, content });

describe('truncateMessagesToTokenBudget', () => {
  it('returns unchanged when maxInputTokens is undefined', () => {
    const messages = [makeMsg('system', 'You are helpful'), makeMsg('user', 'Hello')];
    const result = truncateMessagesToTokenBudget(messages, undefined, undefined);
    expect(result.messages).toBe(messages);
    expect(result.truncated).toBe(false);
    expect(result.estimatedInputTokens).toBeUndefined();
    expect(result.estimatedFinalInputTokens).toBeUndefined();
  });

  it('returns unchanged when messages array is empty', () => {
    const result = truncateMessagesToTokenBudget([], 100, 'gpt-4');
    expect(result.messages).toEqual([]);
    expect(result.truncated).toBe(false);
    expect(result.estimatedInputTokens).toBeUndefined();
  });

  it('returns unchanged when total tokens are within budget', () => {
    const messages = [makeMsg('system', 'sys'), makeMsg('user', 'hi')];
    const result = truncateMessagesToTokenBudget(messages, 1000, 'gpt-4');
    expect(result.messages).toBe(messages);
    expect(result.truncated).toBe(false);
    expect(result.estimatedInputTokens).toBeDefined();
    expect(result.estimatedFinalInputTokens).toBe(result.estimatedInputTokens);
  });

  it('returns unchanged when only system + last message exceed budget (cannot trim)', () => {
    const messages = [makeMsg('system', 'a'.repeat(100)), makeMsg('user', 'b'.repeat(100))];
    const result = truncateMessagesToTokenBudget(messages, 10, 'gpt-4');
    expect(result.messages).toBe(messages);
    expect(result.truncated).toBe(false);
    expect(result.estimatedInputTokens).toBeGreaterThan(10);
    expect(result.estimatedFinalInputTokens).toBe(result.estimatedInputTokens);
  });

  it('trims oldest messages to fit within budget', () => {
    const messages: LlmMessage[] = [
      makeMsg('system', 's'.repeat(20)),
      makeMsg('user', 'a'.repeat(100)),
      makeMsg('assistant', 'b'.repeat(100)),
      makeMsg('user', 'c'.repeat(100)),
      makeMsg('assistant', 'd'.repeat(100)),
      makeMsg('user', 'e'.repeat(20)),
    ];
    const result = truncateMessagesToTokenBudget(messages, 50, 'gpt-4');
    expect(result.truncated).toBe(true);
    expect(result.messages[0]).toBe(messages[0]);
    expect(result.messages[result.messages.length - 1]).toBe(messages[messages.length - 1]);
    expect(result.estimatedInputTokens).toBeDefined();
    expect(result.estimatedFinalInputTokens).toBeDefined();
    expect(result.estimatedFinalInputTokens!).toBeLessThan(result.estimatedInputTokens!);
  });

  it('returns only system + last when all middle messages trimmed still over budget', () => {
    const messages: LlmMessage[] = [
      makeMsg('system', 's'.repeat(20)),
      makeMsg('user', 'a'.repeat(200)),
      makeMsg('assistant', 'b'.repeat(200)),
      makeMsg('user', 'e'.repeat(10)),
    ];
    const result = truncateMessagesToTokenBudget(messages, 15, 'gpt-4');
    expect(result.truncated).toBe(true);
    expect(result.messages.length).toBe(2);
    expect(result.messages[0]).toBe(messages[0]);
    expect(result.messages[1]).toBe(messages[messages.length - 1]);
  });

  it('handles content as array of content blocks', () => {
    const messages: LlmMessage[] = [
      { role: 'system', content: [{ type: 'text', text: 'hello' }] },
      { role: 'user', content: [{ type: 'text', text: 'world' }] },
    ];
    const result = truncateMessagesToTokenBudget(messages, 1000, 'gpt-4');
    expect(result.truncated).toBe(false);
    expect(result.messages.length).toBe(2);
  });

  it('preserves message order after truncation', () => {
    const messages: LlmMessage[] = [
      makeMsg('system', 'sys'),
      makeMsg('user', 'a'.repeat(100)),
      makeMsg('assistant', 'b'.repeat(100)),
      makeMsg('user', 'c'.repeat(100)),
      makeMsg('user', 'last'),
    ];
    const result = truncateMessagesToTokenBudget(messages, 30, 'gpt-4');
    expect(result.truncated).toBe(true);
    for (let i = 1; i < result.messages.length - 1; i++) {
      expect(result.messages.indexOf(result.messages[i])).toBe(i);
    }
  });
});
