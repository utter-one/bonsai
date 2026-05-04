import { describe, it, expect, beforeEach } from 'vitest';
import { parseTextSearch, buildTextSearchCondition } from '../../src/utils/textSearch';
import { pgTable, varchar, text, jsonb } from 'drizzle-orm/pg-core';
import { PgDialect } from 'drizzle-orm/pg-core/dialect';

const mockTable = pgTable('mock', {
  name: varchar('name'),
  description: text('description'),
  tags: jsonb('tags'),
});

const dialect = new PgDialect();

function toQuery(sql: any) {
  return dialect.sqlToQuery(sql);
}

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

    it('handles "tag:" with only whitespace as tag with empty value', () => {
      const result = parseTextSearch('tag:   ');
      expect(result).toEqual({ type: 'tag', value: '' });
    });

    it('does not treat string starting with "tag" (no colon) as a tag search', () => {
      const result = parseTextSearch('tagging something');
      expect(result).toEqual({ type: 'text', value: 'tagging something' });
    });

    it('does not treat uppercase "TAG:" as a tag search', () => {
      const result = parseTextSearch('TAG:important');
      expect(result).toEqual({ type: 'text', value: 'TAG:important' });
    });

    it('preserves special characters in tag value', () => {
      const result = parseTextSearch('tag:foo-bar_baz');
      expect(result).toEqual({ type: 'tag', value: 'foo-bar_baz' });
    });

    it('preserves special characters in text value', () => {
      const result = parseTextSearch('hello@world.com');
      expect(result).toEqual({ type: 'text', value: 'hello@world.com' });
    });
  });

  describe('buildTextSearchCondition', () => {
    describe('text search (ilike)', () => {
      it('returns undefined for text search with no columns', () => {
        const result = buildTextSearchCondition('hello', []);
        expect(result).toBeUndefined();
      });

      it('returns single ilike condition for one column with correct SQL and param', () => {
        const result = buildTextSearchCondition('hello', [mockTable.name]);
        const query = toQuery(result);
        expect(query.sql).toBe('"mock"."name" ilike $1');
        expect(query.params).toEqual(['%hello%']);
      });

      it('returns OR condition for two columns with correct SQL and params', () => {
        const result = buildTextSearchCondition('hello', [mockTable.name, mockTable.description]);
        const query = toQuery(result);
        expect(query.sql).toBe('("mock"."name" ilike $1 or "mock"."description" ilike $2)');
        expect(query.params).toEqual(['%hello%', '%hello%']);
      });

      it('returns OR condition for three columns with correct SQL and params', () => {
        const thirdCol = mockTable.name;
        const result = buildTextSearchCondition('test', [mockTable.name, mockTable.description, thirdCol]);
        const query = toQuery(result);
        expect(query.sql).toBe('("mock"."name" ilike $1 or "mock"."description" ilike $2 or "mock"."name" ilike $3)');
        expect(query.params).toEqual(['%test%', '%test%', '%test%']);
      });

      it('wraps search term with wildcards (% on both sides)', () => {
        const result = buildTextSearchCondition('searchterm', [mockTable.name]);
        const query = toQuery(result);
        expect(query.params[0]).toBe('%searchterm%');
      });

      it('preserves special characters in search term', () => {
        const result = buildTextSearchCondition("O'Brien", [mockTable.name]);
        const query = toQuery(result);
        expect(query.params[0]).toBe("%O'Brien%");
      });

      it('handles search term with leading/trailing spaces', () => {
        const result = buildTextSearchCondition('  hello  ', [mockTable.name]);
        const query = toQuery(result);
        expect(query.params[0]).toBe('%  hello  %');
      });

      it('handles empty search term (still builds condition with just wildcards)', () => {
        const result = buildTextSearchCondition('', [mockTable.name]);
        const query = toQuery(result);
        expect(query.sql).toBe('"mock"."name" ilike $1');
        expect(query.params[0]).toBe('%%');
      });

      it('returns undefined for "tag:" prefix without tagsColumn (does not fall through to text)', () => {
        const result = buildTextSearchCondition('tag:', [mockTable.name]);
        expect(result).toBeUndefined();
      });
    });

    describe('tag search (jsonb containment)', () => {
      it('returns undefined for tag search without tagsColumn', () => {
        const result = buildTextSearchCondition('tag:mytag', [mockTable.name]);
        expect(result).toBeUndefined();
      });

      it('returns undefined for tag search without tagsColumn even with multiple text columns', () => {
        const result = buildTextSearchCondition('tag:mytag', [mockTable.name, mockTable.description]);
        expect(result).toBeUndefined();
      });

      it('builds JSONB containment condition for tag search with tagsColumn', () => {
        const result = buildTextSearchCondition('tag:mytag', [mockTable.name], mockTable.tags);
        const query = toQuery(result);
        expect(query.sql).toBe('"mock"."tags" @> $1::jsonb');
        expect(query.params).toEqual(['["mytag"]']);
      });

      it('ignores textColumns when doing tag search (only uses tagsColumn)', () => {
        const result = buildTextSearchCondition('tag:urgent', [mockTable.name, mockTable.description], mockTable.tags);
        const query = toQuery(result);
        expect(query.sql).toBe('"mock"."tags" @> $1::jsonb');
        expect(query.params).toEqual(['["urgent"]']);
      });

      it('handles tag value with special characters', () => {
        const result = buildTextSearchCondition('tag:foo-bar_baz', [mockTable.name], mockTable.tags);
        const query = toQuery(result);
        expect(query.params[0]).toBe('["foo-bar_baz"]');
      });

      it('handles tag value with spaces (after trim)', () => {
        const result = buildTextSearchCondition('tag:  my tag  ', [mockTable.name], mockTable.tags);
        const query = toQuery(result);
        expect(query.params[0]).toBe('["my tag"]');
      });

      it('handles empty tag value after parsing', () => {
        const result = buildTextSearchCondition('tag:', [mockTable.name], mockTable.tags);
        const query = toQuery(result);
        expect(query.sql).toBe('"mock"."tags" @> $1::jsonb');
        expect(query.params).toEqual(['[""]']);
      });

      it('handles tag search with empty textColumns array but valid tagsColumn', () => {
        const result = buildTextSearchCondition('tag:review', [], mockTable.tags);
        const query = toQuery(result);
        expect(query.sql).toBe('"mock"."tags" @> $1::jsonb');
        expect(query.params).toEqual(['["review"]']);
      });
    });

    describe('integration', () => {
      it('tag: prefix takes precedence over text columns', () => {
        const result = buildTextSearchCondition('tag:bug', [mockTable.name, mockTable.description], mockTable.tags);
        const query = toQuery(result);
        expect(query.sql).not.toContain('ilike');
        expect(query.sql).toContain('@>');
      });

      it('text search without tagsColumn ignores missing tags gracefully', () => {
        const result = buildTextSearchCondition('hello world', [mockTable.name], undefined);
        const query = toQuery(result);
        expect(query.sql).toBe('"mock"."name" ilike $1');
        expect(query.params[0]).toBe('%hello world%');
      });

      it('handles unicode characters in search term', () => {
        const result = buildTextSearchCondition('café', [mockTable.name]);
        const query = toQuery(result);
        expect(query.params[0]).toBe('%café%');
      });

      it('handles unicode characters in tag value', () => {
        const result = buildTextSearchCondition('tag:日本語', [mockTable.name], mockTable.tags);
        const query = toQuery(result);
        expect(query.params[0]).toBe('["日本語"]');
      });
    });
  });
});
