import type { Logger } from 'pino';
import { eq, and, gte, lte, gt, lt, ne, like, inArray, notInArray, between, SQL, asc, desc } from 'drizzle-orm';
import type { ListFilter, ListFilterOperation } from '../api/common';

/**
 * Builds a SQL condition from a filter specification
 * @param field - The field name to filter on
 * @param filter - The filter value or operation
 * @param columnMap - Map of field names to database columns
 * @param logger - Logger instance for warnings
 * @returns SQL condition or null if field is unknown
 */
export function buildFilterCondition(
  field: string,
  filter: ListFilter,
  columnMap: Record<string, any>,
  logger: Logger
): SQL | null {
  const column = columnMap[field];
  if (!column) {
    logger.warn({ field }, 'Unknown filter field');
    return null;
  }

  // Handle simple value filters
  if (typeof filter === 'string' || typeof filter === 'number' || typeof filter === 'boolean') {
    return eq(column, filter as any);
  }

  // Handle array filters (IN operation)
  if (Array.isArray(filter)) {
    return inArray(column as any, filter);
  }

  // Handle operation filters
  if (typeof filter === 'object' && 'op' in filter) {
    const operation = filter as ListFilterOperation;
    switch (operation.op) {
      case 'eq':
        return eq(column, operation.value as any);
      case 'ne':
        return ne(column, operation.value as any);
      case 'gt':
        return gt(column as any, operation.value as any);
      case 'gte':
        return gte(column as any, operation.value as any);
      case 'lt':
        return lt(column as any, operation.value as any);
      case 'lte':
        return lte(column as any, operation.value as any);
      case 'like':
        return like(column as any, operation.value as string);
      case 'in':
        return inArray(column as any, operation.value as any[]);
      case 'nin':
        return notInArray(column as any, operation.value as any[]);
      case 'between':
        const values = operation.value as [number, number];
        return between(column as any, values[0], values[1]);
      default:
        logger.warn({ operation: operation.op }, 'Unknown filter operation');
        return null;
    }
  }

  return null;
}

/**
 * Builds order by clause from string or array of strings
 * @param orderBy - Field(s) to sort by. Use '-' prefix for descending (e.g., '-createdAt')
 * @param columnMap - Map of field names to database columns
 * @returns Array of SQL order clauses
 */
export function buildOrderBy(orderBy: string[] | string | null | undefined, columnMap: Record<string, any>): any[] {
  if (!orderBy) return [];

  const orderFields = Array.isArray(orderBy) ? orderBy : [orderBy];
  const orderClauses: any[] = [];

  for (const field of orderFields) {
    const isDescending = field.startsWith('-');
    const fieldName = isDescending ? field.substring(1) : field;
    const column = columnMap[fieldName];

    if (column) {
      orderClauses.push(isDescending ? desc(column) : asc(column));
    }
  }

  return orderClauses;
}
