import { injectable, inject } from 'tsyringe';
import { eq, and, like, SQL, desc, inArray } from 'drizzle-orm';
import { db } from '../db/index';
import { conversationStages, personas, classifiers, contextTransformers, knowledgeSections, globalActions } from '../db/schema';
import type { CreateConversationStageRequest, UpdateConversationStageRequest, ConversationStageResponse, ConversationStageListResponse } from '../api/conversationStage';
import type { ListParams } from '../api/common';
import { conversationStageResponseSchema, conversationStageListResponseSchema } from '../api/conversationStage';
import { AuditService } from './AuditService';
import { OptimisticLockError, NotFoundError } from '../errors';
import { buildFilterCondition, buildOrderBy } from '../utils/queryBuilder';
import { logger } from '../utils/logger';
import { BaseService } from './BaseService';
import type { RequestContext } from '../types/request-context';
import { PERMISSIONS } from '../config/permissions';

/**
 * Service for managing conversation stages with full CRUD operations and audit logging
 * Conversation stages define the behavior, prompts, and available actions for different phases of a conversation
 */
@injectable()
export class ConversationStageService extends BaseService {
  constructor(@inject(AuditService) private readonly auditService: AuditService) {
    super();
  }

  /**
   * Validates that all referenced entities exist
   * @param personaId - Persona ID to validate
   * @param classifierIds - Classifier IDs to validate
   * @param transformerIds - Transformer IDs to validate
   * @param knowledgeSectionIds - Knowledge section IDs to validate
   * @param globalActionIds - Global action IDs to validate
   * @throws {NotFoundError} When any referenced entity does not exist
   */
  private async validateReferencedEntities(personaId: string, classifierIds?: string[], transformerIds?: string[], knowledgeSectionIds?: string[], globalActionIds?: string[]): Promise<void> {
    const errors: string[] = [];

    // Validate persona exists
    const persona = await db.query.personas.findFirst({ where: eq(personas.id, personaId) });
    if (!persona) {
      errors.push(`Persona with id ${personaId} not found`);
    }

    // Validate classifiers exist
    if (classifierIds && classifierIds.length > 0) {
      const existingClassifiers = await db.query.classifiers.findMany({ where: inArray(classifiers.id, classifierIds) });
      const existingIds = new Set(existingClassifiers.map(c => c.id));
      const missingIds = classifierIds.filter(id => !existingIds.has(id));
      if (missingIds.length > 0) {
        errors.push(`Classifiers not found: ${missingIds.join(', ')}`);
      }
    }

    // Validate transformers exist
    if (transformerIds && transformerIds.length > 0) {
      const existingTransformers = await db.query.contextTransformers.findMany({ where: inArray(contextTransformers.id, transformerIds) });
      const existingIds = new Set(existingTransformers.map(t => t.id));
      const missingIds = transformerIds.filter(id => !existingIds.has(id));
      if (missingIds.length > 0) {
        errors.push(`Context transformers not found: ${missingIds.join(', ')}`);
      }
    }

    // Validate knowledge sections exist
    if (knowledgeSectionIds && knowledgeSectionIds.length > 0) {
      const existingSections = await db.query.knowledgeSections.findMany({ where: inArray(knowledgeSections.id, knowledgeSectionIds) });
      const existingIds = new Set(existingSections.map(s => s.id));
      const missingIds = knowledgeSectionIds.filter(id => !existingIds.has(id));
      if (missingIds.length > 0) {
        errors.push(`Knowledge sections not found: ${missingIds.join(', ')}`);
      }
    }

    // Validate global actions exist
    if (globalActionIds && globalActionIds.length > 0) {
      const existingActions = await db.query.globalActions.findMany({ where: inArray(globalActions.id, globalActionIds) });
      const existingIds = new Set(existingActions.map(a => a.id));
      const missingIds = globalActionIds.filter(id => !existingIds.has(id));
      if (missingIds.length > 0) {
        errors.push(`Global actions not found: ${missingIds.join(', ')}`);
      }
    }

    if (errors.length > 0) {
      throw new NotFoundError(`Referenced entities validation failed: ${errors.join('; ')}`);
    }
  }

  /**
   * Creates a new conversation stage and logs the creation in the audit trail
   * @param input - Conversation stage creation data including stageId, prompt, personaId, and configuration
   * @param context - Request context for auditing and authorization
   * @returns The created conversation stage
   */
  async createConversationStage(input: CreateConversationStageRequest, context: RequestContext): Promise<ConversationStageResponse> {
    this.requirePermission(context, PERMISSIONS.CONVERSATION_STAGE_WRITE);
    logger.info({ stageId: input.stageId, personaId: input.personaId, adminId: context?.adminId }, 'Creating conversation stage');

    try {
      // Validate referenced entities exist
      await this.validateReferencedEntities(input.personaId, input.classifierIds, input.transformerIds, input.knowledgeSections, input.globalActions);

      const stage = await db.insert(conversationStages).values({ stageId: input.stageId, prompt: input.prompt, llmProvider: input.llmProvider ?? null, llmProviderConfig: input.llmProviderConfig ?? null, personaId: input.personaId, enterBehavior: input.enterBehavior ?? {}, useKnowledge: input.useKnowledge ?? false, knowledgeSections: input.knowledgeSections ?? [], useGlobalActions: input.useGlobalActions ?? true, globalActions: input.globalActions ?? [], variables: input.variables ?? {}, actions: input.actions ?? {}, classifierIds: input.classifierIds ?? [], transformerIds: input.transformerIds ?? [], metadata: input.metadata ?? null, version: 1 }).returning();

      const createdStage = stage[0];

      await this.auditService.logCreate('conversation_stage', createdStage.stageId, { stageId: createdStage.stageId, prompt: createdStage.prompt, llmProvider: createdStage.llmProvider, llmProviderConfig: createdStage.llmProviderConfig, personaId: createdStage.personaId, enterBehavior: createdStage.enterBehavior, useKnowledge: createdStage.useKnowledge, knowledgeSections: createdStage.knowledgeSections, useGlobalActions: createdStage.useGlobalActions, globalActions: createdStage.globalActions, variables: createdStage.variables, actions: createdStage.actions, classifierIds: createdStage.classifierIds, transformerIds: createdStage.transformerIds, metadata: createdStage.metadata }, context?.adminId);

      logger.info({ stageId: createdStage.stageId }, 'Conversation stage created successfully');

      return conversationStageResponseSchema.parse(createdStage);
    } catch (error) {
      logger.error({ error, stageId: input.stageId }, 'Failed to create conversation stage');
      throw error;
    }
  }

  /**
   * Retrieves a conversation stage by its unique identifier
   * @param stageId - The unique identifier of the conversation stage
   * @returns The conversation stage if found
   * @throws {NotFoundError} When conversation stage is not found
   */
  async getConversationStageById(stageId: string): Promise<ConversationStageResponse> {
    logger.debug({ stageId }, 'Fetching conversation stage by ID');

    try {
      const stage = await db.query.conversationStages.findFirst({ where: eq(conversationStages.stageId, stageId) });

      if (!stage) {
        throw new NotFoundError(`Conversation stage with id ${stageId} not found`);
      }

      return conversationStageResponseSchema.parse(stage);
    } catch (error) {
      logger.error({ error, stageId }, 'Failed to fetch conversation stage');
      throw error;
    }
  }

  /**
   * Lists conversation stages with flexible filtering, sorting, and pagination
   * @param params - List parameters including filters, sorting, pagination, and text search
   * @returns Paginated array of conversation stages matching the criteria
   */
  async listConversationStages(params?: ListParams): Promise<ConversationStageListResponse> {
    logger.debug({ params }, 'Listing conversation stages');

    try {
      const conditions: SQL[] = [];
      const offset = params?.offset ?? 0;
      const limit = params?.limit ?? null;

      // Column map for filter and order by operations
      const columnMap = {
        stageId: conversationStages.stageId,
        personaId: conversationStages.personaId,
        useKnowledge: conversationStages.useKnowledge,
        useGlobalActions: conversationStages.useGlobalActions,
        version: conversationStages.version,
        createdAt: conversationStages.createdAt,
        updatedAt: conversationStages.updatedAt,
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

      // Apply text search (searches stageId and personaId)
      if (params?.textSearch) {
        const searchTerm = `%${params.textSearch}%`;
        conditions.push(like(conversationStages.stageId, searchTerm));
      }

      // Build order by clause
      const orderByClause = buildOrderBy(params?.orderBy, columnMap);

      // Get total count
      const totalResult = await db.query.conversationStages.findMany({
        where: conditions.length > 0 ? and(...conditions) : undefined,
      });
      const total = totalResult.length;

      // Get paginated results
      const stageList = await db.query.conversationStages.findMany({
        where: conditions.length > 0 ? and(...conditions) : undefined,
        orderBy: orderByClause.length > 0 ? orderByClause : [desc(conversationStages.createdAt)],
        limit: limit ?? undefined,
        offset,
      });

      return conversationStageListResponseSchema.parse({
        items: stageList,
        total,
        offset,
        limit,
      });
    } catch (error) {
      logger.error({ error, params }, 'Failed to list conversation stages');
      throw error;
    }
  }

  /**
   * Updates a conversation stage using optimistic locking to prevent concurrent modifications
   * @param stageId - The unique identifier of the conversation stage to update
   * @param input - Conversation stage update data (without version)
   * @param expectedVersion - The expected version number for optimistic locking
   * @param context - Request context for auditing and authorization
   * @returns The updated conversation stage
   * @throws {NotFoundError} When conversation stage is not found
   * @throws {OptimisticLockError} When the version doesn't match (concurrent modification detected)
   */
  async updateConversationStage(stageId: string, input: Omit<UpdateConversationStageRequest, 'version'>, expectedVersion: number, context: RequestContext): Promise<ConversationStageResponse> {
    this.requirePermission(context, PERMISSIONS.CONVERSATION_STAGE_WRITE);
    logger.info({ stageId, expectedVersion, adminId: context?.adminId }, 'Updating conversation stage');

    try {
      const existingStage = await db.query.conversationStages.findFirst({ where: eq(conversationStages.stageId, stageId) });

      if (!existingStage) {
        throw new NotFoundError(`Conversation stage with id ${stageId} not found`);
      }

      if (existingStage.version !== expectedVersion) {
        throw new OptimisticLockError(`Conversation stage version mismatch. Expected ${expectedVersion}, got ${existingStage.version}`);
      }

      // Validate referenced entities if they are being updated
      const personaIdToValidate = input.personaId ?? existingStage.personaId;
      const classifierIdsToValidate = input.classifierIds !== undefined ? input.classifierIds : existingStage.classifierIds;
      const transformerIdsToValidate = input.transformerIds !== undefined ? input.transformerIds : existingStage.transformerIds;
      const knowledgeSectionsToValidate = input.knowledgeSections !== undefined ? input.knowledgeSections : existingStage.knowledgeSections;
      const globalActionsToValidate = input.globalActions !== undefined ? input.globalActions : existingStage.globalActions;

      await this.validateReferencedEntities(personaIdToValidate, classifierIdsToValidate, transformerIdsToValidate, knowledgeSectionsToValidate, globalActionsToValidate);

      const updateData: any = { version: existingStage.version + 1, updatedAt: new Date() };
      if (input.prompt !== undefined) updateData.prompt = input.prompt;
      if (input.llmProvider !== undefined) updateData.llmProvider = input.llmProvider;
      if (input.llmProviderConfig !== undefined) updateData.llmProviderConfig = input.llmProviderConfig;
      if (input.personaId !== undefined) updateData.personaId = input.personaId;
      if (input.enterBehavior !== undefined) updateData.enterBehavior = input.enterBehavior;
      if (input.useKnowledge !== undefined) updateData.useKnowledge = input.useKnowledge;
      if (input.knowledgeSections !== undefined) updateData.knowledgeSections = input.knowledgeSections;
      if (input.useGlobalActions !== undefined) updateData.useGlobalActions = input.useGlobalActions;
      if (input.globalActions !== undefined) updateData.globalActions = input.globalActions;
      if (input.variables !== undefined) updateData.variables = input.variables;
      if (input.actions !== undefined) updateData.actions = input.actions;
      if (input.classifierIds !== undefined) updateData.classifierIds = input.classifierIds;
      if (input.transformerIds !== undefined) updateData.transformerIds = input.transformerIds;
      if (input.metadata !== undefined) updateData.metadata = input.metadata;

      const updatedStage = await db.update(conversationStages).set(updateData).where(and(eq(conversationStages.stageId, stageId), eq(conversationStages.version, expectedVersion))).returning();

      if (updatedStage.length === 0) {
        throw new OptimisticLockError(`Failed to update conversation stage due to version conflict`);
      }

      const stage = updatedStage[0];

      await this.auditService.logUpdate('conversation_stage', stage.stageId, { stageId: existingStage.stageId, prompt: existingStage.prompt, llmProvider: existingStage.llmProvider, llmProviderConfig: existingStage.llmProviderConfig, personaId: existingStage.personaId, enterBehavior: existingStage.enterBehavior, useKnowledge: existingStage.useKnowledge, knowledgeSections: existingStage.knowledgeSections, useGlobalActions: existingStage.useGlobalActions, globalActions: existingStage.globalActions, variables: existingStage.variables, actions: existingStage.actions, classifierIds: existingStage.classifierIds, transformerIds: existingStage.transformerIds, metadata: existingStage.metadata }, { stageId: stage.stageId, prompt: stage.prompt, llmProvider: stage.llmProvider, llmProviderConfig: stage.llmProviderConfig, personaId: stage.personaId, enterBehavior: stage.enterBehavior, useKnowledge: stage.useKnowledge, knowledgeSections: stage.knowledgeSections, useGlobalActions: stage.useGlobalActions, globalActions: stage.globalActions, variables: stage.variables, actions: stage.actions, classifierIds: stage.classifierIds, transformerIds: stage.transformerIds, metadata: stage.metadata }, context?.adminId);

      logger.info({ stageId: stage.stageId, newVersion: stage.version }, 'Conversation stage updated successfully');

      return conversationStageResponseSchema.parse(stage);
    } catch (error) {
      logger.error({ error, stageId }, 'Failed to update conversation stage');
      throw error;
    }
  }

  /**
   * Deletes a conversation stage using optimistic locking to prevent concurrent modifications
   * @param stageId - The unique identifier of the conversation stage to delete
   * @param expectedVersion - The expected version number for optimistic locking
   * @param context - Request context for auditing and authorization
   * @throws {NotFoundError} When conversation stage is not found
   * @throws {OptimisticLockError} When the version doesn't match (concurrent modification detected)
   */
  async deleteConversationStage(stageId: string, expectedVersion: number, context: RequestContext): Promise<void> {
    this.requirePermission(context, PERMISSIONS.CONVERSATION_STAGE_DELETE);
    logger.info({ stageId, expectedVersion, adminId: context?.adminId }, 'Deleting conversation stage');

    try {
      const existingStage = await db.query.conversationStages.findFirst({ where: eq(conversationStages.stageId, stageId) });

      if (!existingStage) {
        throw new NotFoundError(`Conversation stage with id ${stageId} not found`);
      }

      if (existingStage.version !== expectedVersion) {
        throw new OptimisticLockError(`Conversation stage version mismatch. Expected ${expectedVersion}, got ${existingStage.version}`);
      }

      const deleted = await db.delete(conversationStages).where(and(eq(conversationStages.stageId, stageId), eq(conversationStages.version, expectedVersion))).returning();

      if (deleted.length === 0) {
        throw new OptimisticLockError(`Failed to delete conversation stage due to version conflict`);
      }

      await this.auditService.logDelete('conversation_stage', stageId, { stageId: existingStage.stageId, prompt: existingStage.prompt, llmProvider: existingStage.llmProvider, llmProviderConfig: existingStage.llmProviderConfig, personaId: existingStage.personaId, enterBehavior: existingStage.enterBehavior, useKnowledge: existingStage.useKnowledge, knowledgeSections: existingStage.knowledgeSections, useGlobalActions: existingStage.useGlobalActions, globalActions: existingStage.globalActions, variables: existingStage.variables, actions: existingStage.actions, classifierIds: existingStage.classifierIds, transformerIds: existingStage.transformerIds, metadata: existingStage.metadata }, context?.adminId);

      logger.info({ stageId }, 'Conversation stage deleted successfully');
    } catch (error) {
      logger.error({ error, stageId }, 'Failed to delete conversation stage');
      throw error;
    }
  }

  /**
   * Retrieves all audit log entries for a specific conversation stage
   * @param stageId - The unique identifier of the conversation stage
   * @returns Array of audit log entries for the conversation stage
   */
  async getConversationStageAuditLogs(stageId: string): Promise<any[]> {
    logger.debug({ stageId }, 'Fetching audit logs for conversation stage');

    try {
      return await this.auditService.getEntityAuditLogs('conversation_stage', stageId);
    } catch (error) {
      logger.error({ error, stageId }, 'Failed to fetch conversation stage audit logs');
      throw error;
    }
  }
}
