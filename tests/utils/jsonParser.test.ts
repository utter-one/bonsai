import { describe, it, expect } from 'vitest';
import { removeJsonMarkers, parseJsonFromMarkdown } from '../../src/utils/jsonParser';

describe('removeJsonMarkers', () => {
  it('removes ```json code fences', () => {
    const input = '```json\n{"key": "value"}\n```';
    expect(removeJsonMarkers(input)).toBe('{"key": "value"}');
  });

  it('removes generic ``` code fences', () => {
    const input = '```\n{"key": "value"}\n```';
    expect(removeJsonMarkers(input)).toBe('{"key": "value"}');
  });

  it('returns plain JSON unchanged', () => {
    const input = '{"key": "value"}';
    expect(removeJsonMarkers(input)).toBe('{"key": "value"}');
  });

  it('trims whitespace around the input', () => {
    const input = '  {"key": "value"}  ';
    expect(removeJsonMarkers(input)).toBe('{"key": "value"}');
  });

  it('handles multiline JSON in code fences', () => {
    const input = '```json\n{\n  "key": "value",\n  "nested": {\n    "a": 1\n  }\n}\n```';
    const result = removeJsonMarkers(input) as string;
    expect(result).toBe('{\n  "key": "value",\n  "nested": {\n    "a": 1\n  }\n}');
  });

  it('trims content after stripping fences', () => {
    const input = '```json\n  {"key": "value"}  \n```';
    expect(removeJsonMarkers(input)).toBe('{"key": "value"}');
  });

  it('does not strip trailing ``` when no opening fence', () => {
    const input = '{"key": "value"}\n```';
    expect(removeJsonMarkers(input)).toBe('{"key": "value"}\n```');
  });

  it('does not strip opening ```json when no closing fence', () => {
    const input = '```json\n{"key": "value"}';
    expect(removeJsonMarkers(input)).toBe('```json\n{"key": "value"}');
  });

  it('handles empty content between fences', () => {
    const input = '```json\n\n```';
    expect(removeJsonMarkers(input)).toBe('');
  });
});

describe('parseJsonFromMarkdown', () => {
  it('parses JSON from a ```json fenced string', () => {
    const input = '```json\n{"key": "value"}\n```';
    expect(parseJsonFromMarkdown(input)).toEqual({ key: 'value' });
  });

  it('parses plain JSON', () => {
    expect(parseJsonFromMarkdown('{"a": 1}')).toEqual({ a: 1 });
  });

  it('parses generic fenced JSON', () => {
    const input = '```\n[1, 2, 3]\n```';
    expect(parseJsonFromMarkdown(input)).toEqual([1, 2, 3]);
  });

  it('parses complex nested JSON', () => {
    const input = '```json\n{"arr": [1, {"nested": true}], "num": 42}\n```';
    expect(parseJsonFromMarkdown(input)).toEqual({ arr: [1, { nested: true }], num: 42 });
  });

  it('throws on invalid JSON', () => {
    expect(() => parseJsonFromMarkdown('{invalid}')).toThrow();
  });

  it('throws on invalid JSON inside fences', () => {
    expect(() => parseJsonFromMarkdown('```json\n{bad}\n```')).toThrow();
  });

  it('parses a JSON string value', () => {
    expect(parseJsonFromMarkdown('"hello"')).toBe('hello');
  });

  it('parses a JSON number', () => {
    expect(parseJsonFromMarkdown('42')).toBe(42);
  });

  it('parses a JSON boolean', () => {
    expect(parseJsonFromMarkdown('true')).toBe(true);
  });

  it('parses JSON null', () => {
    expect(parseJsonFromMarkdown('null')).toBeNull();
  });
});
