import { describe, it, expect } from 'vitest';
import { wait } from '../../src/utils/wait';

describe('wait', () => {
  it('resolves after the specified duration', async () => {
    const start = Date.now();
    await wait(50);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(45);
    expect(elapsed).toBeLessThan(200);
  });

  it('resolves with undefined', async () => {
    const result = await wait(0);
    expect(result).toBeUndefined();
  });

  it('resolves immediately with 0 ms', async () => {
    const start = Date.now();
    await wait(0);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(100);
  });

  it('returns a Promise', () => {
    expect(wait(0) instanceof Promise).toBe(true);
  });
});
