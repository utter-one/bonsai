import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { listParamsSchema, listResponseLimitSchema } from './common';
import type { ListParams } from './common';
import { conversationEventDataSchema, conversationEventTypeSchema } from '../../types/conversationEvents';

extendZodWithOpenApi(z);

export { listParamsSchema, type ListParams };

/**
 * Schema for artifact summary (inline with conversation)
 */
export const artifactSummarySchema = z.object({
  id: z.string().describe('Unique identifier for the artifact'),
  artifactType: z.string().describe('Type of artifact'),
  fileSize: z.number().int().describe('Size of the artifact in bytes'),
  createdAt: z.coerce.date().describe('Timestamp when the artifact was created'),
});

/** Response for artifact summary */
export type ArtifactSummary = z.infer<typeof artifactSummarySchema>;

/**
 * Schema for artifact response
 */
export const artifactResponseSchema = z.object({
  id: z.string().describe('Unique identifier for the artifact'),
  artifactType: z.string().describe('Type of artifact (e.g., user_voice, ai_voice)'),
  storageKey: z.string().nullable().describe('Storage key in the storage provider'),
  storageUrl: z.string().nullable().describe('URL of the artifact in storage'),
  mimeType: z.string().describe('MIME type of the artifact'),
  fileSize: z.number().int().describe('Size of the artifact in bytes'),
  metadata: z.record(z.string(), z.unknown()).nullable().describe('Additional metadata for the artifact'),
  createdAt: z.coerce.date().describe('Timestamp when the artifact was created'),
}).openapi('ArtifactResponse');

/**
 * Schema for paginated list of artifacts
 */
export const artifactListResponseSchema = z.object({
  items: z.array(artifactResponseSchema).describe('Array of artifacts in the current page'),
  total: z.number().int().min(0).describe('Total number of artifacts matching the query'),
  offset: z.number().int().min(0).describe('Starting index of the current page'),
  limit: listResponseLimitSchema,
});

/**
 * Schema for artifact route params
 */
export const conversationArtifactRouteParamsSchema = z.object({
  projectId: z.string().min(1).describe('Project ID'),
  id: z.string().describe('Conversation ID'),
  artifactId: z.string().describe('Artifact ID'),
});

/**
 * Schema for artifact query params (filter by type)
 */
export const listArtifactsQuerySchema = listParamsSchema.extend({
  type: z.enum(['user_voice', 'user_transcript', 'ai_voice', 'ai_transcript', 'tool_input', 'tool_output', 'other']).optional().describe('Filter artifacts by type'),
});

/** Response for a single artifact */
export type ArtifactResponse = z.infer<typeof artifactResponseSchema>;

/** Response for paginated list of artifacts with metadata */
export type ArtifactListResponse = z.infer<typeof artifactListResponseSchema>;

/** Response for artifact route params */
export type ConversationArtifactRouteParams = z.infer<typeof conversationArtifactRouteParamsSchema>;

/** Response for artifact query params */
export type ListArtifactsQuery = z.infer<typeof listArtifactsQuerySchema>;

/**
 * Schema for conversation route params
 */
export const conversationRouteParamsSchema = z.object({
  projectId: z.string().min(1).describe('Project ID'),
  id: z.string().describe('Conversation ID'),
});

/**
 * Schema for conversation event route params
 */
export const conversationEventRouteParamsSchema = z.object({
  projectId: z.string().min(1).describe('Project ID'),
  id: z.string().describe('Conversation ID'),
  eventId: z.string().describe('Event ID'),
});

/**
 * Schema for conversation state structure
 * Contains variables and current actions for the conversation
 */
export const conversationStateSchema = z.object({
  variables: z.record(z.string(), z.record(z.string(), z.unknown())).describe('Variables stored in the conversation state'),
  currentActions: z.array(z.string()).describe('Array of currently active action identifiers'),
});

/**
 * Schema for conversation response
 * Includes: id, projectId, userId, sessionId, stageId, stageVars, status, statusDetails, metadata, createdAt, updatedAt
 */
export const conversationResponseSchema = z.object({
  id: z.string().describe('Unique identifier for the conversation'),
  projectId: z.string().describe('Identifier of the project this conversation belongs to'),
  userId: z.string().describe('Identifier of the user associated with this conversation'),
  sessionId: z.string().describe('ID of the WebSocket session that initiated this conversation'),
  stageId: z.string().describe('Current stage identifier for the conversation'),
  startingStageId: z.string().nullable().describe('Stage identifier at the start of the conversation'),
  endingStageId: z.string().nullable().describe('Stage identifier when the conversation reached a terminal state (finished/failed/aborted)'),
  stageVars: z.record(z.string(), z.record(z.string(), z.unknown())).nullable().describe('Variables stored per stage in the conversation'),
  status: z.string().describe('Current status of the conversation (e.g., initialized, active, completed, failed)'),
  statusDetails: z.string().nullable().describe('Optional details about the current status'),
  direction: z.enum(['incoming', 'outgoing']).describe('Direction of the conversation – incoming (user-initiated) or outgoing (Bonsai-initiated)'),
  metadata: z.record(z.string(), z.unknown()).nullable().describe('Additional metadata associated with the conversation'),
  createdAt: z.coerce.date().describe('Timestamp when the conversation was created'),
  updatedAt: z.coerce.date().describe('Timestamp when the conversation was last updated'),
  archived: z.boolean().optional().describe('Whether this entity belongs to an archived project'),
  artifacts: z.array(artifactSummarySchema).optional().describe('Summary of artifacts associated with this conversation'),
});

/**
 * Schema for paginated list of conversations
 * Includes pagination metadata: items, total count, offset, and limit
 */
export const conversationListResponseSchema = z.object({
  items: z.array(conversationResponseSchema).describe('Array of conversations in the current page'),
  total: z.number().int().min(0).describe('Total number of conversations matching the query'),
  offset: z.number().int().min(0).describe('Starting index of the current page'),
  limit: listResponseLimitSchema,
});

/**
 * Schema for conversation event response
 * Includes: id, conversationId, eventType, eventData, timestamp, metadata
 */
export const conversationEventResponseSchema = z.object({
  id: z.string().describe('Unique identifier for the conversation event'),
  projectId: z.string().describe('ID of the project this event belongs to'),
  conversationId: z.string().describe('Identifier of the conversation this event belongs to'),
  eventType: conversationEventTypeSchema.describe('Type of the conversation event'),
  eventData: conversationEventDataSchema.describe('Event data payload'),
  stageId: z.string().nullable().describe('ID of the stage that was active when the event occurred'),
  timestamp: z.coerce.date().describe('Timestamp when the event occurred'),
  metadata: z.record(z.string(), z.unknown()).nullable().describe('Additional metadata associated with the event'),
});

/**
 * Schema for paginated list of conversation events
 * Includes pagination metadata: items, total count, offset, and limit
 */
export const conversationEventListResponseSchema = z.object({
  items: z.array(conversationEventResponseSchema).describe('Array of conversation events in the current page'),
  total: z.number().int().min(0).describe('Total number of events matching the query'),
  offset: z.number().int().min(0).describe('Starting index of the current page'),
  limit: listResponseLimitSchema,
});

/** Response for a single conversation */
export type ConversationResponse = z.infer<typeof conversationResponseSchema>;

/** Response for paginated list of conversations with metadata */
export type ConversationListResponse = z.infer<typeof conversationListResponseSchema>;

/** Response for a single conversation event */
export type ConversationEventResponse = z.infer<typeof conversationEventResponseSchema>;

/** Response for paginated list of conversation events with metadata */
export type ConversationEventListResponse = z.infer<typeof conversationEventListResponseSchema>;
