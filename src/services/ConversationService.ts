import { injectable, inject } from 'tsyringe';
import { eq, and, like, SQL, desc } from 'drizzle-orm';
import { db } from '../db/index';
import { conversations, conversationEvents } from '../db/schema';
import type { ConversationResponse, ConversationListResponse, ConversationEventResponse, ConversationEventListResponse } from '../http/contracts/conversation';
import type { ListParams } from '../http/contracts/common';
import { conversationResponseSchema, conversationListResponseSchema, conversationEventResponseSchema, conversationEventListResponseSchema } from '../http/contracts/conversation';
import { AuditService } from './AuditService';
import { NotFoundError } from '../errors';
import { buildFilterCondition, buildOrderBy } from '../utils/queryBuilder';
import { countRows, normalizeListLimit } from '../utils/pagination';
import { logger } from '../utils/logger';
import { BaseService } from './BaseService';
import type { RequestContext } from './RequestContext';
import { PERMISSIONS } from '../permissions';
import { generateId, ID_PREFIXES } from '../utils/idGenerator';
import { ConversationState, MessageEventData, MessageVisibility } from '../types/conversationEvents';
import { ConversationEventData, ConversationEventType } from '../types/conversationEvents';
import { meta } from 'zod/v4/core';

/**
 * Input for creating a conversation (internal use only)
 */
export type CreateConversationInput = {
  id?: string;
  projectId: string;
  userId: string;
  sessionId: string;
  stageId: string;
  stageVars?: Record<string, Record<string, any>>;
  status: ConversationState;
  statusDetails?: string | null;
  metadata?: Record<string, any> | null;
};

/**
 * Service for managing conversations with create, read and delete operations
 */
@injectable()
export class ConversationService extends BaseService {
  constructor(
    @inject(AuditService) private readonly auditService: AuditService
  ) {
    super();
  }

  /**
   * Creates a new conversation (internal use only, not exposed via REST API)
   * @param input - Conversation creation data
   * @param context - Optional request context for auditing
   * @returns The created conversation
   */
  async createConversation(input: CreateConversationInput, context?: RequestContext): Promise<ConversationResponse> {
    const conversationId = input.id ?? generateId(ID_PREFIXES.CONVERSATION);
    logger.info({ conversationId, projectId: input.projectId, userId: input.userId, sessionId: input.sessionId, stageId: input.stageId, operatorId: context?.operatorId }, 'Creating conversation');

    await this.requireProjectNotArchived(input.projectId);

    try {
      const conversationData = {
        id: conversationId,
        projectId: input.projectId,
        userId: input.userId,
        sessionId: input.sessionId,
        stageId: input.stageId,
        startingStageId: input.stageId,
        stageVars: {},
        status: input.status ?? 'initialized',
        statusDetails: input.statusDetails ?? null,
        metadata: input.metadata ?? null,
      };

      const result = await db.insert(conversations).values(conversationData).returning();
      const createdConversation = result[0];

      if (context?.operatorId) {
        await this.auditService.logCreate('conversation', createdConversation.id, createdConversation, context.operatorId);
      }

      logger.info({ conversationId: createdConversation.id }, 'Conversation created successfully');

      return conversationResponseSchema.parse(createdConversation);
    } catch (error) {
      logger.error({ error, conversationId, projectId: input.projectId, userId: input.userId }, 'Failed to create conversation');
      throw error;
    }
  }

  /**
   * Saves the current state of a conversation (internal use only)
   */
  async saveConversationState(projectId: string, conversationId: string,
    status: ConversationState,
    statusDetails?: string | null,
    stageVars?: Record<string, Record<string, any>>,
    endingStageId?: string
  ) {
    logger.debug({ conversationId }, 'Saving conversation state');

    await this.requireProjectNotArchived(projectId);

    try {
      const updateData: Partial<{
        status: ConversationState;
        statusDetails: string | null;
        stageVars: Record<string, Record<string, any>>;
        endingStageId: string;
        updatedAt: Date;
      }> = {
        status,
        updatedAt: new Date(),
      };

      if (statusDetails !== undefined) {
        updateData.statusDetails = statusDetails;
      }

      if (stageVars !== undefined) {
        updateData.stageVars = stageVars;
      }

      if (endingStageId !== undefined) {
        updateData.endingStageId = endingStageId;
      }

      await db.update(conversations)
        .set(updateData)
        .where(and(eq(conversations.projectId, projectId), eq(conversations.id, conversationId)));

      logger.debug({ conversationId }, 'Conversation state saved successfully');
    } catch (error) {
      logger.error({ error, conversationId }, 'Failed to save conversation state');
      throw error;
    }
  }

  /**
   * Saves a conversation event with current timestamp (internal use only)
   * @param conversationId - The unique identifier of the conversation
   * @param eventType - The type of event being recorded
   * @param eventData - The data associated with the event
   * @returns The generated event ID
   */
  async saveConversationEvent(projectId: string, conversationId: string, eventType: ConversationEventType, eventData: ConversationEventData): Promise<string> {
    logger.debug({ conversationId, eventType }, 'Saving conversation event');

    await this.requireProjectNotArchived(projectId);

    try {
      const eventId = generateId(ID_PREFIXES.EVENT);
      const eventRecord = {
        id: eventId,
        projectId,
        conversationId,
        eventType,
        eventData,
        timestamp: new Date(),
        metadata: null
      };

      // Validate before inserting
      conversationEventResponseSchema.parse(eventRecord);

      await db.insert(conversationEvents).values(eventRecord);
      await db.update(conversations).set({ lastActivityAt: eventRecord.timestamp }).where(and(eq(conversations.projectId, projectId), eq(conversations.id, conversationId)));

      logger.debug({ conversationId, eventId, eventType }, 'Conversation event saved successfully');
      return eventId;
    } catch (error) {
      logger.error({ error, conversationId, eventType }, 'Failed to save conversation event');
      throw error;
    }
  }

  /**
   * Merges additional metadata into an existing conversation event's eventData.metadata.
   * Used to add timing information that becomes available after the event was initially saved
   * (e.g. total turn duration which is only known once TTS synthesis completes).
   * @param projectId - The project the event belongs to
   * @param eventId - The unique identifier of the event to update
   * @param metadataUpdate - Key/value pairs to merge into the existing metadata
   */
  async updateConversationEventMetadata(projectId: string, eventId: string, metadataUpdate: Record<string, any>): Promise<ConversationEventResponse | null> {
    try {
      const existing = await db.query.conversationEvents.findFirst({ where: and(eq(conversationEvents.projectId, projectId), eq(conversationEvents.id, eventId)) });
      if (!existing) {
        logger.warn({ projectId, eventId }, 'Cannot update metadata: conversation event not found');
        return;
      }
      const existingData = existing.eventData as Record<string, any>;
      const updatedEventData = { ...existingData, metadata: { ...(existingData.metadata || {}), ...metadataUpdate } };
      const result = await db.update(conversationEvents).set({ eventData: updatedEventData as ConversationEventData }).where(and(eq(conversationEvents.projectId, projectId), eq(conversationEvents.id, eventId))).returning();
      logger.debug({ projectId, eventId }, 'Conversation event metadata updated successfully');
      return result.length > 0 ? result[0] : null;
    } catch (error) {
      logger.error({ error, projectId, eventId }, 'Failed to update conversation event metadata');
    }
  }

  /**
   * Updates the userInput field of an existing message event's eventData.
   * Used to fill in the user input for a message event that was initially saved with empty userInput when the user message is received,
   * and then updated once ASR processing completes and the final transcribed text is available.
   * @param projectId - The project the event belongs to
   * @param eventId - The unique identifier of the event to update
   * @param newUserInput - The transcribed user input text to set on the event
   * @param newMetadata - Additional metadata to merge into the event's existing metadata
   * @param newMessageVisibility - The visibility of the message
   */
  async updateMessageEvent(projectId: string, eventId: string, newUserInput: string, newMetadata: Record<string, any>, newMessageVisibility: MessageVisibility): Promise<ConversationEventResponse | null> {
    try {
      const existing = await db.query.conversationEvents.findFirst({ where: and(eq(conversationEvents.projectId, projectId), eq(conversationEvents.id, eventId)) });
      if (!existing) {
        logger.warn({ projectId, eventId }, 'Cannot update message event: conversation event not found');
        return;
      }
      if (existing.eventType !== 'message') {
        logger.warn({ projectId, eventId, eventType: existing.eventType }, 'Cannot update message event: event is not of type "message"');
        return;
      }

      const existingData = existing.eventData as MessageEventData;
      const updatedEventData = { ...existingData, userInput: newUserInput, visibility: newMessageVisibility, metadata: { ...(existingData.metadata || {}), ...newMetadata } } as ConversationEventData;
      const result = await db.update(conversationEvents).set({ eventData: updatedEventData }).where(and(eq(conversationEvents.projectId, projectId), eq(conversationEvents.id, eventId))).returning();
      logger.debug({ projectId, eventId }, 'Conversation event message updated successfully');
      return result.length > 0 ? conversationEventResponseSchema.parse(result[0]) : null;
    } catch (error) {
      logger.error({ error, projectId, eventId }, 'Failed to update conversation event message ID');
    }
  }

  /**
   * Retrieves a conversation by its unique identifier
   * @param id - The unique identifier of the conversation
   * @returns The conversation if found
   * @throws {NotFoundError} When conversation is not found
   */
  async getConversationById(projectId: string, id: string): Promise<ConversationResponse> {
    logger.debug({ conversationId: id }, 'Fetching conversation by ID');

    try {
      const conversation = await db.query.conversations.findFirst({ where: and(eq(conversations.projectId, projectId), eq(conversations.id, id)) });

      if (!conversation) {
        throw new NotFoundError(`Conversation with id ${id} not found`);
      }

      const archived = !(await this.isProjectActive(projectId));
      return conversationResponseSchema.parse({ ...conversation, archived });
    } catch (error) {
      logger.error({ error, conversationId: id }, 'Failed to fetch conversation');
      throw error;
    }
  }

  /**
   * Lists conversations with flexible filtering, sorting, and pagination
   * @param params - List parameters including filters, sorting, pagination, and text search
   * @returns Paginated array of conversations matching the criteria
   */
  async listConversations(projectId: string, params?: ListParams): Promise<ConversationListResponse> {
    logger.debug({ params }, 'Listing conversations');

    try {
      const conditions: SQL[] = [eq(conversations.projectId, projectId)];
      const offset = params?.offset ?? 0;
      const limit = normalizeListLimit(params?.limit);

      // Column map for filter and order by operations
      const columnMap = {
        id: conversations.id,
        projectId: conversations.projectId,
        userId: conversations.userId,
        sessionId: conversations.sessionId,
        stageId: conversations.stageId,
        startingStageId: conversations.startingStageId,
        endingStageId: conversations.endingStageId,
        status: conversations.status,
        statusDetails: conversations.statusDetails,
        createdAt: conversations.createdAt,
        updatedAt: conversations.updatedAt,
      };

      // Apply filters
      if (params?.filters) {
        for (const [field, filter] of Object.entries(params.filters)) {
          const condition = buildFilterCondition(field, filter, columnMap, logger);
          if (condition) {
            conditions.push(condition);
          }
        }
      }

      // Apply text search (searches id, userId, sessionId, stageId, and status)
      if (params?.textSearch) {
        const searchTerm = `%${params.textSearch}%`;
        conditions.push(like(conversations.id, searchTerm));
      }

      // Build order by clause
      const orderByClause = buildOrderBy(params?.orderBy, columnMap);
      const whereCondition = conditions.length > 0 ? and(...conditions) : undefined;

      const total = await countRows(conversations, whereCondition);

      // Get paginated results
      const conversationList = await db.query.conversations.findMany({
        where: whereCondition,
        orderBy: orderByClause.length > 0 ? orderByClause : [desc(conversations.createdAt)],
        limit,
        offset,
      });

      const archived = !(await this.isProjectActive(projectId));
      return conversationListResponseSchema.parse({
        items: conversationList.map(c => ({ ...c, archived })),
        total,
        offset,
        limit,
      });
    } catch (error) {
      logger.error({ error, params }, 'Failed to list conversations');
      throw error;
    }
  }

  /**
   * Marks a conversation as ended/completed
   * @param id - The unique identifier of the conversation
   * @param reason - Optional reason for finishing the conversation
   */
  async finishConversation(projectId: string, id: string, reason: string = ''): Promise<void> {
    logger.info({ conversationId: id }, 'Ending conversation');

    await this.requireProjectNotArchived(projectId);

    try {
      const existingConversation = await db.query.conversations.findFirst({ where: and(eq(conversations.projectId, projectId), eq(conversations.id, id)) });

      if (!existingConversation) {
        throw new NotFoundError(`Conversation with id ${id} not found`);
      }

      if (existingConversation.status === 'finished' || existingConversation.status === 'failed' || existingConversation.status === 'aborted') {
        logger.info({ conversationId: id }, 'Conversation is already ended, skipping');
        return;
      }

      const finishedAt = new Date();
      await db.update(conversations)
        .set({
          status: 'finished',
          endingStageId: existingConversation.stageId,
          updatedAt: finishedAt,
        })
        .where(and(eq(conversations.projectId, projectId), eq(conversations.id, id)));

      logger.info({ conversationId: id }, 'Conversation ended successfully');
    } catch (error) {
      logger.error({ error, conversationId: id }, 'Failed to end conversation');
      throw error;
    }
  }

  /**
   * Marks a conversation as failed with a reason
   * @param id - The unique identifier of the conversation
   * @param reason - Human-readable description of why the conversation failed
   */
  async failConversation(projectId: string, id: string, reason: string): Promise<void> {
    logger.info({ conversationId: id, reason }, `Marking conversation as failed: ${reason}`);

    await this.requireProjectNotArchived(projectId);

    try {
      const existingConversation = await db.query.conversations.findFirst({ where: and(eq(conversations.projectId, projectId), eq(conversations.id, id)) });

      if (!existingConversation) {
        throw new NotFoundError(`Conversation with id ${id} not found`);
      }

      const failedAt = new Date();
      await db.update(conversations)
        .set({
          status: 'failed',
          statusDetails: reason,
          endingStageId: existingConversation.stageId,
          updatedAt: failedAt,
        })
        .where(and(eq(conversations.projectId, projectId), eq(conversations.id, id)));

      logger.info({ conversationId: id }, 'Conversation marked as failed successfully');
    } catch (error) {
      logger.error({ error, conversationId: id, reason }, 'Failed to mark conversation as failed');
      throw error;
    }
  }

  /**
   * Marks a conversation as aborted with a reason (used by internal jobs, no permission check)
   * @param projectId - The project the conversation belongs to
   * @param id - The unique identifier of the conversation
   * @param reason - Human-readable description of why the conversation was aborted
   */
  async abortConversation(projectId: string, id: string, reason: string): Promise<void> {
    logger.info({ conversationId: id, reason }, `Aborting conversation: ${reason}`);

    try {
      const existingConversation = await db.query.conversations.findFirst({ where: and(eq(conversations.projectId, projectId), eq(conversations.id, id)) });

      if (!existingConversation) {
        throw new NotFoundError(`Conversation with id ${id} not found`);
      }

      if (existingConversation.status === 'finished' || existingConversation.status === 'failed' || existingConversation.status === 'aborted') {
        logger.info({ conversationId: id }, 'Conversation is already ended, skipping abort');
        return;
      }

      const abortedAt = new Date();
      await db.update(conversations)
        .set({
          status: 'aborted',
          statusDetails: reason,
          endingStageId: existingConversation.stageId,
          updatedAt: abortedAt,
        })
        .where(and(eq(conversations.projectId, projectId), eq(conversations.id, id)));

      logger.info({ conversationId: id }, 'Conversation aborted successfully');
    } catch (error) {
      logger.error({ error, conversationId: id, reason }, 'Failed to abort conversation');
      throw error;
    }
  }

  /**
   * Deletes a conversation and all its associated events (via cascade)
   * @param id - The unique identifier of the conversation to delete
   * @param context - Request context for auditing and authorization
   */
  async deleteConversation(projectId: string, id: string, context: RequestContext): Promise<void> {
    this.requirePermission(context, PERMISSIONS.CONVERSATION_DELETE);
    logger.info({ conversationId: id, operatorId: context?.operatorId }, 'Deleting conversation');

    await this.requireProjectNotArchived(projectId);

    try {
      const existingConversation = await db.query.conversations.findFirst({ where: and(eq(conversations.projectId, projectId), eq(conversations.id, id)) });

      if (!existingConversation) {
        throw new NotFoundError(`Conversation with id ${id} not found`);
      }

      const deleted = await db.delete(conversations).where(and(eq(conversations.projectId, projectId), eq(conversations.id, id))).returning();

      if (deleted.length === 0) {
        throw new NotFoundError(`Conversation with id ${id} not found`);
      }

      await this.auditService.logDelete('conversation', id, existingConversation, context?.operatorId);

      logger.info({ conversationId: id }, 'Conversation deleted successfully');
    } catch (error) {
      logger.error({ error, conversationId: id }, 'Failed to delete conversation');
      throw error;
    }
  }

  /**
   * Retrieves all events for a specific conversation
   * @param conversationId - The unique identifier of the conversation
   * @param params - List parameters including filters, sorting, and pagination
   * @returns Paginated array of conversation events
   * @throws {NotFoundError} When conversation is not found
   */
  async getConversationEvents(projectId: string, conversationId: string, params?: ListParams): Promise<ConversationEventListResponse> {
    logger.debug({ conversationId, params }, 'Fetching conversation events');

    try {
      // Verify conversation exists
      const conversation = await db.query.conversations.findFirst({ where: and(eq(conversations.projectId, projectId), eq(conversations.id, conversationId)) });

      if (!conversation) {
        throw new NotFoundError(`Conversation with id ${conversationId} not found`);
      }

      const conditions: SQL[] = [eq(conversationEvents.projectId, projectId), eq(conversationEvents.conversationId, conversationId)];
      const offset = params?.offset ?? 0;
      const limit = normalizeListLimit(params?.limit);

      // Column map for filter and order by operations
      const columnMap = {
        id: conversationEvents.id,
        conversationId: conversationEvents.conversationId,
        eventType: conversationEvents.eventType,
        timestamp: conversationEvents.timestamp,
      };

      // Apply filters
      if (params?.filters) {
        for (const [field, filter] of Object.entries(params.filters)) {
          const condition = buildFilterCondition(field, filter, columnMap, logger);
          if (condition) {
            conditions.push(condition);
          }
        }
      }

      // Apply text search (searches eventType)
      if (params?.textSearch) {
        const searchTerm = `%${params.textSearch}%`;
        conditions.push(like(conversationEvents.eventType, searchTerm));
      }

      // Build order by clause
      const orderByClause = buildOrderBy(params?.orderBy, columnMap);
      const whereCondition = conditions.length > 0 ? and(...conditions) : undefined;

      const total = await countRows(conversationEvents, whereCondition);

      // Get paginated results
      const eventList = await db.query.conversationEvents.findMany({
        where: whereCondition,
        orderBy: orderByClause.length > 0 ? orderByClause : [desc(conversationEvents.timestamp)],
        limit,
        offset,
      });

      return {
        items: eventList,
        total,
        offset,
        limit,
      };
    } catch (error) {
      logger.error({ error, conversationId, params }, 'Failed to fetch conversation events');
      throw error;
    }
  }

  /**
   * Retrieves a specific event by ID
   * @param conversationId - The unique identifier of the conversation
   * @param eventId - The unique identifier of the event
   * @returns The conversation event if found
   * @throws {NotFoundError} When conversation or event is not found
   */
  async getConversationEventById(projectId: string, conversationId: string, eventId: string): Promise<ConversationEventResponse> {
    logger.debug({ conversationId, eventId }, 'Fetching conversation event by ID');

    try {
      // Verify conversation exists
      const conversation = await db.query.conversations.findFirst({ where: and(eq(conversations.projectId, projectId), eq(conversations.id, conversationId)) });

      if (!conversation) {
        throw new NotFoundError(`Conversation with id ${conversationId} not found`);
      }

      const event = await db.query.conversationEvents.findFirst({
        where: and(eq(conversationEvents.projectId, projectId), eq(conversationEvents.id, eventId), eq(conversationEvents.conversationId, conversationId)),
      });

      if (!event) {
        throw new NotFoundError(`Event with id ${eventId} not found for conversation ${conversationId}`);
      }

      return conversationEventResponseSchema.parse(event);
    } catch (error) {
      logger.error({ error, conversationId, eventId }, 'Failed to fetch conversation event');
      throw error;
    }
  }

  /**
   * Retrieves all audit log entries for a specific conversation
   * @param conversationId - The unique identifier of the conversation
   * @param projectId - The project ID the conversation belongs to
   * @returns Array of audit log entries for the conversation
   */
  async getConversationAuditLogs(conversationId: string, projectId: string): Promise<any[]> {
    logger.debug({ conversationId, projectId }, 'Fetching audit logs for conversation');

    try {
      return await this.auditService.getEntityAuditLogs('conversation', conversationId, projectId);
    } catch (error) {
      logger.error({ error, conversationId, projectId }, 'Failed to fetch conversation audit logs');
      throw error;
    }
  }
}
