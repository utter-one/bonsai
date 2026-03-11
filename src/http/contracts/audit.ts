import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { listParamsSchema, listResponseLimitSchema } from './common';
import type { ListParams } from './common';

extendZodWithOpenApi(z);

export { listParamsSchema, type ListParams };

/**
 * Schema for audit log response
 * Includes all fields from the database schema
 */
export const auditLogResponseSchema = z.object({
  id: z.string().describe('Unique identifier for the audit log entry'),
  userId: z.string().nullable().describe('ID of the operator user who performed the action'),
  action: z.string().describe('Action performed (CREATE, UPDATE, DELETE)'),
  entityId: z.string().describe('ID of the entity that was modified'),
  entityType: z.string().describe('Type of the entity (e.g., "operator", "agent", "classifier")'),
  projectId: z.string().nullable().describe('ID of the project associated with the entity'),
  oldEntity: z.record(z.string(), z.unknown()).nullable().describe('Entity state before the change'),
  newEntity: z.record(z.string(), z.unknown()).nullable().describe('Entity state after the change'),
  createdAt: z.coerce.date().describe('Timestamp when the audit log was created'),
});

/**
 * Schema for paginated list of audit logs
 * Includes pagination metadata: items, total count, offset, and limit
 * 
 * Query parameters:
 * - offset: Starting index for pagination (default: 0)
 * - limit: Maximum number of items to return (optional)
 * - textSearch: Search query for action field
 * - orderBy: Field(s) to sort by, use '-' prefix for descending (e.g., '-createdAt')
 * - filters: Dynamic filters such as:
 *   - entityType: Filter by entity type (e.g., 'operator', 'agent')
 *   - action: Filter by action type (e.g., 'CREATE', 'UPDATE', 'DELETE')
 *   - userId: Filter by operator user ID
 *   - entityId: Filter by entity ID
 *   - createdAt: Filter by creation date with operators (e.g., {op: 'gte', value: '2024-01-01'})
 */
export const auditLogListResponseSchema = z.object({
  items: z.array(auditLogResponseSchema).describe('Array of audit logs in the current page'),
  total: z.number().int().min(0).describe('Total number of audit logs matching the query'),
  offset: z.number().int().min(0).describe('Starting index of the current page'),
  limit: listResponseLimitSchema,
});

/** Response for a single audit log */
export type AuditLogResponse = z.infer<typeof auditLogResponseSchema>;

/** Response for paginated list of audit logs with metadata */
export type AuditLogListResponse = z.infer<typeof auditLogListResponseSchema>;
