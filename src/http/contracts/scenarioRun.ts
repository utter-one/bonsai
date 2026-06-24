import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { listParamsSchema, listResponseLimitSchema } from './common';
import type { ListParams } from './common';

extendZodWithOpenApi(z);

export { listParamsSchema, type ListParams };

/** Possible statuses for a scenario run or scenario conversation */
export const scenarioRunStatusSchema = z.enum(['queued', 'in_progress', 'passed', 'failed', 'cancelled', 'error']).openapi('ScenarioRunStatus');

/**
 * Schema for scenario run route params
 */
export const scenarioRunRouteParamsSchema = z.object({
  projectId: z.string().min(1).describe('Project ID'),
  id: z.string().describe('Scenario Run ID'),
});

/**
 * Schema for creating a new scenario run
 */
export const createScenarioRunSchema = z.object({
  scenarioId: z.string().min(1).describe('ID of the scenario to run'),
  testers: z.record(z.string().min(1), z.number().int().min(1)).refine((v) => Object.keys(v).length >= 1, { message: 'At least one tester is required' }).describe('Map of tester persona ID to number of conversations to run for that tester'),
  metadata: z.record(z.string(), z.unknown()).optional().describe('Additional metadata for this run'),
});

/**
 * Schema for scenario run response
 */
export const scenarioRunResponseSchema = z.object({
  id: z.string().describe('Unique identifier for the scenario run'),
  projectId: z.string().describe('ID of the project this run belongs to'),
  scenarioId: z.string().describe('ID of the scenario being run'),
  testers: z.record(z.string(), z.number().int()).describe('Map of tester persona ID to number of conversations assigned to that tester'),
  totalConversations: z.number().int().describe('Computed total number of conversations across all testers'),
  status: scenarioRunStatusSchema.describe('Current status of the scenario run'),
  statusDetails: z.string().nullable().describe('Human-readable details about the current status, e.g. failure reason or cancellation actor'),
  errorCount: z.number().int().min(0).describe('Number of conversations that errored during execution (excluded from pass/fail evaluation)'),
  testStatistics: z.object({
    passedTests: z.number().int().min(0).describe('Total number of individual test assertions that passed across all conversations'),
    failedTests: z.number().int().min(0).describe('Total number of individual test assertions that failed across all conversations'),
  }).nullable().describe('Detailed test statistics for this run'),
  metadata: z.record(z.string(), z.unknown()).nullable().describe('Additional metadata'),
  version: z.number().int().describe('Version number for optimistic locking'),
  createdAt: z.coerce.date().describe('Timestamp when the run was created'),
  updatedAt: z.coerce.date().describe('Timestamp when the run was last updated'),
});

/**
 * Schema for paginated list of scenario runs
 */
export const scenarioRunListResponseSchema = z.object({
  items: z.array(scenarioRunResponseSchema).describe('Array of scenario runs in the current page'),
  total: z.number().int().min(0).describe('Total number of scenario runs matching the query'),
  offset: z.number().int().min(0).describe('Starting index of the current page'),
  limit: listResponseLimitSchema,
});

/** Request body for creating a new scenario run */
export type CreateScenarioRunRequest = z.infer<typeof createScenarioRunSchema>;

/** Response for a single scenario run */
export type ScenarioRunResponse = z.infer<typeof scenarioRunResponseSchema>;

/** Response for paginated list of scenario runs */
export type ScenarioRunListResponse = z.infer<typeof scenarioRunListResponseSchema>;
