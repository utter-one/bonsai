import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { listParamsSchema } from './common';
import type { ListParams } from './common';

extendZodWithOpenApi(z);

export { listParamsSchema, type ListParams };

/**
 * Schema for conversation route params
 */
export const conversationRouteParamsSchema = z.object({
  id: z.string().describe('Conversation ID'),
});

/**
 * Schema for conversation event route params
 */
export const conversationEventRouteParamsSchema = z.object({
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
 * Includes: id, projectId, userId, clientId, stageId, state, status, statusReason, metadata, createdAt, updatedAt
 */
export const conversationResponseSchema = z.object({
  id: z.string().describe('Unique identifier for the conversation'),
  projectId: z.string().describe('Identifier of the project this conversation belongs to'),
  userId: z.string().describe('Identifier of the user associated with this conversation'),
  clientId: z.string().describe('Client identifier for the conversation'),
  stageId: z.string().describe('Current stage identifier for the conversation'),
  state: conversationStateSchema.describe('Current state of the conversation'),
  status: z.string().describe('Current status of the conversation (e.g., ongoing, completed, abandoned)'),
  statusReason: z.string().nullable().describe('Optional reason for the current status'),
  metadata: z.record(z.string(), z.unknown()).nullable().describe('Additional metadata associated with the conversation'),
  createdAt: z.coerce.date().describe('Timestamp when the conversation was created'),
  updatedAt: z.coerce.date().describe('Timestamp when the conversation was last updated'),
});

/**
 * Schema for paginated list of conversations
 * Includes pagination metadata: items, total count, offset, and limit
 */
export const conversationListResponseSchema = z.object({
  items: z.array(conversationResponseSchema).describe('Array of conversations in the current page'),
  total: z.number().int().min(0).describe('Total number of conversations matching the query'),
  offset: z.number().int().min(0).describe('Starting index of the current page'),
  limit: z.number().int().positive().nullable().describe('Maximum number of items per page (null if no limit)'),
});

/**
 * Schema for conversation event response
 * Includes: id, conversationId, eventType, eventData, timestamp, metadata
 */
export const conversationEventResponseSchema = z.object({
  id: z.string().describe('Unique identifier for the conversation event'),
  conversationId: z.string().describe('Identifier of the conversation this event belongs to'),
  eventType: z.string().describe('Type of the conversation event'),
  eventData: z.record(z.string(), z.unknown()).describe('Event data payload'),
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
  limit: z.number().int().positive().nullable().describe('Maximum number of items per page (null if no limit)'),
});

/** Response for a single conversation */
export type ConversationResponse = z.infer<typeof conversationResponseSchema>;

/** Response for paginated list of conversations with metadata */
export type ConversationListResponse = z.infer<typeof conversationListResponseSchema>;

/** Response for a single conversation event */
export type ConversationEventResponse = z.infer<typeof conversationEventResponseSchema>;

/** Response for paginated list of conversation events with metadata */
export type ConversationEventListResponse = z.infer<typeof conversationEventListResponseSchema>;
