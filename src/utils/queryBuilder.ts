import { eq, and, gte, lte, gt, lt, ne, like, inArray, notInArray, between, SQL, asc, desc } from 'drizzle-orm';
import type { ListFilter, ListFilterOperation } from '../http/contracts/common';
import type { Logger } from 'pino';

/**
 * Converts a value to a Date object if it's an ISO 8601 string, otherwise returns the value as-is
 * @param value - The value to potentially convert
 * @returns Date object if value is an ISO string, otherwise the original value
 */
function convertToDateIfIsoString(value: any): any {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z?$/.test(value)) {
    return new Date(value);
  }
  return value;
}

/**
 * Converts array values to Date objects if they are ISO 8601 strings
 * @param values - Array of values to potentially convert
 * @returns Array with ISO strings converted to Date objects
 */
function convertArrayToDateIfIsoString(values: any[]): any[] {
  return values.map(convertToDateIfIsoString);
}

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
    return eq(column, convertToDateIfIsoString(filter) as any);
  }

  // Handle array filters (IN operation)
  if (Array.isArray(filter)) {
    return inArray(column as any, convertArrayToDateIfIsoString(filter));
  }

  // Handle operation filters
  if (typeof filter === 'object' && 'op' in filter) {
    const operation = filter as ListFilterOperation;
    switch (operation.op) {
      case 'eq':
        return eq(column, convertToDateIfIsoString(operation.value) as any);
      case 'ne':
        return ne(column, convertToDateIfIsoString(operation.value) as any);
      case 'gt':
        return gt(column as any, convertToDateIfIsoString(operation.value) as any);
      case 'gte':
        return gte(column as any, convertToDateIfIsoString(operation.value) as any);
      case 'lt':
        return lt(column as any, convertToDateIfIsoString(operation.value) as any);
      case 'lte':
        return lte(column as any, convertToDateIfIsoString(operation.value) as any);
      case 'like':
        return like(column as any, operation.value as string);
      case 'in':
        return inArray(column as any, Array.isArray(operation.value) ? convertArrayToDateIfIsoString(operation.value as any[]) : operation.value as any);
      case 'nin':
        return notInArray(column as any, Array.isArray(operation.value) ? convertArrayToDateIfIsoString(operation.value as any[]) : operation.value as any);
      case 'between':
        const values = operation.value as [number, number] | [string, string];
        const convertedValues: [any, any] = [convertToDateIfIsoString(values[0]), convertToDateIfIsoString(values[1])];
        return between(column as any, convertedValues[0], convertedValues[1]);
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
