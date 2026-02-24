import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { listParamsSchema } from './common';
import type { ListParams } from './common';

extendZodWithOpenApi(z);

export { listParamsSchema, type ListParams };

export const issueRouteParamsSchema = z.object({
  projectId: z.string().min(1).describe('Project ID'),
  id: z.string().describe('Issue ID'),
});

/**
 * Schema for creating a new issue
 * Required fields: environment, buildVersion, severity, category, bugDescription, expectedBehaviour, status
 * Optional fields: beat, sessionId, eventIndex, userId, comments
 */
export const createIssueSchema = z.object({
  environment: z.string().min(1).describe('Environment where issue occurred (e.g., production, staging, development)'),
  buildVersion: z.string().min(1).describe('Application build version where the issue was encountered'),
  beat: z.string().optional().describe('Beat/sprint identifier for tracking purposes'),
  sessionId: z.string().optional().describe('Reference to related conversation session ID'),
  eventIndex: z.number().int().optional().describe('Index of event in session where issue occurred'),
  userId: z.string().optional().describe('User ID who reported or encountered the issue'),
  severity: z.string().min(1).describe('Issue severity level (e.g., critical, high, medium, low)'),
  category: z.string().min(1).describe('Issue category or type (e.g., bug, feature, performance)'),
  bugDescription: z.string().min(1).describe('Detailed description of the bug or issue'),
  expectedBehaviour: z.string().min(1).describe('Description of the expected behavior'),
  comments: z.string().default('').describe('Additional comments or notes about the issue'),
  status: z.string().min(1).describe('Current issue status (e.g., open, in-progress, resolved, closed)'),
});

/**
 * Schema for updating an issue
 * All fields are optional to allow partial updates
 * Query parameters: filters[field][operator]=value (e.g., filters[status][eq]=open)
 */
export const updateIssueBodySchema = z.object({
  environment: z.string().min(1).optional().describe('Environment where issue occurred'),
  buildVersion: z.string().min(1).optional().describe('Application build version'),
  beat: z.string().optional().describe('Beat/sprint identifier'),
  sessionId: z.string().optional().describe('Related conversation session ID'),
  eventIndex: z.number().int().optional().describe('Event index in session'),
  userId: z.string().optional().describe('User ID who reported the issue'),
  severity: z.string().min(1).optional().describe('Issue severity level'),
  category: z.string().min(1).optional().describe('Issue category or type'),
  bugDescription: z.string().min(1).optional().describe('Detailed bug description'),
  expectedBehaviour: z.string().min(1).optional().describe('Expected behavior description'),
  comments: z.string().optional().describe('Additional comments or notes'),
  status: z.string().min(1).optional().describe('Current issue status'),
});

/**
 * Schema for issue response
 * Includes: all fields plus id, createdAt, updatedAt
 */
export const issueResponseSchema = z.object({
  id: z.number().int().describe('Unique auto-incrementing identifier for the issue'),
  projectId: z.string().describe('ID of the project this issue belongs to'),
  environment: z.string().describe('Environment where issue occurred'),
  buildVersion: z.string().describe('Application build version'),
  beat: z.string().nullable().describe('Beat/sprint identifier'),
  sessionId: z.string().nullable().describe('Related conversation session ID'),
  eventIndex: z.number().int().nullable().describe('Event index in session'),
  userId: z.string().nullable().describe('User ID who reported the issue'),
  severity: z.string().describe('Issue severity level'),
  category: z.string().describe('Issue category or type'),
  bugDescription: z.string().describe('Detailed bug description'),
  expectedBehaviour: z.string().describe('Expected behavior description'),
  comments: z.string().describe('Additional comments or notes'),
  status: z.string().describe('Current issue status'),
  createdAt: z.coerce.date().describe('Timestamp when the issue was created'),
  updatedAt: z.coerce.date().describe('Timestamp when the issue was last updated'),
});

/**
 * Schema for paginated list of issues
 * Includes pagination metadata: items, total count, offset, and limit
 * Query parameters:
 * - offset: Starting index (default: 0)
 * - limit: Max items per page (default: null for all)
 * - textSearch: Search term for text fields
 * - filters[field][operator]=value: Field-specific filters (eq, ne, gt, gte, lt, lte, like, in)
 * - orderBy[field]=direction: Sort by field (asc or desc)
 */
export const issueListResponseSchema = z.object({
  items: z.array(issueResponseSchema).describe('Array of issues in the current page'),
  total: z.number().int().min(0).describe('Total number of issues matching the query'),
  offset: z.number().int().min(0).describe('Starting index of the current page'),
  limit: z.number().int().positive().nullable().describe('Maximum number of items per page (null if no limit)'),
});

/** Request body for creating a new issue */
export type CreateIssueRequest = z.infer<typeof createIssueSchema>;

/** Request body for updating an issue */
export type UpdateIssueRequest = z.infer<typeof updateIssueBodySchema>;

/** Response for a single issue */
export type IssueResponse = z.infer<typeof issueResponseSchema>;

/** Response for paginated list of issues with metadata */
export type IssueListResponse = z.infer<typeof issueListResponseSchema>;
