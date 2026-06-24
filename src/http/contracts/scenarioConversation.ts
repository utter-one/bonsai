import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { listParamsSchema, listResponseLimitSchema } from './common';
import type { ListParams } from './common';

extendZodWithOpenApi(z);

export { listParamsSchema, type ListParams };

/**
 * Schema for scenario conversation route params
 */
export const scenarioConversationRouteParamsSchema = z.object({
  projectId: z.string().min(1).describe('Project ID'),
  id: z.string().describe('Scenario Conversation ID'),
});

/**
 * Schema for list query params for scenario conversations
 * Extends standard list params with a scenarioRunId filter
 */
export const scenarioConversationListParamsSchema = listParamsSchema.extend({
  scenarioRunId: z.string().optional().describe('Filter conversations by scenario run ID'),
});

/**
 * Schema for scenario conversation response
 */
export const scenarioConversationResponseSchema = z.object({
  id: z.string().describe('Unique identifier for the scenario conversation'),
  projectId: z.string().describe('ID of the project this conversation belongs to'),
  scenarioRunId: z.string().describe('ID of the scenario run this conversation belongs to'),
  scenarioId: z.string().describe('ID of the scenario being tested'),
  testerId: z.string().describe('ID of the tester persona used in this conversation'),
  conversationId: z.string().nullable().describe('ID of the underlying conversation used to run this scenario conversation'),
  status: z.enum(['queued', 'in_progress', 'passed', 'failed', 'cancelled', 'error']).describe('Current execution status of this conversation'),
  testRunStatus: z.enum(['conversation_ended', 'conversation_aborted', 'conversation_failed', 'max_turns_reached', 'tester_hung_up']).nullable().describe('How the test conversation ended'),
  dataExtractionResults: z.record(z.string(), z.unknown()).nullable().describe('Extracted stage variable values at the end of the conversation'),
  dataTransformationResults: z.record(z.string(), z.unknown()).nullable().describe('Post-processed data transformation results'),
  testStatistics: z.object({
    passedTests: z.number().int().min(0).describe('Number of individual test assertions that passed'),
    failedTests: z.number().int().min(0).describe('Number of individual test assertions that failed'),
  }).nullable().describe('Detailed test statistics for this conversation'),
  metadata: z.record(z.string(), z.unknown()).nullable().describe('Additional metadata'),
  version: z.number().int().describe('Version number for optimistic locking'),
  createdAt: z.coerce.date().describe('Timestamp when the scenario conversation was created'),
  updatedAt: z.coerce.date().describe('Timestamp when the scenario conversation was last updated'),
});

/**
 * Schema for paginated list of scenario conversations
 */
export const scenarioConversationListResponseSchema = z.object({
  items: z.array(scenarioConversationResponseSchema).describe('Array of scenario conversations in the current page'),
  total: z.number().int().min(0).describe('Total number of scenario conversations matching the query'),
  offset: z.number().int().min(0).describe('Starting index of the current page'),
  limit: listResponseLimitSchema,
});

/** List query params for scenario conversations */
export type ScenarioConversationListParams = z.infer<typeof scenarioConversationListParamsSchema>;

/** Response for a single scenario conversation */
export type ScenarioConversationResponse = z.infer<typeof scenarioConversationResponseSchema>;

/** Response for paginated list of scenario conversations */
export type ScenarioConversationListResponse = z.infer<typeof scenarioConversationListResponseSchema>;
