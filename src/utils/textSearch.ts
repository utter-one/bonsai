import { ilike, or, sql } from 'drizzle-orm';
import type { SQL, Column } from 'drizzle-orm';

/** Parsed result of a textSearch string */
type TextSearchParsed = { type: 'tag'; value: string } | { type: 'text'; value: string };

/**
 * Parses a textSearch string and returns either an extracted tag or plain text.
 * Supports "tag:<tag>" prefix format for tag-based searches.
 * @param textSearch - The text search string from the request
 * @returns Parsed search with type 'tag' or 'text' and the extracted value
 */
export function parseTextSearch(textSearch: string): TextSearchParsed {
  const tagPrefix = 'tag:';
  if (textSearch.startsWith(tagPrefix)) {
    return { type: 'tag', value: textSearch.slice(tagPrefix.length).trim() };
  }
  return { type: 'text', value: textSearch };
}

/**
 * Builds a Drizzle ORM search condition for text search across multiple columns.
 * - If textSearch starts with "tag:", performs a JSONB array containment check on the tags column.
 * - Otherwise, performs case-insensitive ILIKE on all provided text columns combined with OR.
 * @param textSearch - The search string (may have "tag:" prefix)
 * @param textColumns - Array of Drizzle column references to search with ilike
 * @param tagsColumn - Optional Drizzle column reference for JSONB tags array search
 * @returns A Drizzle SQL condition or undefined if no condition can be built
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildTextSearchCondition(textSearch: string, textColumns: Column<any>[], tagsColumn?: Column<any>): SQL | undefined {
  const parsed = parseTextSearch(textSearch);

  if (parsed.type === 'tag') {
    if (!tagsColumn) return undefined;
    return sql`${tagsColumn} @> ${JSON.stringify([parsed.value])}::jsonb`;
  }

  const searchTerm = `%${parsed.value}%`;
  const conditions = textColumns.map(col => ilike(col, searchTerm));
  if (conditions.length === 0) return undefined;
  if (conditions.length === 1) return conditions[0] as SQL;
  return or(...conditions) as SQL;
}
