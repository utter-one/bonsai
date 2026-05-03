import { describe, it, expect, vi } from 'vitest';
import { buildFilterCondition, buildOrderBy } from '../../src/utils/queryBuilder';
import { pgTable, varchar, integer, boolean } from 'drizzle-orm/pg-core';

const mockTable = pgTable('mock', {
  name: varchar('name'),
  age: integer('age'),
  active: boolean('active'),
  createdAt: varchar('created_at'),
});

const mockLogger = {
  warn: vi.fn(),
} as any;

describe('queryBuilder', () => {
  describe('buildFilterCondition', () => {
    const columnMap = {
      name: mockTable.name,
      age: mockTable.age,
      active: mockTable.active,
      createdAt: mockTable.createdAt,
    };

    it('returns null for unknown field', () => {
      const result = buildFilterCondition('unknown_field', 'value', columnMap, mockLogger);
      expect(result).toBeNull();
      expect(mockLogger.warn).toHaveBeenCalled();
    });

    it('builds eq condition for string value', () => {
      const result = buildFilterCondition('name', 'John', columnMap, mockLogger);
      expect(result).toBeDefined();
    });

    it('builds eq condition for number value', () => {
      const result = buildFilterCondition('age', 25, columnMap, mockLogger);
      expect(result).toBeDefined();
    });

    it('builds eq condition for boolean value', () => {
      const result = buildFilterCondition('active', true, columnMap, mockLogger);
      expect(result).toBeDefined();
    });

    it('builds inArray condition for array value', () => {
      const result = buildFilterCondition('name', ['John', 'Jane'], columnMap, mockLogger);
      expect(result).toBeDefined();
    });

    describe('operation filters', () => {
      it('handles eq operation', () => {
        const result = buildFilterCondition('age', { op: 'eq', value: 25 }, columnMap, mockLogger);
        expect(result).toBeDefined();
      });

      it('handles ne operation', () => {
        const result = buildFilterCondition('age', { op: 'ne', value: 25 }, columnMap, mockLogger);
        expect(result).toBeDefined();
      });

      it('handles gt operation', () => {
        const result = buildFilterCondition('age', { op: 'gt', value: 18 }, columnMap, mockLogger);
        expect(result).toBeDefined();
      });

      it('handles gte operation', () => {
        const result = buildFilterCondition('age', { op: 'gte', value: 18 }, columnMap, mockLogger);
        expect(result).toBeDefined();
      });

      it('handles lt operation', () => {
        const result = buildFilterCondition('age', { op: 'lt', value: 65 }, columnMap, mockLogger);
        expect(result).toBeDefined();
      });

      it('handles lte operation', () => {
        const result = buildFilterCondition('age', { op: 'lte', value: 65 }, columnMap, mockLogger);
        expect(result).toBeDefined();
      });

      it('handles like operation', () => {
        const result = buildFilterCondition('name', { op: 'like', value: '%John%' }, columnMap, mockLogger);
        expect(result).toBeDefined();
      });

      it('handles in operation', () => {
        const result = buildFilterCondition('age', { op: 'in', value: [18, 25, 30] }, columnMap, mockLogger);
        expect(result).toBeDefined();
      });

      it('handles nin operation', () => {
        const result = buildFilterCondition('age', { op: 'nin', value: [1, 2, 3] }, columnMap, mockLogger);
        expect(result).toBeDefined();
      });

      it('handles between operation', () => {
        const result = buildFilterCondition('age', { op: 'between', value: [18, 65] }, columnMap, mockLogger);
        expect(result).toBeDefined();
      });

      it('returns null for unknown operation', () => {
        const result = buildFilterCondition('age', { op: 'unknown_op', value: 25 } as any, columnMap, mockLogger);
        expect(result).toBeNull();
      });
    });

    describe('ISO date conversion', () => {
      it('converts ISO string to Date for simple filter', () => {
        const result = buildFilterCondition('createdAt', '2024-01-15T10:30:00Z', columnMap, mockLogger);
        expect(result).toBeDefined();
      });

      it('converts ISO strings in array filter', () => {
        const result = buildFilterCondition('createdAt', ['2024-01-15T10:30:00Z', '2024-01-16T10:30:00Z'], columnMap, mockLogger);
        expect(result).toBeDefined();
      });

      it('converts ISO strings in between operation', () => {
        const result = buildFilterCondition('createdAt', { op: 'between', value: ['2024-01-01T00:00:00Z', '2024-12-31T23:59:59Z'] }, columnMap, mockLogger);
        expect(result).toBeDefined();
      });

      it('does not convert non-ISO strings', () => {
        const result = buildFilterCondition('name', 'not-a-date', columnMap, mockLogger);
        expect(result).toBeDefined();
      });
    });
  });

  describe('buildOrderBy', () => {
    const columnMap = {
      name: mockTable.name,
      age: mockTable.age,
      createdAt: mockTable.createdAt,
    };

    it('returns empty array for undefined', () => {
      expect(buildOrderBy(undefined, columnMap)).toEqual([]);
    });

    it('returns empty array for null', () => {
      expect(buildOrderBy(null, columnMap)).toEqual([]);
    });

    it('handles single string field (ascending)', () => {
      const result = buildOrderBy('name', columnMap);
      expect(result).toHaveLength(1);
    });

    it('handles array of fields', () => {
      const result = buildOrderBy(['name', 'age'], columnMap);
      expect(result).toHaveLength(2);
    });

    it('handles descending order with - prefix', () => {
      const result = buildOrderBy('-createdAt', columnMap);
      expect(result).toHaveLength(1);
    });

    it('skips unknown fields', () => {
      const result = buildOrderBy(['name', 'unknown_field'], columnMap);
      expect(result).toHaveLength(1);
    });

    it('handles mixed ascending and descending', () => {
      const result = buildOrderBy(['name', '-age'], columnMap);
      expect(result).toHaveLength(2);
    });
  });
});
