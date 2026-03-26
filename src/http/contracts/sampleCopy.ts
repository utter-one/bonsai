import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { listParamsSchema, listResponseLimitSchema } from './common';
import type { ListParams } from './common';

extendZodWithOpenApi(z);

export { listParamsSchema, type ListParams };

/** Supported sampling methods for selecting content variants */
export type SamplingMethod = 'random' | 'round_robin';

export const sampleCopyRouteParamsSchema = z.object({
  projectId: z.string().min(1).describe('Project ID'),
  id: z.string().describe('Sample Copy ID'),
});

/**
 * Schema for creating a new sample copy
 * Required fields: name, promptTrigger, content
 * Optional fields: id, stages, agents, classifierOverrideId, amount, samplingMethod
 */
export const createSampleCopySchema = z.object({
  id: z.string().min(1).optional().describe('Unique identifier for the sample copy (auto-generated if not provided)'),
  name: z.string().min(1).describe('Display name of the sample copy, used as identifier throughout the system'),
  stages: z.array(z.string().min(1)).optional().describe('Optional array of stage IDs this sample copy applies to'),
  agents: z.array(z.string().min(1)).optional().describe('Optional array of agent IDs this sample copy applies to'),
  promptTrigger: z.string().min(1).describe('Trigger string used by the classifier to activate this sample copy'),
  classifierOverrideId: z.string().nullable().optional().describe('ID of the classifier to use; if not set the default classifier will be used'),
  content: z.array(z.string().min(1)).min(1).describe('Array of variant answers to select from'),
  amount: z.number().int().min(1).optional().default(1).describe('Number of samples to select from the content array'),
  samplingMethod: z.enum(['random', 'round_robin']).optional().default('random').describe('Method used to select samples: random selection or sequential round-robin'),
  decoratorId: z.string().nullable().optional().describe('ID of the copy decorator to apply to selected content; if not set no decoration is applied'),
});

/**
 * Schema for updating a sample copy
 * All fields are optional except version for optimistic locking
 */
export const updateSampleCopyBodySchema = z.object({
  name: z.string().min(1).optional().describe('Updated display name'),
  stages: z.array(z.string().min(1)).nullable().optional().describe('Updated array of stage IDs'),
  agents: z.array(z.string().min(1)).nullable().optional().describe('Updated array of agent IDs'),
  promptTrigger: z.string().min(1).optional().describe('Updated classifier trigger string'),
  classifierOverrideId: z.string().nullable().optional().describe('Updated classifier override ID'),
  content: z.array(z.string().min(1)).min(1).optional().describe('Updated array of variant answers'),
  amount: z.number().int().min(1).optional().describe('Updated number of samples to select'),
  samplingMethod: z.enum(['random', 'round_robin']).optional().describe('Updated sampling method'),
  decoratorId: z.string().nullable().optional().describe('Updated copy decorator ID; set to null to remove the decorator'),
  version: z.number().int().min(1).describe('Current version number for optimistic locking'),
});

/**
 * Schema for deleting a sample copy
 * Required field: version for optimistic locking
 */
export const deleteSampleCopyBodySchema = z.object({
  version: z.number().int().min(1).describe('Current version number for optimistic locking'),
});

/**
 * Schema for cloning a sample copy
 * All fields are optional - id defaults to auto-generated, name defaults to "{original name} (Clone)"
 */
export const cloneSampleCopySchema = z.object({
  id: z.string().min(1).optional().describe('New ID for the cloned sample copy (auto-generated if not provided)'),
  name: z.string().min(1).optional().describe('Name for the cloned sample copy (defaults to "{original name} (Clone)")'),
});

/**
 * Schema for sample copy response
 * Includes all fields from the database schema
 */
export const sampleCopyResponseSchema = z.object({
  id: z.string().describe('Unique identifier for the sample copy'),
  projectId: z.string().describe('ID of the project this sample copy belongs to'),
  name: z.string().describe('Display name of the sample copy'),
  stages: z.array(z.string()).nullable().describe('Array of stage IDs this sample copy applies to'),
  agents: z.array(z.string()).nullable().describe('Array of agent IDs this sample copy applies to'),
  promptTrigger: z.string().describe('Trigger string used by the classifier'),
  classifierOverrideId: z.string().nullable().describe('ID of the classifier override, or null if using the default'),
  content: z.array(z.string()).describe('Array of variant answers'),
  amount: z.number().int().describe('Number of samples to select'),
  samplingMethod: z.enum(['random', 'round_robin']).describe('Method used to select samples'),
  decoratorId: z.string().nullable().describe('ID of the copy decorator applied to selected content, or null if none'),
  version: z.number().int().describe('Version number for optimistic locking'),
  createdAt: z.coerce.date().describe('Timestamp when the sample copy was created'),
  updatedAt: z.coerce.date().describe('Timestamp when the sample copy was last updated'),
  archived: z.boolean().optional().describe('Whether this entity belongs to an archived project'),
});

/**
 * Schema for paginated list of sample copies
 * Includes pagination metadata: items, total count, offset, and limit
 */
export const sampleCopyListResponseSchema = z.object({
  items: z.array(sampleCopyResponseSchema).describe('Array of sample copies in the current page'),
  total: z.number().int().min(0).describe('Total number of sample copies matching the query'),
  offset: z.number().int().min(0).describe('Starting index of the current page'),
  limit: listResponseLimitSchema,
});

/** Request body for creating a new sample copy */
export type CreateSampleCopyRequest = z.infer<typeof createSampleCopySchema>;

/** Request body for updating a sample copy */
export type UpdateSampleCopyRequest = z.infer<typeof updateSampleCopyBodySchema>;

/** Request body for deleting a sample copy */
export type DeleteSampleCopyRequest = z.infer<typeof deleteSampleCopyBodySchema>;

/** Request body for cloning a sample copy */
export type CloneSampleCopyRequest = z.infer<typeof cloneSampleCopySchema>;

/** Response for a single sample copy */
export type SampleCopyResponse = z.infer<typeof sampleCopyResponseSchema>;

/** Response for paginated list of sample copies with metadata */
export type SampleCopyListResponse = z.infer<typeof sampleCopyListResponseSchema>;
