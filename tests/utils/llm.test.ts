import { describe, it, expect } from 'vitest';
import type { LlmContent } from '../../src/services/providers/llm/ILlmProvider';
import { extractTextFromContent, getContentSize } from '../../src/utils/llm';

describe('extractTextFromContent', () => {
  it('extracts text from a single text block', () => {
    const content: LlmContent[] = [{ contentType: 'text', text: 'hello' }];
    expect(extractTextFromContent(content)).toBe('hello');
  });

  it('concatenates multiple text blocks', () => {
    const content: LlmContent[] = [
      { contentType: 'text', text: 'hello ' },
      { contentType: 'text', text: 'world' },
    ];
    expect(extractTextFromContent(content)).toBe('hello world');
  });

  it('ignores non-text blocks', () => {
    const content: LlmContent[] = [
      { contentType: 'text', text: 'hello' },
      { contentType: 'image', data: 'base64data', mimeType: 'image/png' },
      { contentType: 'text', text: 'world' },
    ];
    expect(extractTextFromContent(content)).toBe('helloworld');
  });

  it('returns empty string for no text blocks', () => {
    const content: LlmContent[] = [
      { contentType: 'image', data: 'base64data', mimeType: 'image/png' },
    ];
    expect(extractTextFromContent(content)).toBe('');
  });

  it('returns empty string for empty array', () => {
    expect(extractTextFromContent([])).toBe('');
  });
});

describe('getContentSize', () => {
  it('calculates size for text blocks', () => {
    const content: LlmContent[] = [{ contentType: 'text', text: 'hello' }];
    expect(getContentSize(content)).toBe(5);
  });

  it('sums sizes of multiple text blocks', () => {
    const content: LlmContent[] = [
      { contentType: 'text', text: 'hi' },
      { contentType: 'text', text: 'there' },
    ];
    expect(getContentSize(content)).toBe(7);
  });

  it('calculates size for image blocks', () => {
    const content: LlmContent[] = [
      { contentType: 'image', data: 'abcd', mimeType: 'image/png' },
    ];
    expect(getContentSize(content)).toBe(4);
  });

  it('calculates size for audio blocks', () => {
    const content: LlmContent[] = [
      { contentType: 'audio', data: 'abcdef', format: 'mp3', mimeType: 'audio/mpeg' },
    ];
    expect(getContentSize(content)).toBe(6);
  });

  it('sums mixed content types', () => {
    const content: LlmContent[] = [
      { contentType: 'text', text: 'hi' },
      { contentType: 'image', data: 'abcd', mimeType: 'image/png' },
    ];
    expect(getContentSize(content)).toBe(6);
  });

  it('returns 0 for empty array', () => {
    expect(getContentSize([])).toBe(0);
  });
});
