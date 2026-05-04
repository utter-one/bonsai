import { describe, it, expect } from 'vitest';
import { deepMerge } from '../../src/utils/deepMerge';

describe('deepMerge', () => {
  it('merges two flat objects', () => {
    const result = deepMerge({ a: 1 }, { b: 2 });
    expect(result).toEqual({ a: 1, b: 2 });
  });

  it('source overwrites target for the same key', () => {
    const result = deepMerge({ a: 1 }, { a: 2 });
    expect(result).toEqual({ a: 2 });
  });

  it('recursively merges nested objects', () => {
    const result = deepMerge(
      { a: { b: 1, c: 2 } },
      { a: { c: 3, d: 4 } }
    );
    expect(result).toEqual({ a: { b: 1, c: 3, d: 4 } });
  });

  it('does not mutate the target object', () => {
    const target = { a: { b: 1 } };
    deepMerge(target, { a: { c: 2 } });
    expect(target).toEqual({ a: { b: 1 } });
  });

  it('does not mutate the source object', () => {
    const source = { a: { c: 2 } };
    deepMerge({ a: { b: 1 } }, source);
    expect(source).toEqual({ a: { c: 2 } });
  });

  it('replaces arrays instead of concatenating', () => {
    const result = deepMerge({ a: [1, 2] }, { a: [3, 4] });
    expect(result).toEqual({ a: [3, 4] });
  });

  it('overwrites object with primitive from source', () => {
    const result = deepMerge({ a: { b: 1 } }, { a: 'string' });
    expect(result).toEqual({ a: 'string' });
  });

  it('overwrites primitive with object from source', () => {
    const result = deepMerge({ a: 1 }, { a: { b: 2 } });
    expect(result).toEqual({ a: { b: 2 } });
  });

  it('handles null in source (overwrites target)', () => {
    const result = deepMerge({ a: 1 }, { a: null });
    expect(result).toEqual({ a: null });
  });

  it('handles undefined in source (overwrites target)', () => {
    const result = deepMerge({ a: 1 }, { a: undefined });
    expect(result).toEqual({ a: undefined });
  });

  it('does not recurse into null target value', () => {
    const result = deepMerge({ a: null }, { a: { b: 1 } });
    expect(result).toEqual({ a: { b: 1 } });
  });

  it('does not recurse into array target value', () => {
    const result = deepMerge({ a: [1] }, { a: { b: 2 } });
    expect(result).toEqual({ a: { b: 2 } });
  });

  it('handles deeply nested objects', () => {
    const result = deepMerge(
      { a: { b: { c: { d: 1 } } } },
      { a: { b: { c: { e: 2 } } } }
    );
    expect(result).toEqual({ a: { b: { c: { d: 1, e: 2 } } } });
  });

  it('handles empty objects', () => {
    expect(deepMerge({}, {})).toEqual({});
    expect(deepMerge({ a: 1 }, {})).toEqual({ a: 1 });
    expect(deepMerge({}, { a: 1 })).toEqual({ a: 1 });
  });

  it('preserves keys only in target', () => {
    const result = deepMerge({ a: 1, b: 2 }, { c: 3 });
    expect(result).toEqual({ a: 1, b: 2, c: 3 });
  });

  it('handles boolean and number primitives', () => {
    const result = deepMerge(
      { a: true, b: 0, c: '' },
      { a: false, b: 1, c: 'hello' }
    );
    expect(result).toEqual({ a: false, b: 1, c: 'hello' });
  });
});
