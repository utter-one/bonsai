import { describe, it, expect } from 'vitest';

describe('smoke test', () => {
  it('vitest is running', () => {
    expect(1 + 1).toBe(2);
  });

  it('reflect-metadata is loaded (tsyringe prerequisite)', () => {
    expect(typeof Reflect.metadata).toBe('function');
  });
});
