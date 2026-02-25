import { injectable, inject } from 'tsyringe';
import { eq, and, like, SQL, desc, inArray } from 'drizzle-orm';
import { db } from '../db/index';
import { stages, personas, classifiers, contextTransformers, globalActions, knowledgeCategories } from '../db/schema';
import type { CreateStageRequest, UpdateStageRequest, StageResponse, StageListResponse, CloneStageRequest } from '../http/contracts/stage';
import type { ListParams } from '../http/contracts/common';
import { stageResponseSchema, stageListResponseSchema } from '../http/contracts/stage';
import { AuditService } from './AuditService';
import { OptimisticLockError, NotFoundError } from '../errors';
import { buildFilterCondition, buildOrderBy } from '../utils/queryBuilder';
import { logger } from '../utils/logger';
import { BaseService } from './BaseService';
import type { RequestContext } from './RequestContext';
import { PERMISSIONS } from '../permissions';
import { generateId, ID_PREFIXES } from '../utils/idGenerator';

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
   * @param defaultClassifierId - Default classifier ID to validate (optional)
   * @param transformerIds - Transformer IDs to validate
   * @param knowledgeSectionIds - Knowledge section IDs to validate
   * @param globalActionIds - Global action IDs to validate
   * @throws {NotFoundError} When any referenced entity does not exist
   */
  private async validateReferencedEntities(personaId: string, defaultClassifierId?: string | null, transformerIds?: string[], globalActionIds?: string[]): Promise<void> {
    const errors: string[] = [];

    // Validate persona exists
    const persona = await db.query.personas.findFirst({ where: eq(personas.id, personaId) });
    if (!persona) {
      errors.push(`Persona with id ${personaId} not found`);
    }

    // Validate default classifier exists if provided
    if (defaultClassifierId) {
      const classifier = await db.query.classifiers.findFirst({ where: eq(classifiers.id, defaultClassifierId) });
      if (!classifier) {
        errors.push(`Default classifier with id ${defaultClassifierId} not found`);
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
   * @param input - Stage creation data including id, prompt, personaId, and configuration
   * @param context - Request context for auditing and authorization
   * @returns The created stage
   */
  async createStage(projectId: string, input: CreateStageRequest, context: RequestContext): Promise<StageResponse> {
    this.requirePermission(context, PERMISSIONS.STAGE_WRITE);
    const stageId = input.id ?? generateId(ID_PREFIXES.STAGE);
    logger.info({ id: stageId, projectId, name: input.name, personaId: input.personaId, adminId: context?.adminId }, 'Creating stage');

    try {
      // Validate referenced entities exist
      await this.validateReferencedEntities(input.personaId, input.defaultClassifierId, input.transformerIds, input.globalActions);

      const stage = await db.insert(stages).values({ id: stageId, projectId, name: input.name, description: input.description ?? null, prompt: input.prompt, llmProviderId: input.llmProviderId ?? null, llmSettings: input.llmSettings ?? null, personaId: input.personaId, enterBehavior: input.enterBehavior ?? 'generate_response', useKnowledge: input.useKnowledge ?? false, knowledgeTags: input.knowledgeTags ?? [], useGlobalActions: input.useGlobalActions ?? true, globalActions: input.globalActions ?? [], variableDescriptors: input.variableDescriptors ?? [], actions: input.actions ?? {}, defaultClassifierId: input.defaultClassifierId ?? null, transformerIds: input.transformerIds ?? [], metadata: input.metadata ?? null, version: 1 }).returning();

      const createdStage = stage[0];

      await this.auditService.logCreate('stage', createdStage.id, { id: createdStage.id, projectId: createdStage.projectId, name: createdStage.name, description: createdStage.description, prompt: createdStage.prompt, llmProviderId: createdStage.llmProviderId, llmSettings: createdStage.llmSettings, personaId: createdStage.personaId, enterBehavior: createdStage.enterBehavior, useKnowledge: createdStage.useKnowledge, knowledgeTags: createdStage.knowledgeTags, useGlobalActions: createdStage.useGlobalActions, globalActions: createdStage.globalActions, variableDescriptors: createdStage.variableDescriptors, actions: createdStage.actions, defaultClassifierId: createdStage.defaultClassifierId, transformerIds: createdStage.transformerIds, metadata: createdStage.metadata }, context?.adminId);
      logger.info({ id: createdStage.id }, 'Stage created successfully');

      return stageResponseSchema.parse(createdStage);
    } catch (error) {
      logger.error({ error, id: stageId }, 'Failed to create stage');
      throw error;
    }
  }

  /**
   * Retrieves a stage by its unique identifier
   * @param id - The unique identifier of the stage
   * @returns The stage if found
   * @throws {NotFoundError} When stage is not found
   */
  async getStageById(projectId: string, id: string): Promise<StageResponse> {
    logger.info({ projectId, id }, 'Fetching stage by ID');

    try {
      const stage = await db.query.stages.findFirst({ where: and(eq(stages.projectId, projectId), eq(stages.id, id)) });

      if (!stage) {
        throw new NotFoundError(`Stage with id ${id} not found`);
      }

      return stageResponseSchema.parse(stage);
    } catch (error) {
      logger.error({ error, id }, 'Failed to fetch stage');
      throw error;
    }
  }

  /**
   * Lists stages with flexible filtering, sorting, and pagination
   * @param params - List parameters including filters, sorting, pagination, and text search
   * @returns Paginated array of stages matching the criteria
   */
  async listStages(projectId: string, params?: ListParams): Promise<StageListResponse> {
    logger.debug({ params }, 'Listing stages');

    try {
      const conditions: SQL[] = [eq(stages.projectId, projectId)];
      const offset = params?.offset ?? 0;
      const limit = params?.limit ?? null;

      // Column map for filter and order by operations
      const columnMap = {
        id: stages.id,
        projectId: stages.projectId,
        name: stages.name,
        personaId: stages.personaId,
        enterBehavior: stages.enterBehavior,
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

      // Apply text search (searches name and id)
      if (params?.textSearch) {
        const searchTerm = `%${params.textSearch}%`;
        const { or } = await import('drizzle-orm');
        conditions.push(or(like(stages.name, searchTerm), like(stages.id, searchTerm))!);
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
   * @param id - The unique identifier of the stage to update
   * @param input - Stage update data (with version)
   * @param context - Request context for auditing and authorization
   * @returns The updated stage
   * @throws {NotFoundError} When stage is not found
   * @throws {OptimisticLockError} When the version doesn't match (concurrent modification detected)
   */
  async updateStage(projectId: string, id: string, input: UpdateStageRequest, context: RequestContext): Promise<StageResponse> {
    this.requirePermission(context, PERMISSIONS.STAGE_WRITE);
    const { version: expectedVersion, ...updateData } = input;
    logger.info({ id, expectedVersion, adminId: context?.adminId }, 'Updating stage');

    try {
      const existingStage = await db.query.stages.findFirst({ where: and(eq(stages.projectId, projectId), eq(stages.id, id)) });

      if (!existingStage) {
        throw new NotFoundError(`Stage with id ${id} not found`);
      }

      if (existingStage.version !== expectedVersion) {
        throw new OptimisticLockError(`Stage version mismatch. Expected ${expectedVersion}, got ${existingStage.version}`);
      }

      // Validate referenced entities if they are being updated
      const personaIdToValidate = updateData.personaId ?? existingStage.personaId;
      const defaultClassifierIdToValidate = updateData.defaultClassifierId !== undefined ? updateData.defaultClassifierId : existingStage.defaultClassifierId;
      const transformerIdsToValidate = updateData.transformerIds !== undefined ? updateData.transformerIds : existingStage.transformerIds;
      const globalActionsToValidate = updateData.globalActions !== undefined ? updateData.globalActions : existingStage.globalActions;

      await this.validateReferencedEntities(personaIdToValidate, defaultClassifierIdToValidate, transformerIdsToValidate, globalActionsToValidate);

      const updatePayload: any = { version: existingStage.version + 1, updatedAt: new Date() };
      if (updateData.name !== undefined) updatePayload.name = updateData.name;
      if (updateData.description !== undefined) updatePayload.description = updateData.description;
      if (updateData.prompt !== undefined) updatePayload.prompt = updateData.prompt;
      if (updateData.llmProviderId !== undefined) updatePayload.llmProviderId = updateData.llmProviderId;
      if (updateData.llmSettings !== undefined) updatePayload.llmSettings = updateData.llmSettings;
      if (updateData.personaId !== undefined) updatePayload.personaId = updateData.personaId;
      if (updateData.enterBehavior !== undefined) updatePayload.enterBehavior = updateData.enterBehavior;
      if (updateData.useKnowledge !== undefined) updatePayload.useKnowledge = updateData.useKnowledge;
      if (updateData.knowledgeTags !== undefined) updatePayload.knowledgeTags = updateData.knowledgeTags;
      if (updateData.useGlobalActions !== undefined) updatePayload.useGlobalActions = updateData.useGlobalActions;
      if (updateData.globalActions !== undefined) updatePayload.globalActions = updateData.globalActions;
      if (updateData.variableDescriptors !== undefined) updatePayload.variableDescriptors = updateData.variableDescriptors;
      if (updateData.actions !== undefined) updatePayload.actions = updateData.actions;
      if (updateData.defaultClassifierId !== undefined) updatePayload.defaultClassifierId = updateData.defaultClassifierId;
      if (updateData.transformerIds !== undefined) updatePayload.transformerIds = updateData.transformerIds;
      if (updateData.metadata !== undefined) updatePayload.metadata = updateData.metadata;

      const updatedStage = await db.update(stages).set(updatePayload).where(and(eq(stages.projectId, projectId), eq(stages.id, id), eq(stages.version, expectedVersion))).returning();

      if (updatedStage.length === 0) {
        throw new OptimisticLockError(`Failed to update stage due to version conflict`);
      }

      const stage = updatedStage[0];

      await this.auditService.logUpdate('stage', stage.id, { id: existingStage.id, name: existingStage.name, description: existingStage.description, prompt: existingStage.prompt, llmProviderId: existingStage.llmProviderId, llmSettings: existingStage.llmSettings, personaId: existingStage.personaId, enterBehavior: existingStage.enterBehavior, useKnowledge: existingStage.useKnowledge, knowledgeTags: existingStage.knowledgeTags, useGlobalActions: existingStage.useGlobalActions, globalActions: existingStage.globalActions, variableDescriptors: existingStage.variableDescriptors, actions: existingStage.actions, defaultClassifierId: existingStage.defaultClassifierId, transformerIds: existingStage.transformerIds, metadata: existingStage.metadata }, { id: stage.id, name: stage.name, description: stage.description, prompt: stage.prompt, llmProviderId: stage.llmProviderId, llmSettings: stage.llmSettings, personaId: stage.personaId, enterBehavior: stage.enterBehavior, useKnowledge: stage.useKnowledge, knowledgeTags: stage.knowledgeTags, useGlobalActions: stage.useGlobalActions, globalActions: stage.globalActions, variableDescriptors: stage.variableDescriptors, actions: stage.actions, defaultClassifierId: stage.defaultClassifierId, transformerIds: stage.transformerIds, metadata: stage.metadata }, context?.adminId);

      logger.info({ id: stage.id, newVersion: stage.version }, 'Stage updated successfully');

      return stageResponseSchema.parse(stage);
    } catch (error) {
      logger.error({ error, id }, 'Failed to update stage');
      throw error;
    }
  }

  /**
   * Deletes a stage using optimistic locking to prevent concurrent modifications
   * @param id - The unique identifier of the stage to delete
   * @param expectedVersion - The expected version number for optimistic locking
   * @param context - Request context for auditing and authorization
   * @throws {NotFoundError} When stage is not found
   * @throws {OptimisticLockError} When the version doesn't match (concurrent modification detected)
   */
  async deleteStage(projectId: string, id: string, expectedVersion: number, context: RequestContext): Promise<void> {
    this.requirePermission(context, PERMISSIONS.STAGE_DELETE);
    logger.info({ id, expectedVersion, adminId: context?.adminId }, 'Deleting stage');

    try {
      const existingStage = await db.query.stages.findFirst({ where: and(eq(stages.projectId, projectId), eq(stages.id, id)) });

      if (!existingStage) {
        throw new NotFoundError(`Stage with id ${id} not found`);
      }

      if (existingStage.version !== expectedVersion) {
        throw new OptimisticLockError(`Stage version mismatch. Expected ${expectedVersion}, got ${existingStage.version}`);
      }

      const deleted = await db.delete(stages).where(and(eq(stages.projectId, projectId), eq(stages.id, id), eq(stages.version, expectedVersion))).returning();

      if (deleted.length === 0) {
        throw new OptimisticLockError(`Failed to delete stage due to version conflict`);
      }

      await this.auditService.logDelete('stage', id, { id: existingStage.id, name: existingStage.name, description: existingStage.description, prompt: existingStage.prompt, llmProviderId: existingStage.llmProviderId, llmSettings: existingStage.llmSettings, personaId: existingStage.personaId, enterBehavior: existingStage.enterBehavior, useKnowledge: existingStage.useKnowledge, knowledgeTags: existingStage.knowledgeTags, useGlobalActions: existingStage.useGlobalActions, globalActions: existingStage.globalActions, variableDescriptors: existingStage.variableDescriptors, actions: existingStage.actions, defaultClassifierId: existingStage.defaultClassifierId, transformerIds: existingStage.transformerIds, metadata: existingStage.metadata }, context?.adminId);

      logger.info({ id }, 'Stage deleted successfully');
    } catch (error) {
      logger.error({ error, id }, 'Failed to delete stage');
      throw error;
    }
  }

  /**
   * Creates a copy of an existing stage with a new ID and optional name override
   * @param id - The unique identifier of the stage to clone
   * @param input - Clone options including optional new id and name
   * @param context - Request context for auditing and authorization
   * @returns The newly created cloned stage
   * @throws {NotFoundError} When the source stage is not found
   */
  async cloneStage(projectId: string, id: string, input: CloneStageRequest, context: RequestContext): Promise<StageResponse> {
    this.requirePermission(context, PERMISSIONS.STAGE_WRITE);
    logger.info({ id, adminId: context?.adminId }, 'Cloning stage');

    try {
      const existingStage = await db.query.stages.findFirst({ where: and(eq(stages.projectId, projectId), eq(stages.id, id)) });

      if (!existingStage) {
        throw new NotFoundError(`Stage with id ${id} not found`);
      }

      return await this.createStage(projectId, { id: input.id, name: input.name ?? `${existingStage.name} (Clone)`, description: existingStage.description ?? undefined, prompt: existingStage.prompt, llmProviderId: existingStage.llmProviderId, llmSettings: existingStage.llmSettings as any, personaId: existingStage.personaId, enterBehavior: existingStage.enterBehavior as 'generate_response' | 'await_user_input', useKnowledge: existingStage.useKnowledge, knowledgeTags: existingStage.knowledgeTags as string[], useGlobalActions: existingStage.useGlobalActions, globalActions: existingStage.globalActions as string[], variableDescriptors: existingStage.variableDescriptors as any, actions: existingStage.actions as any, defaultClassifierId: existingStage.defaultClassifierId, transformerIds: existingStage.transformerIds as string[], metadata: existingStage.metadata ?? undefined }, context);
    } catch (error) {
      logger.error({ error, id }, 'Failed to clone stage');
      throw error;
    }
  }

  /**
   * Retrieves all audit log entries for a specific stage
   * @param id - The unique identifier of the stage
   * @returns Array of audit log entries for the stage
   */
  async getStageAuditLogs(id: string): Promise<any[]> {
    logger.debug({ id }, 'Fetching audit logs for stage');

    try {
      return await this.auditService.getEntityAuditLogs('stage', id);
    } catch (error) {
      logger.error({ error, id }, 'Failed to fetch stage audit logs');
      throw error;
    }
  }
}
