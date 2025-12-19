import { z } from 'zod';

/**
 * Schema for filter operations with explicit operator and value
 * Supports: eq, ne, gt, gte, lt, lte, like, in, nin, between
 */
const listFilterOperationSchema = z.object({
  op: z.enum(['like', 'eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'in', 'nin', 'between']),
  value: z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.array(z.string()),
    z.array(z.number()),
    z.array(z.boolean()),
  ]),
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
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().positive().nullable().optional(),
  textSearch: z.string().nullable().optional(),
  orderBy: z.union([z.string(), z.array(z.string())]).nullable().optional(),
  groupBy: z.union([z.string(), z.array(z.string())]).nullable().optional(),
  filters: z.record(z.string(), listFilterSchema).nullable().optional(),
});

/** Filter operation with explicit operator (eq, ne, gt, gte, lt, lte, like, in, nin, between) and value */
export type ListFilterOperation = z.infer<typeof listFilterOperationSchema>;

/** Flexible filter value: direct value, array, or operation object */
export type ListFilter = z.infer<typeof listFilterSchema>;

/** List query parameters for filtering, sorting, pagination, and search */
export type ListParams = z.infer<typeof listParamsSchema>;
