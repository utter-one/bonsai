import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { listParamsSchema, listResponseLimitSchema } from './common';
import type { ListParams } from './common';
import {
  effectSchema,
  endConversationEffectSchema,
  abortConversationEffectSchema,
  goToStageEffectSchema,
  modifyUserInputEffectSchema,
  modifyVariablesEffectSchema,
  variableOperationSchema,
  callToolEffectSchema,
} from '../../types/actions';
import type {
  Effect,
  EndConversationEffect,
  AbortConversationEffect,
  GoToStageEffect,
  ModifyUserInputEffect,
  ModifyVariablesEffect,
  VariableOperation,
  CallToolEffect,
} from '../../types/actions';

extendZodWithOpenApi(z);

export { listParamsSchema, type ListParams };

export const guardrailRouteParamsSchema = z.object({
  projectId: z.string().min(1).describe('Project ID'),
  id: z.string().describe('Guardrail ID'),
});

export {
  effectSchema,
  endConversationEffectSchema,
  abortConversationEffectSchema,
  goToStageEffectSchema,
  modifyUserInputEffectSchema,
  modifyVariablesEffectSchema,
  variableOperationSchema,
  callToolEffectSchema,
};
export type {
  Effect,
  EndConversationEffect,
  AbortConversationEffect,
  GoToStageEffect,
  ModifyUserInputEffect,
  ModifyVariablesEffect,
  VariableOperation,
  CallToolEffect,
};

/**
 * Schema for creating a new guardrail.
 * Guardrails are always-on behavior control actions that fire on every stage regardless of stage configuration.
 * They share the project-level guardrail classifier and do not support per-action classifier overrides or parameter extraction.
 */
export const createGuardrailSchema = z.object({
  id: z.string().min(1).optional().describe('Unique identifier for the guardrail (auto-generated if not provided)'),
  name: z.string().min(1).describe('Display name of the guardrail'),
  condition: z.string().nullable().optional().describe('Optional JavaScript condition expression — when provided, the guardrail is only active when it evaluates to truthy'),
  classificationTrigger: z.string().nullable().optional().describe('Classification label that the guardrail classifier should output to trigger this guardrail'),
  effects: z.array(effectSchema).optional().describe('Array of effects to execute when the guardrail is triggered'),
  examples: z.array(z.string()).optional().describe('Example phrases that trigger this guardrail, used to help the classifier'),
  tags: z.array(z.string()).optional().default([]).describe('Tags for categorizing and filtering this guardrail'),
  metadata: z.record(z.string(), z.unknown()).optional().describe('Additional guardrail-specific metadata'),
});

/**
 * Schema for updating a guardrail.
 * All fields are optional except version for optimistic locking.
 */
export const updateGuardrailBodySchema = z.object({
  name: z.string().min(1).optional().describe('Updated display name'),
  condition: z.string().nullable().optional().describe('Updated condition expression'),
  classificationTrigger: z.string().nullable().optional().describe('Updated classification trigger label'),
  effects: z.array(effectSchema).optional().describe('Updated effects array'),
  examples: z.array(z.string()).optional().describe('Updated example phrases'),
  tags: z.array(z.string()).optional().describe('Updated tags'),
  metadata: z.record(z.string(), z.unknown()).optional().describe('Updated metadata'),
  version: z.number().int().min(1).describe('Current version number for optimistic locking'),
});

/**
 * Schema for deleting a guardrail.
 */
export const deleteGuardrailBodySchema = z.object({
  version: z.number().int().min(1).describe('Current version number for optimistic locking'),
});

/**
 * Schema for the guardrail response object.
 */
export const guardrailResponseSchema = z.object({
  id: z.string().describe('Unique identifier for the guardrail'),
  projectId: z.string().describe('ID of the project this guardrail belongs to'),
  name: z.string().describe('Display name of the guardrail'),
  condition: z.string().nullable().describe('Condition expression for guardrail activation'),
  classificationTrigger: z.string().nullable().describe('Classification label that triggers this guardrail'),
  effects: z.array(effectSchema).describe('Array of effects to execute'),
  examples: z.array(z.string()).nullable().describe('Example phrases that trigger this guardrail'),
  tags: z.array(z.string()).describe('Tags for categorizing and filtering this guardrail'),
  metadata: z.record(z.string(), z.unknown()).nullable().describe('Additional metadata'),
  version: z.number().int().describe('Version number for optimistic locking'),
  createdAt: z.coerce.date().describe('Timestamp when the guardrail was created'),
  updatedAt: z.coerce.date().describe('Timestamp when the guardrail was last updated'),
  archived: z.boolean().optional().describe('Whether this entity belongs to an archived project'),
});

/**
 * Schema for paginated list of guardrails.
 */
export const guardrailListResponseSchema = z.object({
  items: z.array(guardrailResponseSchema).describe('Array of guardrails in the current page'),
  total: z.number().int().min(0).describe('Total number of guardrails matching the query'),
  offset: z.number().int().min(0).describe('Starting index of the current page'),
  limit: listResponseLimitSchema,
});

/**
 * Schema for cloning a guardrail.
 */
export const cloneGuardrailSchema = z.object({
  id: z.string().min(1).optional().describe('New ID for the cloned guardrail (auto-generated if not provided)'),
  name: z.string().min(1).optional().describe('Name for the cloned guardrail (defaults to "{original name} (Clone)")'),
});

/** Request body for creating a new guardrail */
export type CreateGuardrailRequest = z.infer<typeof createGuardrailSchema>;

/** Request body for updating a guardrail */
export type UpdateGuardrailRequest = z.infer<typeof updateGuardrailBodySchema>;

/** Request body for deleting a guardrail */
export type DeleteGuardrailRequest = z.infer<typeof deleteGuardrailBodySchema>;

/** Request body for cloning a guardrail */
export type CloneGuardrailRequest = z.infer<typeof cloneGuardrailSchema>;

/** Response for a single guardrail */
export type GuardrailResponse = z.infer<typeof guardrailResponseSchema>;

/** Response for a paginated list of guardrails */
export type GuardrailListResponse = z.infer<typeof guardrailListResponseSchema>;
