import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/db/index', () => ({
  db: {
    select: vi.fn(),
  },
}));

import { normalizeListLimit, DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT } from '../../src/utils/pagination';

describe('pagination', () => {
  describe('normalizeListLimit', () => {
    it('returns DEFAULT_LIST_LIMIT for undefined', () => {
      expect(normalizeListLimit(undefined)).toBe(DEFAULT_LIST_LIMIT);
    });

    it('returns DEFAULT_LIST_LIMIT for null', () => {
      expect(normalizeListLimit(null)).toBe(DEFAULT_LIST_LIMIT);
    });

    it('returns DEFAULT_LIST_LIMIT for NaN', () => {
      expect(normalizeListLimit(NaN)).toBe(DEFAULT_LIST_LIMIT);
    });

    it('returns DEFAULT_LIST_LIMIT for Infinity', () => {
      expect(normalizeListLimit(Infinity)).toBe(DEFAULT_LIST_LIMIT);
    });

    it('returns DEFAULT_LIST_LIMIT for -Infinity', () => {
      expect(normalizeListLimit(-Infinity)).toBe(DEFAULT_LIST_LIMIT);
    });

    it('clamps negative values to 1', () => {
      expect(normalizeListLimit(-10)).toBe(1);
    });

    it('clamps zero to 1', () => {
      expect(normalizeListLimit(0)).toBe(1);
    });

    it('returns the value for valid range', () => {
      expect(normalizeListLimit(50)).toBe(50);
      expect(normalizeListLimit(1)).toBe(1);
      expect(normalizeListLimit(MAX_LIST_LIMIT)).toBe(MAX_LIST_LIMIT);
    });

    it('clamps values above MAX_LIST_LIMIT', () => {
      expect(normalizeListLimit(MAX_LIST_LIMIT + 1)).toBe(MAX_LIST_LIMIT);
      expect(normalizeListLimit(99999)).toBe(MAX_LIST_LIMIT);
    });

    it('truncates decimal values', () => {
      expect(normalizeListLimit(50.9)).toBe(50);
    });
  });

  describe('constants', () => {
    it('DEFAULT_LIST_LIMIT is 100', () => {
      expect(DEFAULT_LIST_LIMIT).toBe(100);
    });

    it('MAX_LIST_LIMIT is 1000', () => {
      expect(MAX_LIST_LIMIT).toBe(1000);
    });
  });
});
