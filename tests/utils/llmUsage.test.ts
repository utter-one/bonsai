import { describe, it, expect } from 'vitest';
import type { TokenUsage } from '../../src/services/providers/llm/ILlmProvider';
import type { LlmProviderInfo } from '../../src/utils/llmUsage';
import { buildLlmUsage } from '../../src/utils/llmUsage';

describe('buildLlmUsage', () => {
  const usage: TokenUsage = { promptTokens: 100, completionTokens: 50, totalTokens: 150 };
  const provider: LlmProviderInfo = { id: 'prov_test', apiType: 'openai' };

  it('returns undefined when usage is undefined', () => {
    expect(buildLlmUsage(undefined, provider, 'gpt-4o')).toBeUndefined();
  });

  it('returns undefined when providerInfo is undefined', () => {
    expect(buildLlmUsage(usage, undefined, 'gpt-4o')).toBeUndefined();
  });

  it('returns undefined when both are undefined', () => {
    expect(buildLlmUsage(undefined, undefined, undefined)).toBeUndefined();
  });

  it('builds basic metadata without truncation info', () => {
    const result = buildLlmUsage(usage, provider, 'gpt-4o');
    expect(result).toEqual({
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
      providerId: 'prov_test',
      providerApiType: 'openai',
      model: 'gpt-4o',
    });
  });

  it('includes model as undefined when not provided', () => {
    const result = buildLlmUsage(usage, provider, undefined);
    expect(result?.model).toBeUndefined();
  });

  it('includes truncation info when provided', () => {
    const result = buildLlmUsage(usage, provider, 'gpt-4o', {
      truncated: true,
      estimatedInputTokens: 500,
      estimatedFinalInputTokens: 300,
    });
    expect(result).toEqual({
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
      providerId: 'prov_test',
      providerApiType: 'openai',
      model: 'gpt-4o',
      inputTruncated: true,
      estimatedInputTokens: 500,
      estimatedFinalInputTokens: 300,
    });
  });

  it('includes only inputTruncated when token estimates are undefined', () => {
    const result = buildLlmUsage(usage, provider, 'gpt-4o', {
      truncated: false,
      estimatedInputTokens: undefined,
      estimatedFinalInputTokens: undefined,
    });
    expect(result?.inputTruncated).toBe(false);
    expect(result?.estimatedInputTokens).toBeUndefined();
    expect(result?.estimatedFinalInputTokens).toBeUndefined();
  });

  it('omits truncation fields when truncationInfo is not provided', () => {
    const result = buildLlmUsage(usage, provider, 'gpt-4o');
    expect(result?.inputTruncated).toBeUndefined();
    expect(result?.estimatedInputTokens).toBeUndefined();
    expect(result?.estimatedFinalInputTokens).toBeUndefined();
  });

  it('includes partial truncation info (only estimatedInputTokens defined)', () => {
    const result = buildLlmUsage(usage, provider, 'gpt-4o', {
      truncated: true,
      estimatedInputTokens: 500,
      estimatedFinalInputTokens: undefined,
    });
    expect(result?.inputTruncated).toBe(true);
    expect(result?.estimatedInputTokens).toBe(500);
    expect(result?.estimatedFinalInputTokens).toBeUndefined();
  });
});
