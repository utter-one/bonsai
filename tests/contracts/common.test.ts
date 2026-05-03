import { describe, it, expect } from 'vitest';
import { listParamsSchema, projectScopedParamsSchema } from '../../src/http/contracts/common';

describe('contracts/common', () => {
  describe('listParamsSchema', () => {
    it('accepts minimal valid params (all defaults)', () => {
      const result = listParamsSchema.parse({});
      expect(result.offset).toBe(0);
      expect(result.limit).toBe(100);
      expect(result.textSearch).toBeUndefined();
      expect(result.orderBy).toBeUndefined();
      expect(result.filters).toBeUndefined();
    });

    it('accepts all parameters', () => {
      const result = listParamsSchema.parse({
        offset: 10,
        limit: 50,
        textSearch: 'hello',
        orderBy: ['-createdAt', 'name'],
        groupBy: 'status',
        filters: { status: 'active', age: { op: 'gte', value: 18 } },
      });
      expect(result.offset).toBe(10);
      expect(result.limit).toBe(50);
      expect(result.textSearch).toBe('hello');
      expect(result.orderBy).toEqual(['-createdAt', 'name']);
    });

    it('accepts single orderBy string', () => {
      const result = listParamsSchema.parse({ orderBy: '-createdAt' });
      expect(result.orderBy).toBe('-createdAt');
    });

    it('rejects negative offset', () => {
      expect(() => listParamsSchema.parse({ offset: -1 })).toThrow();
    });

    it('clamps limit to MAX_LIST_LIMIT (1000)', () => {
      expect(() => listParamsSchema.parse({ limit: 1001 })).toThrow();
    });

    it('rejects zero limit', () => {
      expect(() => listParamsSchema.parse({ limit: 0 })).toThrow();
    });

    it('rejects negative limit', () => {
      expect(() => listParamsSchema.parse({ limit: -5 })).toThrow();
    });

    it('accepts nullable textSearch', () => {
      const result = listParamsSchema.parse({ textSearch: null });
      expect(result.textSearch).toBeNull();
    });

    it('accepts filter operations via listParamsSchema', () => {
      const validOps = ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'like', 'in', 'nin', 'between'];
      for (const op of validOps) {
        const result = listParamsSchema.parse({
          filters: {
            field: {
              op,
              value: op === 'between' ? [1, 10] : 'test',
            },
          },
        });
        expect(result.filters).toBeDefined();
      }
    });

    it('accepts various filter value types', () => {
      const result = listParamsSchema.parse({
        filters: {
          stringFilter: 'hello',
          numberFilter: 42,
          booleanFilter: true,
          arrayStringFilter: ['a', 'b', 'c'],
          arrayNumberFilter: [1, 2, 3],
        },
      });
      expect(result.filters).toBeDefined();
    });

    it('rejects invalid filter operation', () => {
      expect(() =>
        listParamsSchema.parse({
          filters: { field: { op: 'invalid_op', value: 'x' } },
        })
      ).toThrow();
    });
  });

  describe('projectScopedParamsSchema', () => {
    it('accepts valid projectId', () => {
      const result = projectScopedParamsSchema.parse({ projectId: 'proj_123' });
      expect(result.projectId).toBe('proj_123');
    });

    it('rejects empty projectId', () => {
      expect(() => projectScopedParamsSchema.parse({ projectId: '' })).toThrow();
    });

    it('rejects missing projectId', () => {
      expect(() => projectScopedParamsSchema.parse({})).toThrow();
    });
  });
});
