import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';

extendZodWithOpenApi(z);

/**
 * Schema for filter operations with explicit operator and value
 * Supports: eq, ne, gt, gte, lt, lte, like, in, nin, between
 */
const listFilterOperationSchema = z.object({
  op: z.enum(['like', 'eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'in', 'nin', 'between']).describe('Filter operator: eq (equals), ne (not equals), gt (greater than), gte (>=), lt (less than), lte (<=), like (pattern match), in (value in array), nin (not in array), between (range)'),
  value: z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.array(z.string()),
    z.array(z.number()),
    z.array(z.boolean()),
  ]).describe('Filter value to compare against. For "in", "nin", and "between" operations, use an array'),
});

/**
 * Schema for flexible filter values
 * Can be a direct value, array (for IN operations), or an operation object
 */
const listFilterSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.string()),
  z.array(z.number()),
  z.array(z.boolean()),
  listFilterOperationSchema,
]);

/**
 * Schema for list query parameters supporting filtering, sorting, pagination, and search
 * Query params:
 * - offset: Starting index for pagination (default: 0)
 * - limit: Maximum number of items to return (optional)
 * - textSearch: Full-text search query (optional)
 * - orderBy: Field(s) to sort by. Use '-' prefix for descending (e.g., '-createdAt')
 * - groupBy: Field(s) to group results by (optional)
 * - filters: Dynamic field filters as key-value pairs
 */
export const listParamsSchema = z.object({
  offset: z.coerce.number().int().min(0).default(0).describe('Starting index for pagination (default: 0)'),
  limit: z.coerce.number().int().positive().nullable().optional().describe('Maximum number of items to return (optional, null for no limit)'),
  textSearch: z.string().nullable().optional().describe('Full-text search query string (optional)'),
  orderBy: z.union([z.string(), z.array(z.string())]).nullable().optional().describe('Field(s) to sort by. Use "-" prefix for descending order (e.g., "-createdAt")'),
  groupBy: z.union([z.string(), z.array(z.string())]).nullable().optional().describe('Field(s) to group results by (optional)'),
  filters: z.record(z.string(), listFilterSchema).nullable().optional().describe('Dynamic field filters as key-value pairs. Values can be direct values, arrays (for IN), or operation objects'),
});

/** Filter operation with explicit operator (eq, ne, gt, gte, lt, lte, like, in, nin, between) and value */
export type ListFilterOperation = z.infer<typeof listFilterOperationSchema>;

/** Flexible filter value: direct value, array, or operation object */
export type ListFilter = z.infer<typeof listFilterSchema>;

/** List query parameters for filtering, sorting, pagination, and search */
export type ListParams = z.infer<typeof listParamsSchema>;
