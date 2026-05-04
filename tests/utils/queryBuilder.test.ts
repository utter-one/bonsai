import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildFilterCondition, buildOrderBy } from '../../src/utils/queryBuilder';
import { pgTable, varchar, integer, boolean, timestamp } from 'drizzle-orm/pg-core';
import { PgDialect } from 'drizzle-orm/pg-core/dialect';

const mockTable = pgTable('mock', {
  name: varchar('name'),
  age: integer('age'),
  active: boolean('active'),
  createdAt: timestamp('created_at'),
});

let mockLogger: { warn: ReturnType<typeof vi.fn> };
const dialect = new PgDialect();
const columnMap = {
  name: mockTable.name,
  age: mockTable.age,
  active: mockTable.active,
  createdAt: mockTable.createdAt,
};

function toQuery(sql: any) {
  return dialect.sqlToQuery(sql);
}

describe('queryBuilder', () => {
  beforeEach(() => {
    mockLogger = { warn: vi.fn() };
  });

  describe('buildFilterCondition', () => {
    it('returns null for unknown field and logs a warning', () => {
      const result = buildFilterCondition('unknown_field', 'value', columnMap, mockLogger);
      expect(result).toBeNull();
      expect(mockLogger.warn).toHaveBeenCalledWith({ field: 'unknown_field' }, 'Unknown filter field');
    });

    describe('simple value filters (eq)', () => {
      it('builds eq condition for string value with correct param', () => {
        const result = buildFilterCondition('name', 'John', columnMap, mockLogger);
        const query = toQuery(result);
        expect(query.sql).toBe('"mock"."name" = $1');
        expect(query.params).toEqual(['John']);
      });

      it('builds eq condition for number value with correct param', () => {
        const result = buildFilterCondition('age', 25, columnMap, mockLogger);
        const query = toQuery(result);
        expect(query.sql).toBe('"mock"."age" = $1');
        expect(query.params).toEqual([25]);
      });

      it('builds eq condition for boolean value with correct param', () => {
        const result = buildFilterCondition('active', true, columnMap, mockLogger);
        const query = toQuery(result);
        expect(query.sql).toBe('"mock"."active" = $1');
        expect(query.params).toEqual([true]);
      });

      it('builds eq condition for false boolean', () => {
        const result = buildFilterCondition('active', false, columnMap, mockLogger);
        const query = toQuery(result);
        expect(query.sql).toBe('"mock"."active" = $1');
        expect(query.params).toEqual([false]);
      });
    });

    describe('array filters (in)', () => {
      it('builds inArray condition for string array with correct params', () => {
        const result = buildFilterCondition('name', ['John', 'Jane'], columnMap, mockLogger);
        const query = toQuery(result);
        expect(query.sql).toBe('"mock"."name" in ($1, $2)');
        expect(query.params).toEqual(['John', 'Jane']);
      });

      it('builds inArray condition for number array with correct params', () => {
        const result = buildFilterCondition('age', [18, 25, 30], columnMap, mockLogger);
        const query = toQuery(result);
        expect(query.sql).toBe('"mock"."age" in ($1, $2, $3)');
        expect(query.params).toEqual([18, 25, 30]);
      });

      it('builds inArray condition for single-element array', () => {
        const result = buildFilterCondition('age', [42], columnMap, mockLogger);
        const query = toQuery(result);
        expect(query.sql).toBe('"mock"."age" in ($1)');
        expect(query.params).toEqual([42]);
      });
    });

    describe('operation filters', () => {
      it('handles eq operation with correct SQL and param', () => {
        const result = buildFilterCondition('age', { op: 'eq', value: 25 }, columnMap, mockLogger);
        const query = toQuery(result);
        expect(query.sql).toBe('"mock"."age" = $1');
        expect(query.params).toEqual([25]);
      });

      it('handles ne operation with correct SQL and param', () => {
        const result = buildFilterCondition('age', { op: 'ne', value: 25 }, columnMap, mockLogger);
        const query = toQuery(result);
        expect(query.sql).toBe('"mock"."age" <> $1');
        expect(query.params).toEqual([25]);
      });

      it('handles gt operation with correct SQL and param', () => {
        const result = buildFilterCondition('age', { op: 'gt', value: 18 }, columnMap, mockLogger);
        const query = toQuery(result);
        expect(query.sql).toBe('"mock"."age" > $1');
        expect(query.params).toEqual([18]);
      });

      it('handles gte operation with correct SQL and param', () => {
        const result = buildFilterCondition('age', { op: 'gte', value: 18 }, columnMap, mockLogger);
        const query = toQuery(result);
        expect(query.sql).toBe('"mock"."age" >= $1');
        expect(query.params).toEqual([18]);
      });

      it('handles lt operation with correct SQL and param', () => {
        const result = buildFilterCondition('age', { op: 'lt', value: 65 }, columnMap, mockLogger);
        const query = toQuery(result);
        expect(query.sql).toBe('"mock"."age" < $1');
        expect(query.params).toEqual([65]);
      });

      it('handles lte operation with correct SQL and param', () => {
        const result = buildFilterCondition('age', { op: 'lte', value: 65 }, columnMap, mockLogger);
        const query = toQuery(result);
        expect(query.sql).toBe('"mock"."age" <= $1');
        expect(query.params).toEqual([65]);
      });

      it('handles like operation with correct SQL and param', () => {
        const result = buildFilterCondition('name', { op: 'like', value: '%John%' }, columnMap, mockLogger);
        const query = toQuery(result);
        expect(query.sql).toBe('"mock"."name" like $1');
        expect(query.params).toEqual(['%John%']);
      });

      it('handles in operation with correct SQL and params', () => {
        const result = buildFilterCondition('age', { op: 'in', value: [18, 25, 30] }, columnMap, mockLogger);
        const query = toQuery(result);
        expect(query.sql).toBe('"mock"."age" in ($1, $2, $3)');
        expect(query.params).toEqual([18, 25, 30]);
      });

      it('handles in operation with string array', () => {
        const result = buildFilterCondition('name', { op: 'in', value: ['Alice', 'Bob'] }, columnMap, mockLogger);
        const query = toQuery(result);
        expect(query.sql).toBe('"mock"."name" in ($1, $2)');
        expect(query.params).toEqual(['Alice', 'Bob']);
      });

      it('handles nin operation with correct SQL and params', () => {
        const result = buildFilterCondition('age', { op: 'nin', value: [1, 2, 3] }, columnMap, mockLogger);
        const query = toQuery(result);
        expect(query.sql).toBe('"mock"."age" not in ($1, $2, $3)');
        expect(query.params).toEqual([1, 2, 3]);
      });

      it('handles between operation with correct SQL and params', () => {
        const result = buildFilterCondition('age', { op: 'between', value: [18, 65] }, columnMap, mockLogger);
        const query = toQuery(result);
        expect(query.sql).toBe('"mock"."age" between $1 and $2');
        expect(query.params).toEqual([18, 65]);
      });

      it('handles between operation with string values', () => {
        const result = buildFilterCondition('name', { op: 'between', value: ['Alice', 'Charlie'] }, columnMap, mockLogger);
        const query = toQuery(result);
        expect(query.sql).toBe('"mock"."name" between $1 and $2');
        expect(query.params).toEqual(['Alice', 'Charlie']);
      });

      it('returns null for unknown operation and logs a warning', () => {
        const result = buildFilterCondition('age', { op: 'unknown_op', value: 25 } as any, columnMap, mockLogger);
        expect(result).toBeNull();
        expect(mockLogger.warn).toHaveBeenCalledWith({ operation: 'unknown_op' }, 'Unknown filter operation');
      });
    });

    describe('ISO date conversion', () => {
      it('converts ISO string to Date for simple eq filter', () => {
        const result = buildFilterCondition('createdAt', '2024-01-15T10:30:00Z', columnMap, mockLogger);
        const query = toQuery(result);
        expect(query.sql).toBe('"mock"."created_at" = $1');
        expect(query.params[0]).toBe('2024-01-15T10:30:00.000Z');
      });

      it('converts ISO string without trailing Z (treated as local time)', () => {
        const result = buildFilterCondition('createdAt', '2024-01-15T10:30:00', columnMap, mockLogger);
        const query = toQuery(result);
        expect(query.sql).toBe('"mock"."created_at" = $1');
        expect(typeof query.params[0]).toBe('string');
        expect(query.params[0]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      });

      it('converts ISO strings in array filter', () => {
        const result = buildFilterCondition('createdAt', ['2024-01-15T10:30:00Z', '2024-01-16T10:30:00Z'], columnMap, mockLogger);
        const query = toQuery(result);
        expect(query.sql).toBe('"mock"."created_at" in ($1, $2)');
        expect(query.params[0]).toBe('2024-01-15T10:30:00.000Z');
        expect(query.params[1]).toBe('2024-01-16T10:30:00.000Z');
      });

      it('converts ISO strings in between operation', () => {
        const result = buildFilterCondition('createdAt', { op: 'between', value: ['2024-01-01T00:00:00Z', '2024-12-31T23:59:59Z'] }, columnMap, mockLogger);
        const query = toQuery(result);
        expect(query.sql).toBe('"mock"."created_at" between $1 and $2');
        expect(query.params[0]).toBe('2024-01-01T00:00:00.000Z');
        expect(query.params[1]).toBe('2024-12-31T23:59:59.000Z');
      });

      it('converts ISO strings in in operation', () => {
        const result = buildFilterCondition('createdAt', { op: 'in', value: ['2024-01-01T00:00:00Z', '2024-06-01T00:00:00Z'] }, columnMap, mockLogger);
        const query = toQuery(result);
        expect(query.params[0]).toBe('2024-01-01T00:00:00.000Z');
        expect(query.params[1]).toBe('2024-06-01T00:00:00.000Z');
      });

      it('converts ISO strings in nin operation', () => {
        const result = buildFilterCondition('createdAt', { op: 'nin', value: ['2024-01-01T00:00:00Z'] }, columnMap, mockLogger);
        const query = toQuery(result);
        expect(query.params[0]).toBe('2024-01-01T00:00:00.000Z');
      });

      it('converts ISO strings in gt operation', () => {
        const result = buildFilterCondition('createdAt', { op: 'gt', value: '2024-01-01T00:00:00Z' }, columnMap, mockLogger);
        const query = toQuery(result);
        expect(query.sql).toBe('"mock"."created_at" > $1');
        expect(query.params[0]).toBe('2024-01-01T00:00:00.000Z');
      });

      it('converts ISO strings in lt operation', () => {
        const result = buildFilterCondition('createdAt', { op: 'lt', value: '2024-12-31T23:59:59Z' }, columnMap, mockLogger);
        const query = toQuery(result);
        expect(query.sql).toBe('"mock"."created_at" < $1');
        expect(query.params[0]).toBe('2024-12-31T23:59:59.000Z');
      });

      it('converts ISO string with milliseconds', () => {
        const result = buildFilterCondition('createdAt', '2024-01-15T10:30:00.123Z', columnMap, mockLogger);
        const query = toQuery(result);
        expect(query.sql).toBe('"mock"."created_at" = $1');
        expect(query.params[0]).toBe('2024-01-15T10:30:00.123Z');
      });

      it('does not convert non-ISO strings', () => {
        const result = buildFilterCondition('name', 'not-a-date', columnMap, mockLogger);
        const query = toQuery(result);
        expect(query.params).toEqual(['not-a-date']);
      });

      it('does not convert partial date strings', () => {
        const result = buildFilterCondition('name', '2024-01', columnMap, mockLogger);
        const query = toQuery(result);
        expect(query.params).toEqual(['2024-01']);
      });

      it('does not convert empty strings', () => {
        const result = buildFilterCondition('name', '', columnMap, mockLogger);
        const query = toQuery(result);
        expect(query.params).toEqual(['']);
      });
    });

    describe('edge cases', () => {
      it('handles zero as a valid number value', () => {
        const result = buildFilterCondition('age', 0, columnMap, mockLogger);
        const query = toQuery(result);
        expect(query.params).toEqual([0]);
      });

      it('handles negative numbers', () => {
        const result = buildFilterCondition('age', { op: 'gt', value: -10 }, columnMap, mockLogger);
        const query = toQuery(result);
        expect(query.params).toEqual([-10]);
      });

      it('handles special characters in string values', () => {
        const result = buildFilterCondition('name', "O'Brien", columnMap, mockLogger);
        const query = toQuery(result);
        expect(query.params).toEqual(["O'Brien"]);
      });

      it('returns null for plain object without op property', () => {
        const result = buildFilterCondition('name', { foo: 'bar' } as any, columnMap, mockLogger);
        expect(result).toBeNull();
      });

      it('returns null for null filter value', () => {
        const result = buildFilterCondition('name', null as any, columnMap, mockLogger);
        expect(result).toBeNull();
      });

      it('returns null for undefined filter value', () => {
        const result = buildFilterCondition('name', undefined as any, columnMap, mockLogger);
        expect(result).toBeNull();
      });
    });
  });

  describe('buildOrderBy', () => {
    it('returns empty array for undefined', () => {
      expect(buildOrderBy(undefined, columnMap)).toEqual([]);
    });

    it('returns empty array for null', () => {
      expect(buildOrderBy(null, columnMap)).toEqual([]);
    });

    it('handles single string field as ascending', () => {
      const result = buildOrderBy('name', columnMap);
      expect(result).toHaveLength(1);
      const query = toQuery(result[0]);
      expect(query.sql).toBe('"mock"."name" asc');
    });

    it('handles array of fields as ascending', () => {
      const result = buildOrderBy(['name', 'age'], columnMap);
      expect(result).toHaveLength(2);
      expect(toQuery(result[0]).sql).toBe('"mock"."name" asc');
      expect(toQuery(result[1]).sql).toBe('"mock"."age" asc');
    });

    it('handles descending order with - prefix', () => {
      const result = buildOrderBy('-createdAt', columnMap);
      expect(result).toHaveLength(1);
      const query = toQuery(result[0]);
      expect(query.sql).toBe('"mock"."created_at" desc');
    });

    it('handles descending order for multiple fields', () => {
      const result = buildOrderBy(['-name', '-age'], columnMap);
      expect(result).toHaveLength(2);
      expect(toQuery(result[0]).sql).toBe('"mock"."name" desc');
      expect(toQuery(result[1]).sql).toBe('"mock"."age" desc');
    });

    it('handles mixed ascending and descending', () => {
      const result = buildOrderBy(['name', '-age'], columnMap);
      expect(result).toHaveLength(2);
      expect(toQuery(result[0]).sql).toBe('"mock"."name" asc');
      expect(toQuery(result[1]).sql).toBe('"mock"."age" desc');
    });

    it('skips unknown fields silently', () => {
      const result = buildOrderBy(['name', 'unknown_field'], columnMap);
      expect(result).toHaveLength(1);
      expect(toQuery(result[0]).sql).toBe('"mock"."name" asc');
    });

    it('returns empty array when all fields are unknown', () => {
      const result = buildOrderBy(['unknown1', 'unknown2'], columnMap);
      expect(result).toEqual([]);
    });

    it('preserves order of fields in output', () => {
      const result = buildOrderBy(['age', '-createdAt', 'name'], columnMap);
      expect(result).toHaveLength(3);
      expect(toQuery(result[0]).sql).toBe('"mock"."age" asc');
      expect(toQuery(result[1]).sql).toBe('"mock"."created_at" desc');
      expect(toQuery(result[2]).sql).toBe('"mock"."name" asc');
    });

    it('handles duplicate fields', () => {
      const result = buildOrderBy(['name', 'name'], columnMap);
      expect(result).toHaveLength(2);
      expect(toQuery(result[0]).sql).toBe('"mock"."name" asc');
      expect(toQuery(result[1]).sql).toBe('"mock"."name" asc');
    });
  });
});
