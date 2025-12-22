import { injectable, inject } from 'tsyringe';
import { eq, and, like, SQL, desc, inArray } from 'drizzle-orm';
import { db } from '../db/index';
import { stages, personas, classifiers, contextTransformers, knowledgeSections, globalActions } from '../db/schema';
import type { CreateStageRequest, UpdateStageRequest, StageResponse, StageListResponse } from '../api/stage';
import type { ListParams } from '../api/common';
import { stageResponseSchema, stageListResponseSchema } from '../api/stage';
import { AuditService } from './AuditService';
import { OptimisticLockError, NotFoundError } from '../errors';
import { buildFilterCondition, buildOrderBy } from '../utils/queryBuilder';
import { logger } from '../utils/logger';
import { BaseService } from './BaseService';
import type { RequestContext } from '../types/request-context';
import { PERMISSIONS } from '../permissions';

/**
 * Service for managing stages with full CRUD operations and audit logging
 * Stages define the behavior, prompts, and available actions for different phases of a conversation
 */
@injectable()
export class StageService extends BaseService {
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
   * Creates a new stage and logs the creation in the audit trail
   * @param input - Stage creation data including stageId, prompt, personaId, and configuration
   * @param context - Request context for auditing and authorization
   * @returns The created stage
   */
  async createStage(input: CreateStageRequest, context: RequestContext): Promise<StageResponse> {
    this.requirePermission(context, PERMISSIONS.STAGE_WRITE);
    logger.info({ stageId: input.stageId, personaId: input.personaId, adminId: context?.adminId }, 'Creating stage');

    try {
      // Validate referenced entities exist
      await this.validateReferencedEntities(input.personaId, input.classifierIds, input.transformerIds, input.knowledgeSections, input.globalActions);

      const stage = await db.insert(stages).values({ stageId: input.stageId, prompt: input.prompt, llmProvider: input.llmProvider ?? null, llmProviderConfig: input.llmProviderConfig ?? null, personaId: input.personaId, enterBehavior: input.enterBehavior ?? {}, useKnowledge: input.useKnowledge ?? false, knowledgeSections: input.knowledgeSections ?? [], useGlobalActions: input.useGlobalActions ?? true, globalActions: input.globalActions ?? [], variables: input.variables ?? {}, actions: input.actions ?? {}, classifierIds: input.classifierIds ?? [], transformerIds: input.transformerIds ?? [], metadata: input.metadata ?? null, version: 1 }).returning();

      const createdStage = stage[0];

      await this.auditService.logCreate('stage', createdStage.stageId, { stageId: createdStage.stageId, prompt: createdStage.prompt, llmProvider: createdStage.llmProvider, llmProviderConfig: createdStage.llmProviderConfig, personaId: createdStage.personaId, enterBehavior: createdStage.enterBehavior, useKnowledge: createdStage.useKnowledge, knowledgeSections: createdStage.knowledgeSections, useGlobalActions: createdStage.useGlobalActions, globalActions: createdStage.globalActions, variables: createdStage.variables, actions: createdStage.actions, classifierIds: createdStage.classifierIds, transformerIds: createdStage.transformerIds, metadata: createdStage.metadata }, context?.adminId);

      logger.info({ stageId: createdStage.stageId }, 'Stage created successfully');

      return stageResponseSchema.parse(createdStage);
    } catch (error) {
      logger.error({ error, stageId: input.stageId }, 'Failed to create stage');
      throw error;
    }
  }

  /**
   * Retrieves a stage by its unique identifier
   * @param stageId - The unique identifier of the stage
   * @returns The stage if found
   * @throws {NotFoundError} When stage is not found
   */
  async getStageById(stageId: string): Promise<StageResponse> {
    logger.debug({ stageId }, 'Fetching stage by ID');

    try {
      const stage = await db.query.stages.findFirst({ where: eq(stages.stageId, stageId) });

      if (!stage) {
        throw new NotFoundError(`Stage with id ${stageId} not found`);
      }

      return stageResponseSchema.parse(stage);
    } catch (error) {
      logger.error({ error, stageId }, 'Failed to fetch stage');
      throw error;
    }
  }

  /**
   * Lists stages with flexible filtering, sorting, and pagination
   * @param params - List parameters including filters, sorting, pagination, and text search
   * @returns Paginated array of stages matching the criteria
   */
  async listStages(params?: ListParams): Promise<StageListResponse> {
    logger.debug({ params }, 'Listing stages');

    try {
      const conditions: SQL[] = [];
      const offset = params?.offset ?? 0;
      const limit = params?.limit ?? null;

      // Column map for filter and order by operations
      const columnMap = {
        stageId: stages.stageId,
        personaId: stages.personaId,
        useKnowledge: stages.useKnowledge,
        useGlobalActions: stages.useGlobalActions,
        version: stages.version,
        createdAt: stages.createdAt,
        updatedAt: stages.updatedAt,
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
        conditions.push(like(stages.stageId, searchTerm));
      }

      // Build order by clause
      const orderByClause = buildOrderBy(params?.orderBy, columnMap);

      // Get total count
      const totalResult = await db.query.stages.findMany({
        where: conditions.length > 0 ? and(...conditions) : undefined,
      });
      const total = totalResult.length;

      // Get paginated results
      const stageList = await db.query.stages.findMany({
        where: conditions.length > 0 ? and(...conditions) : undefined,
        orderBy: orderByClause.length > 0 ? orderByClause : [desc(stages.createdAt)],
        limit: limit ?? undefined,
        offset,
      });

      return stageListResponseSchema.parse({
        items: stageList,
        total,
        offset,
        limit,
      });
    } catch (error) {
      logger.error({ error, params }, 'Failed to list stages');
      throw error;
    }
  }

  /**
   * Updates a stage using optimistic locking to prevent concurrent modifications
   * @param stageId - The unique identifier of the stage to update
   * @param input - Stage update data (without version)
   * @param expectedVersion - The expected version number for optimistic locking
   * @param context - Request context for auditing and authorization
   * @returns The updated stage
   * @throws {NotFoundError} When stage is not found
   * @throws {OptimisticLockError} When the version doesn't match (concurrent modification detected)
   */
  async updateStage(stageId: string, input: Omit<UpdateStageRequest, 'version'>, expectedVersion: number, context: RequestContext): Promise<StageResponse> {
    this.requirePermission(context, PERMISSIONS.STAGE_WRITE);
    logger.info({ stageId, expectedVersion, adminId: context?.adminId }, 'Updating stage');

    try {
      const existingStage = await db.query.stages.findFirst({ where: eq(stages.stageId, stageId) });

      if (!existingStage) {
        throw new NotFoundError(`Stage with id ${stageId} not found`);
      }

      if (existingStage.version !== expectedVersion) {
        throw new OptimisticLockError(`Stage version mismatch. Expected ${expectedVersion}, got ${existingStage.version}`);
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

      const updatedStage = await db.update(stages).set(updateData).where(and(eq(stages.stageId, stageId), eq(stages.version, expectedVersion))).returning();

      if (updatedStage.length === 0) {
        throw new OptimisticLockError(`Failed to update stage due to version conflict`);
      }

      const stage = updatedStage[0];

      await this.auditService.logUpdate('stage', stage.stageId, { stageId: existingStage.stageId, prompt: existingStage.prompt, llmProvider: existingStage.llmProvider, llmProviderConfig: existingStage.llmProviderConfig, personaId: existingStage.personaId, enterBehavior: existingStage.enterBehavior, useKnowledge: existingStage.useKnowledge, knowledgeSections: existingStage.knowledgeSections, useGlobalActions: existingStage.useGlobalActions, globalActions: existingStage.globalActions, variables: existingStage.variables, actions: existingStage.actions, classifierIds: existingStage.classifierIds, transformerIds: existingStage.transformerIds, metadata: existingStage.metadata }, { stageId: stage.stageId, prompt: stage.prompt, llmProvider: stage.llmProvider, llmProviderConfig: stage.llmProviderConfig, personaId: stage.personaId, enterBehavior: stage.enterBehavior, useKnowledge: stage.useKnowledge, knowledgeSections: stage.knowledgeSections, useGlobalActions: stage.useGlobalActions, globalActions: stage.globalActions, variables: stage.variables, actions: stage.actions, classifierIds: stage.classifierIds, transformerIds: stage.transformerIds, metadata: stage.metadata }, context?.adminId);

      logger.info({ stageId: stage.stageId, newVersion: stage.version }, 'Stage updated successfully');

      return stageResponseSchema.parse(stage);
    } catch (error) {
      logger.error({ error, stageId }, 'Failed to update stage');
      throw error;
    }
  }

  /**
   * Deletes a stage using optimistic locking to prevent concurrent modifications
   * @param stageId - The unique identifier of the stage to delete
   * @param expectedVersion - The expected version number for optimistic locking
   * @param context - Request context for auditing and authorization
   * @throws {NotFoundError} When stage is not found
   * @throws {OptimisticLockError} When the version doesn't match (concurrent modification detected)
   */
  async deleteStage(stageId: string, expectedVersion: number, context: RequestContext): Promise<void> {
    this.requirePermission(context, PERMISSIONS.STAGE_DELETE);
    logger.info({ stageId, expectedVersion, adminId: context?.adminId }, 'Deleting stage');

    try {
      const existingStage = await db.query.stages.findFirst({ where: eq(stages.stageId, stageId) });

      if (!existingStage) {
        throw new NotFoundError(`Stage with id ${stageId} not found`);
      }

      if (existingStage.version !== expectedVersion) {
        throw new OptimisticLockError(`Stage version mismatch. Expected ${expectedVersion}, got ${existingStage.version}`);
      }

      const deleted = await db.delete(stages).where(and(eq(stages.stageId, stageId), eq(stages.version, expectedVersion))).returning();

      if (deleted.length === 0) {
        throw new OptimisticLockError(`Failed to delete stage due to version conflict`);
      }

      await this.auditService.logDelete('stage', stageId, { stageId: existingStage.stageId, prompt: existingStage.prompt, llmProvider: existingStage.llmProvider, llmProviderConfig: existingStage.llmProviderConfig, personaId: existingStage.personaId, enterBehavior: existingStage.enterBehavior, useKnowledge: existingStage.useKnowledge, knowledgeSections: existingStage.knowledgeSections, useGlobalActions: existingStage.useGlobalActions, globalActions: existingStage.globalActions, variables: existingStage.variables, actions: existingStage.actions, classifierIds: existingStage.classifierIds, transformerIds: existingStage.transformerIds, metadata: existingStage.metadata }, context?.adminId);

      logger.info({ stageId }, 'Stage deleted successfully');
    } catch (error) {
      logger.error({ error, stageId }, 'Failed to delete stage');
      throw error;
    }
  }

  /**
   * Retrieves all audit log entries for a specific stage
   * @param stageId - The unique identifier of the stage
   * @returns Array of audit log entries for the stage
   */
  async getStageAuditLogs(stageId: string): Promise<any[]> {
    logger.debug({ stageId }, 'Fetching audit logs for stage');

    try {
      return await this.auditService.getEntityAuditLogs('stage', stageId);
    } catch (error) {
      logger.error({ error, stageId }, 'Failed to fetch stage audit logs');
      throw error;
    }
  }
}
