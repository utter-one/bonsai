import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { listParamsSchema, listResponseLimitSchema } from './common';

extendZodWithOpenApi(z);

/** Deferred processing entry status */
export const deferredProcessingStatusSchema = z.enum(['pending', 'processed', 'failed', 'cancelled']).describe('Current status of the deferred processing entry');

/**
 * Schema for a single deferred processing entry response
 */
export const deferredProcessingResponseSchema = z.object({
  id: z.string().describe('Unique identifier for the deferred processing entry'),
  sessionId: z.string().describe('Session ID associated with this entry'),
  providerId: z.string().describe('Channel provider ID that received the original message'),
  projectId: z.string().describe('Project ID this entry belongs to'),
  conversationId: z.string().nullable().describe('Conversation ID if the message was for an existing conversation'),
  channelType: z.string().describe('Channel type (smtp_imap, sendgrid, ses, twilio_messaging, whatsapp, telegram)'),
  processAt: z.coerce.date().describe('Scheduled processing time — message will be dispatched after this timestamp'),
  message: z.record(z.string(), z.unknown()).describe('The original CAL input message that was queued'),
  status: deferredProcessingStatusSchema.describe('Current processing status'),
  retryCount: z.number().int().describe('Number of retry attempts so far'),
  lastError: z.string().nullable().describe('Error message from the last failed attempt, if any'),
  createdAt: z.coerce.date().describe('Timestamp when the entry was created'),
  updatedAt: z.coerce.date().describe('Timestamp when the entry was last updated'),
  processedAt: z.coerce.date().nullable().describe('Timestamp when the entry was successfully processed'),
}).openapi('DeferredProcessingEntry');

/**
 * Schema for paginated list of deferred processing entries
 */
export const deferredProcessingListResponseSchema = z.object({
  items: z.array(deferredProcessingResponseSchema).describe('Array of deferred processing entries'),
  total: z.number().int().min(0).describe('Total number of entries matching the query'),
  offset: z.number().int().min(0).describe('Starting index of the current page'),
  limit: listResponseLimitSchema,
}).openapi('DeferredProcessingList');

/**
 * Route params for deferred processing endpoints
 */
export const deferredProcessingRouteParamsSchema = z.object({
  id: z.string().describe('Deferred processing entry ID'),
});

/**
 * Query params for listing deferred processing entries
 */
export const deferredProcessingListParamsSchema = z.object({
  offset: z.coerce.number().int().min(0).default(0).describe('Starting index for pagination (default: 0)'),
  limit: z.coerce.number().int().min(1).max(100).default(50).describe('Maximum number of items to return (default: 50, max: 100)'),
  status: deferredProcessingStatusSchema.optional().describe('Filter by status (pending, processed, failed, cancelled)'),
  conversationId: z.string().optional().describe('Filter by conversation ID'),
  channelType: z.string().optional().describe('Filter by channel type'),
}).openapi('DeferredProcessingListParams');

/**
 * Request body for rescheduling a deferred processing entry
 */
export const rescheduleDeferredProcessingBodySchema = z.object({
  processAt: z.coerce.date().describe('New scheduled processing time. Use a past date to trigger immediate processing.'),
}).openapi('RescheduleDeferredProcessing');

/**
 * Request body for cancelling a deferred processing entry
 */
export const cancelDeferredProcessingBodySchema = z.object({
  // Empty body — status is set to 'cancelled'
}).openapi('CancelDeferredProcessing');

/** Deferred processing entry response type */
export type DeferredProcessingResponse = z.infer<typeof deferredProcessingResponseSchema>;

/** Paginated deferred processing list response type */
export type DeferredProcessingListResponse = z.infer<typeof deferredProcessingListResponseSchema>;

/** Reschedule request body type */
export type RescheduleDeferredProcessingRequest = z.infer<typeof rescheduleDeferredProcessingBodySchema>;
