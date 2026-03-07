import { SQL, sql } from 'drizzle-orm';
import { db } from '../db/index';

export const DEFAULT_LIST_LIMIT = 100;
export const MAX_LIST_LIMIT = 1000;

/**
 * Normalizes requested list limits to a safe server-side range.
 * @param limit - Requested page size
 * @returns Bounded page size
 */
export function normalizeListLimit(limit?: number | null): number {
  if (!Number.isFinite(limit)) {
    return DEFAULT_LIST_LIMIT;
  }

  return Math.min(Math.max(Math.trunc(limit), 1), MAX_LIST_LIMIT);
}

/**
 * Counts rows matching an optional filter without materializing them in memory.
 * @param table - Database table to count from
 * @param whereCondition - Optional SQL filter
 * @returns Number of matching rows
 */
export async function countRows(table: any, whereCondition?: SQL): Promise<number> {
  const [result] = await db.select({ count: sql<number>`count(*)::int` }).from(table).where(whereCondition);

  return result?.count ?? 0;
}