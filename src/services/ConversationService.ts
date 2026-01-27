import { injectable, inject } from 'tsyringe';
import { eq, and, like, SQL, desc } from 'drizzle-orm';
import { db } from '../db/index';
import { conversations, conversationEvents, ConversationEventType, ConversationEventData } from '../db/schema';
import type { ConversationResponse, ConversationListResponse, ConversationEventResponse, ConversationEventListResponse } from '../http/contracts/conversation';
import type { ListParams } from '../http/contracts/common';
import { conversationResponseSchema, conversationListResponseSchema, conversationEventResponseSchema, conversationEventListResponseSchema } from '../http/contracts/conversation';
import { AuditService } from './AuditService';
import { NotFoundError } from '../errors';
import { buildFilterCondition, buildOrderBy } from '../utils/queryBuilder';
import { logger } from '../utils/logger';
import { BaseService } from './BaseService';
import type { RequestContext } from './RequestContext';
import { PERMISSIONS } from '../permissions';
import { generateId, ID_PREFIXES } from '../utils/idGenerator';
import { ConversationState } from './live/ConversationRunner';

/**
 * Input for creating a conversation (internal use only)
 */
export type CreateConversationInput = {
  id?: string;
  projectId: string;
  userId: string;
  clientId: string;
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
  constructor(@inject(AuditService) private readonly auditService: AuditService) {
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
    logger.info({ conversationId, projectId: input.projectId, userId: input.userId, clientId: input.clientId, stageId: input.stageId, adminId: context?.adminId }, 'Creating conversation');

    try {
      const conversationData = {
        id: conversationId,
        projectId: input.projectId,
        userId: input.userId,
        clientId: input.clientId,
        stageId: input.stageId,
        stageVars: {},
        status: input.status ?? 'initialized',
        statusDetails: input.statusDetails ?? null,
        metadata: input.metadata ?? null,
      };

      const result = await db.insert(conversations).values(conversationData).returning();
      const createdConversation = result[0];

      if (context?.adminId) {
        await this.auditService.logCreate('conversation', createdConversation.id, { id: createdConversation.id, projectId: createdConversation.projectId, userId: createdConversation.userId, clientId: createdConversation.clientId, stageId: createdConversation.stageId, status: createdConversation.status }, context.adminId);
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
  async saveConversationState(conversationId: string,
    status: ConversationState,
    statusDetails?: string | null,
    stageVars?: Record<string, Record<string, any>>
   ) {
    logger.debug({ conversationId }, 'Saving conversation state');

    try {
      const updateData: Partial<{
        status: ConversationState;
        statusDetails: string | null;
        stageVars: Record<string, Record<string, any>>;
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

      await db.update(conversations)
        .set(updateData)
        .where(eq(conversations.id, conversationId));

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
   * @param metadata - Optional metadata for the event
   */
  async saveConversationEvent(conversationId: string, eventType: ConversationEventType, eventData: ConversationEventData, metadata?: Record<string, any>): Promise<void> {
    logger.debug({ conversationId, eventType }, 'Saving conversation event');

    try {
      const eventId = generateId(ID_PREFIXES.EVENT);
      const eventRecord = {
        id: eventId,
        conversationId,
        eventType,
        eventData,
        timestamp: new Date(),
        metadata: metadata ?? null,
      };

      await db.insert(conversationEvents).values(eventRecord);

      logger.debug({ conversationId, eventId, eventType }, 'Conversation event saved successfully');
    } catch (error) {
      logger.error({ error, conversationId, eventType }, 'Failed to save conversation event');
      throw error;
    }
  }

  /**
   * Retrieves a conversation by its unique identifier
   * @param id - The unique identifier of the conversation
   * @returns The conversation if found
   * @throws {NotFoundError} When conversation is not found
   */
  async getConversationById(id: string): Promise<ConversationResponse> {
    logger.debug({ conversationId: id }, 'Fetching conversation by ID');

    try {
      const conversation = await db.query.conversations.findFirst({ where: eq(conversations.id, id) });

      if (!conversation) {
        throw new NotFoundError(`Conversation with id ${id} not found`);
      }

      return conversationResponseSchema.parse(conversation);
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
  async listConversations(params?: ListParams): Promise<ConversationListResponse> {
    logger.debug({ params }, 'Listing conversations');

    try {
      const conditions: SQL[] = [];
      const offset = params?.offset ?? 0;
      const limit = params?.limit ?? null;

      // Column map for filter and order by operations
      const columnMap = {
        id: conversations.id,
        projectId: conversations.projectId,
        userId: conversations.userId,
        clientId: conversations.clientId,
        stageId: conversations.stageId,
        status: conversations.status,
        statusReason: conversations.statusDetails,
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

      // Apply text search (searches id, userId, clientId, stageId, and status)
      if (params?.textSearch) {
        const searchTerm = `%${params.textSearch}%`;
        conditions.push(like(conversations.id, searchTerm));
      }

      // Build order by clause
      const orderByClause = buildOrderBy(params?.orderBy, columnMap);

      // Get total count
      const totalResult = await db.query.conversations.findMany({
        where: conditions.length > 0 ? and(...conditions) : undefined,
      });
      const total = totalResult.length;

      // Get paginated results
      const conversationList = await db.query.conversations.findMany({
        where: conditions.length > 0 ? and(...conditions) : undefined,
        orderBy: orderByClause.length > 0 ? orderByClause : [desc(conversations.createdAt)],
        limit: limit ?? undefined,
        offset,
      });

      return conversationListResponseSchema.parse({
        items: conversationList,
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
   * Marks a conversation as failed with a reason
   * @param id - The unique identifier of the conversation
   * @param reason - Human-readable description of why the conversation failed
   */
  async failConversation(id: string, reason: string): Promise<void> {
    logger.info({ conversationId: id, reason }, `Marking conversation as failed: ${reason}`);

    try {
      const existingConversation = await db.query.conversations.findFirst({ where: eq(conversations.id, id) });

      if (!existingConversation) {
        throw new NotFoundError(`Conversation with id ${id} not found`);
      }

      await db.update(conversations)
        .set({ 
          status: 'failed',
          statusDetails: reason,
          updatedAt: new Date()
        })
        .where(eq(conversations.id, id));

      logger.info({ conversationId: id }, 'Conversation marked as failed successfully');
    } catch (error) {
      logger.error({ error, conversationId: id, reason }, 'Failed to mark conversation as failed');
      throw error;
    }
  }

  /**
   * Deletes a conversation and all its associated events (via cascade)
   * @param id - The unique identifier of the conversation to delete
   * @param context - Request context for auditing and authorization
   */
  async deleteConversation(id: string, context: RequestContext): Promise<void> {
    this.requirePermission(context, PERMISSIONS.CONVERSATION_DELETE);
    logger.info({ conversationId: id, adminId: context?.adminId }, 'Deleting conversation');

    try {
      const existingConversation = await db.query.conversations.findFirst({ where: eq(conversations.id, id) });

      if (!existingConversation) {
        throw new NotFoundError(`Conversation with id ${id} not found`);
      }

      const deleted = await db.delete(conversations).where(eq(conversations.id, id)).returning();

      if (deleted.length === 0) {
        throw new NotFoundError(`Conversation with id ${id} not found`);
      }

      await this.auditService.logDelete('conversation', id, { id: existingConversation.id, projectId: existingConversation.projectId, userId: existingConversation.userId, clientId: existingConversation.clientId, stageId: existingConversation.stageId, status: existingConversation.status }, context?.adminId);

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
  async getConversationEvents(conversationId: string, params?: ListParams): Promise<ConversationEventListResponse> {
    logger.debug({ conversationId, params }, 'Fetching conversation events');

    try {
      // Verify conversation exists
      const conversation = await db.query.conversations.findFirst({ where: eq(conversations.id, conversationId) });

      if (!conversation) {
        throw new NotFoundError(`Conversation with id ${conversationId} not found`);
      }

      const conditions: SQL[] = [eq(conversationEvents.conversationId, conversationId)];
      const offset = params?.offset ?? 0;
      const limit = params?.limit ?? null;

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

      // Get total count
      const totalResult = await db.query.conversationEvents.findMany({
        where: conditions.length > 0 ? and(...conditions) : undefined,
      });
      const total = totalResult.length;

      // Get paginated results
      const eventList = await db.query.conversationEvents.findMany({
        where: conditions.length > 0 ? and(...conditions) : undefined,
        orderBy: orderByClause.length > 0 ? orderByClause : [desc(conversationEvents.timestamp)],
        limit: limit ?? undefined,
        offset,
      });

      return conversationEventListResponseSchema.parse({
        items: eventList,
        total,
        offset,
        limit,
      });
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
  async getConversationEventById(conversationId: string, eventId: string): Promise<ConversationEventResponse> {
    logger.debug({ conversationId, eventId }, 'Fetching conversation event by ID');

    try {
      // Verify conversation exists
      const conversation = await db.query.conversations.findFirst({ where: eq(conversations.id, conversationId) });

      if (!conversation) {
        throw new NotFoundError(`Conversation with id ${conversationId} not found`);
      }

      const event = await db.query.conversationEvents.findFirst({
        where: and(eq(conversationEvents.id, eventId), eq(conversationEvents.conversationId, conversationId)),
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
   * @returns Array of audit log entries for the conversation
   */
  async getConversationAuditLogs(conversationId: string): Promise<any[]> {
    logger.debug({ conversationId }, 'Fetching audit logs for conversation');

    try {
      return await this.auditService.getEntityAuditLogs('conversation', conversationId);
    } catch (error) {
      logger.error({ error, conversationId }, 'Failed to fetch conversation audit logs');
      throw error;
    }
  }
}
