import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { SOURCE_IDS } from '../../services/analytics/sources';

extendZodWithOpenApi(z);

// ==================
// Source Catalog Response
// ==================

/** Schema for a dimension entry in the source catalog */
export const sourceDimensionSchema = z.object({
  id: z.string().describe('Dimension identifier used in groupBy[] and filters'),
  label: z.string().describe('Human-readable label'),
  values: z.array(z.string()).optional().describe('Known enumerable values, if applicable'),
}).openapi('SourceDimension');

/** Schema for a metric entry in the source catalog */
export const sourceMetricSchema = z.object({
  id: z.string().describe('Metric identifier used in metrics[] after the aggregation function'),
  label: z.string().describe('Human-readable label'),
  unit: z.enum(['ms', 'tokens', 'count', 'boolean']).describe('Unit of measurement'),
}).openapi('SourceMetric');

/** Schema for a single source entry in the catalog */
export const sourceEntrySchema = z.object({
  id: z.string().describe('Source identifier used in the source query parameter'),
  label: z.string().describe('Human-readable label'),
  description: z.string().describe('Description of what this source provides'),
  dimensions: z.array(sourceDimensionSchema).describe('Available dimensions for groupBy and filtering'),
  metrics: z.array(sourceMetricSchema).describe('Available numeric metrics for aggregation'),
}).openapi('SourceEntry');

/** Schema for the source catalog response */
export const sourceCatalogResponseSchema = z.object({
  sources: z.array(sourceEntrySchema).describe('List of all available analytics sources'),
}).openapi('SourceCatalogResponse');

/** Inferred type for the source catalog response */
export type SourceCatalogResponse = z.infer<typeof sourceCatalogResponseSchema>;

// ==================
// Slice Query Request
// ==================

/** Schema for the slice-and-dice analytics query parameters */
export const sliceQuerySchema = z.object({
  source: z.enum(SOURCE_IDS as [string, ...string[]]).describe('Analytics source to query'),
  groupBy: z.preprocess((val) => (typeof val === 'string' ? [val] : val), z.array(z.string()).max(5).default([])).describe('Dimension IDs to group results by (max 5)'),
  interval: z.enum(['hour', 'day', 'week', 'month']).optional().describe('Time bucket interval for time-series aggregation'),
  metrics: z.preprocess((val) => (typeof val === 'string' ? [val] : val), z.array(z.string()).min(1).max(10)).describe('Metric specifications: "count" or "{aggFn}:{metricId}" (e.g. "avg:durationMs", "p95:totalTurnDurationMs")'),
  from: z.coerce.date().optional().describe('Start of the date range (inclusive). ISO 8601 format.'),
  to: z.coerce.date().optional().describe('End of the date range (inclusive). ISO 8601 format.'),
  conversationId: z.string().optional().describe('Filter to a single conversation'),
  filters: z.record(z.string(), z.string()).optional().describe('Additional equality filters: key = dimension ID, value = exact match value'),
  limit: z.coerce.number().int().min(1).max(10000).default(1000).describe('Maximum number of rows to return (default 1000, max 10000)'),
}).openapi('SliceQuery');

/** Inferred type for slice query parameters */
export type SliceQuery = {
  source: string;
  groupBy: string[];
  interval?: 'hour' | 'day' | 'week' | 'month';
  metrics: string[];
  from?: Date;
  to?: Date;
  conversationId?: string;
  filters?: Record<string, string>;
  limit: number;
};

// ==================
// Slice Query Response
// ==================

/** Schema for a single row in the slice query response */
export const sliceQueryRowSchema = z.object({
  bucket: z.string().nullable().describe('Time bucket start (ISO 8601) if interval is set, null otherwise'),
  dimensions: z.record(z.string(), z.string().nullable()).describe('Dimension values for this group'),
  metrics: z.record(z.string(), z.number().nullable()).describe('Metric values for this group, keyed by the metric spec from the request'),
}).openapi('SliceQueryRow');

/** Schema for the slice query response */
export const sliceQueryResponseSchema = z.object({
  source: z.string().describe('Source that was queried'),
  interval: z.string().optional().describe('Time bucket interval used, if any'),
  groupBy: z.array(z.string()).describe('Dimensions that results are grouped by'),
  metrics: z.array(z.string()).describe('Metric specifications that were computed'),
  rows: z.array(sliceQueryRowSchema).describe('Result rows'),
}).openapi('SliceQueryResponse');

/** Inferred type for the slice query response */
export type SliceQueryResponse = z.infer<typeof sliceQueryResponseSchema>;
