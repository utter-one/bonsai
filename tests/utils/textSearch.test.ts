import { describe, it, expect } from 'vitest';
import { parseTextSearch, buildTextSearchCondition } from '../../src/utils/textSearch';
import { pgTable, varchar, jsonb } from 'drizzle-orm/pg-core';

const mockTable = pgTable('mock', {
  name: varchar('name'),
  description: varchar('description'),
  tags: jsonb('tags'),
});

describe('textSearch', () => {
  describe('parseTextSearch', () => {
    it('identifies tag searches with "tag:" prefix', () => {
      const result = parseTextSearch('tag:important');
      expect(result).toEqual({ type: 'tag', value: 'important' });
    });

    it('trims whitespace from tag value', () => {
      const result = parseTextSearch('tag:  important  ');
      expect(result).toEqual({ type: 'tag', value: 'important' });
    });

    it('returns text type for non-tag searches', () => {
      const result = parseTextSearch('hello world');
      expect(result).toEqual({ type: 'text', value: 'hello world' });
    });

    it('preserves full search string for text type', () => {
      const result = parseTextSearch('some query with spaces');
      expect(result.value).toBe('some query with spaces');
    });

    it('handles empty string as text type', () => {
      const result = parseTextSearch('');
      expect(result).toEqual({ type: 'text', value: '' });
    });

    it('handles "tag:" prefix alone as tag with empty value', () => {
      const result = parseTextSearch('tag:');
      expect(result).toEqual({ type: 'tag', value: '' });
    });

    it('does not treat string starting with "tag" (no colon) as a tag search', () => {
      const result = parseTextSearch('tagging something');
      expect(result).toEqual({ type: 'text', value: 'tagging something' });
    });
  });

  describe('buildTextSearchCondition', () => {
    it('returns undefined for text search with no columns', () => {
      const result = buildTextSearchCondition('hello', []);
      expect(result).toBeUndefined();
    });

    it('returns single ilike condition for one column', () => {
      const result = buildTextSearchCondition('hello', [mockTable.name]);
      expect(result).toBeDefined();
    });

    it('returns OR condition for multiple columns', () => {
      const result = buildTextSearchCondition('hello', [mockTable.name, mockTable.description]);
      expect(result).toBeDefined();
    });

    it('wraps search term with wildcards in SQL', () => {
      const result = buildTextSearchCondition('searchterm', [mockTable.name]);
      expect(result).toBeDefined();
    });

    it('returns undefined for tag search without tagsColumn', () => {
      const result = buildTextSearchCondition('tag:mytag', [mockTable.name]);
      expect(result).toBeUndefined();
    });

    it('builds JSONB containment for tag search with tagsColumn', () => {
      const result = buildTextSearchCondition('tag:mytag', [mockTable.name], mockTable.tags);
      expect(result).toBeDefined();
    });
  });
});
