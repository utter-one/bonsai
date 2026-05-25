import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { listParamsSchema, listResponseLimitSchema } from './common';
import type { ListParams } from './common';

extendZodWithOpenApi(z);

export { listParamsSchema, type ListParams };

/** Comparison modes for evaluating expected values in scenario runs */
export const evaluationComparisonModeSchema = z.enum(['exists', 'not_exists', 'eq', 'contains', 'includes', 'matches', 'gt', 'gte', 'lt', 'lte', 'in', 'nin']).describe('Comparison mode: exists (value is non-null), not_exists (value is null), eq (strict equality), contains (string contains substring), includes (array includes item), matches (regex pattern match), gt (greater than), gte (>=), lt (<), lte (<=), in (value in array), nin (not in array)');

/** Schema for a post-processing expected value entry with mode and value */
export const expectedValueEntrySchema = z.object({
  value: z.unknown().optional().describe('Expected value to compare against'),
  mode: evaluationComparisonModeSchema.optional().describe('Comparison mode. Default is "eq" (strict equality)'),
}).openapi('ExpectedValueEntry');

/**
 * Schema for a single data extraction entry: a stage variable with an optional expected value and comparison mode.
 * Used to define what variables to extract at the end of a scenario run and what constitutes success.
 */
export const dataExtractionEntrySchema = z.object({
  stageId: z.string().min(1).describe('ID of the stage whose variable should be extracted'),
  varName: z.string().min(1).describe('Name of the stage variable to extract'),
  expectedValue: z.unknown().optional().describe('Expected value of the variable — defines a successful outcome when provided'),
  expectedMode: evaluationComparisonModeSchema.optional().describe('Comparison mode for this value. Default is "eq" (strict equality)'),
}).openapi('DataExtractionEntry');

/**
 * Schema for scenario route params
 */
export const scenarioRouteParamsSchema = z.object({
  projectId: z.string().min(1).describe('Project ID'),
  id: z.string().describe('Scenario ID'),
});

/**
 * Schema for creating a new scenario
 */
export const createScenarioSchema = z.object({
  id: z.string().min(1).optional().describe('Unique identifier for the scenario (auto-generated if not provided)'),
  name: z.string().min(1).describe('Display name of the scenario'),
  description: z.string().nullable().optional().describe('Detailed description of the scenario purpose and expected flow'),
  language: z.string().min(1).describe('Language code of the conversation (e.g. en-US)'),
  startingStageId: z.string().min(1).describe('ID of the stage where the conversation begins'),
  maxTurns: z.number().int().min(1).describe('Maximum number of conversation turns before the scenario is terminated'),
  endingStageIds: z.array(z.string()).optional().default([]).describe('Stage IDs that signal a successful conversation ending'),
  personaCanHangUp: z.boolean().optional().default(false).describe('Whether the tester persona is allowed to hang up the conversation'),
  conversationOpener: z.string().optional().describe('Opening message sent by the tester when the first stage awaits user input, instead of calling the LLM. Defaults to "[Conversation begins.]" when not set.'),
  dataExtraction: z.array(dataExtractionEntrySchema).optional().describe('Stage variables to extract at the end of the run and their expected values'),
  contextTransformerId: z.string().min(1).optional().describe('ID of the context transformer used to post-process extracted data'),
  dataPostProcessingExpected: z.record(z.string(), expectedValueEntrySchema).optional().describe('Expected values after post-processing — each entry has an optional value and comparison mode (default "eq")'),
  tags: z.array(z.string()).optional().default([]).describe('Tags for categorizing and filtering this scenario'),
  metadata: z.record(z.string(), z.unknown()).optional().describe('Additional scenario-specific metadata'),
});

/**
 * Schema for updating a scenario
 * All fields are optional except version for optimistic locking
 */
export const updateScenarioBodySchema = z.object({
  name: z.string().min(1).optional().describe('Updated display name'),
  description: z.string().nullable().optional().describe('Updated description'),
  language: z.string().min(1).optional().describe('Updated language code'),
  startingStageId: z.string().min(1).optional().describe('Updated starting stage ID'),
  maxTurns: z.number().int().min(1).optional().describe('Updated maximum turn count'),
  endingStageIds: z.array(z.string()).optional().describe('Updated ending stage IDs'),
  personaCanHangUp: z.boolean().optional().describe('Updated hang-up flag'),
  conversationOpener: z.string().nullable().optional().describe('Updated conversation opener message'),
  dataExtraction: z.array(dataExtractionEntrySchema).optional().describe('Updated data extraction configuration'),
  contextTransformerId: z.string().min(1).nullable().optional().describe('Updated context transformer ID'),
  dataPostProcessingExpected: z.record(z.string(), expectedValueEntrySchema).nullable().optional().describe('Updated post-processing expected values — each entry has an optional value and comparison mode (default "eq")'),
  tags: z.array(z.string()).optional().describe('Updated tags'),
  metadata: z.record(z.string(), z.unknown()).optional().describe('Updated metadata'),
  version: z.number().int().min(1).describe('Current version number for optimistic locking'),
});

/**
 * Schema for deleting a scenario
 */
export const deleteScenarioBodySchema = z.object({
  version: z.number().int().min(1).describe('Current version number for optimistic locking'),
});

/**
 * Schema for scenario response
 */
export const scenarioResponseSchema = z.object({
  id: z.string().describe('Unique identifier for the scenario'),
  projectId: z.string().describe('ID of the project this scenario belongs to'),
  name: z.string().describe('Display name of the scenario'),
  description: z.string().nullable().describe('Detailed description of the scenario'),
  language: z.string().describe('Language code of the conversation'),
  startingStageId: z.string().describe('ID of the stage where the conversation begins'),
  maxTurns: z.number().int().describe('Maximum number of conversation turns'),
  endingStageIds: z.array(z.string()).describe('Stage IDs that signal a successful ending'),
  personaCanHangUp: z.boolean().describe('Whether the tester persona is allowed to hang up'),
  conversationOpener: z.string().nullable().describe('Opening message sent by the tester when the first stage awaits user input'),
  dataExtraction: z.array(dataExtractionEntrySchema).nullable().describe('Data extraction configuration'),
  contextTransformerId: z.string().nullable().describe('ID of the context transformer for post-processing'),
  dataPostProcessingExpected: z.record(z.string(), expectedValueEntrySchema).nullable().describe('Expected values after post-processing — each entry has an optional value and comparison mode (default "eq")'),
  tags: z.array(z.string()).describe('Tags for categorizing and filtering'),
  metadata: z.record(z.string(), z.unknown()).nullable().describe('Additional metadata'),
  version: z.number().int().describe('Version number for optimistic locking'),
  createdAt: z.coerce.date().describe('Timestamp when the scenario was created'),
  updatedAt: z.coerce.date().describe('Timestamp when the scenario was last updated'),
});

/**
 * Schema for paginated list of scenarios
 */
export const scenarioListResponseSchema = z.object({
  items: z.array(scenarioResponseSchema).describe('Array of scenarios in the current page'),
  total: z.number().int().min(0).describe('Total number of scenarios matching the query'),
  offset: z.number().int().min(0).describe('Starting index of the current page'),
  limit: listResponseLimitSchema,
});

/** Request body for creating a new scenario */
export type CreateScenarioRequest = z.infer<typeof createScenarioSchema>;

/** Request body for updating a scenario */
export type UpdateScenarioRequest = z.infer<typeof updateScenarioBodySchema>;

/** Request body for deleting a scenario */
export type DeleteScenarioRequest = z.infer<typeof deleteScenarioBodySchema>;

/** Comparison mode for evaluation assertions */
export type EvaluationComparisonMode = z.infer<typeof evaluationComparisonModeSchema>;

/** Single data extraction entry */
export type DataExtractionEntry = z.infer<typeof dataExtractionEntrySchema>;

/** Expected value entry with optional mode and value */
export type ExpectedValueEntry = z.infer<typeof expectedValueEntrySchema>;

/** Response for a single scenario */
export type ScenarioResponse = z.infer<typeof scenarioResponseSchema>;

/** Response for paginated list of scenarios */
export type ScenarioListResponse = z.infer<typeof scenarioListResponseSchema>;
