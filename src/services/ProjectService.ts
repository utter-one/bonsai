import { injectable, inject } from 'tsyringe';
import { eq, SQL, desc, and, isNull, isNotNull, inArray } from 'drizzle-orm';
import { buildTextSearchCondition } from '../utils/textSearch';
import { db } from '../db/index';
import { projects, providers, apiKeys, stages, knowledgeCategories, knowledgeItems, globalActions, tools, contextTransformers, classifiers, agents, conversations, issues, users, guardrails } from '../db/schema';
import type { CreateProjectRequest, UpdateProjectRequest, ProjectResponse, ProjectListResponse, ArchiveProjectRequest, ListProjectsQuery } from '../http/contracts/project';
import { projectResponseSchema, projectListResponseSchema } from '../http/contracts/project';
import { AuditService } from './AuditService';
import { OptimisticLockError, NotFoundError, InvalidOperationError, ArchivedProjectError } from '../errors';
import { buildFilterCondition, buildOrderBy } from '../utils/queryBuilder';
import { countRows, normalizeListLimit } from '../utils/pagination';
import { logger } from '../utils/logger';
import { BaseService } from './BaseService';
import type { RequestContext } from './RequestContext';
import { PERMISSIONS } from '../permissions';
import { generateId, ID_PREFIXES } from '../utils/idGenerator';
/**
 * Service for managing projects with full CRUD operations and audit logging
 */
@injectable()
export class ProjectService extends BaseService {
  constructor(@inject(AuditService) private readonly auditService: AuditService) {
    super();
  }

  /**
   * Creates a new project and logs the creation in the audit trail
   * @param input - Project creation data including name, description, and optional metadata
   * @param context - Request context for auditing and authorization
   * @returns The created project
   */
  async createProject(input: CreateProjectRequest, context: RequestContext): Promise<ProjectResponse> {
    this.requirePermission(context, PERMISSIONS.PROJECT_WRITE);
    logger.info({ name: input.name, operatorId: context?.operatorId }, 'Creating project');

    // Validate storage provider if configured
    if (input.storageConfig?.storageProviderId) {
      await this.validateStorageProvider(input.storageConfig.storageProviderId);
    }

    const effectiveAcceptVoice = input.acceptVoice ?? true;
    if (effectiveAcceptVoice && !input.asrConfig) {
      throw new InvalidOperationError('asrConfig is required when acceptVoice is enabled');
    }

    try {
      const id = generateId(ID_PREFIXES.PROJECT);
      const project = await db.insert(projects).values({ id, name: input.name, description: input.description, asrConfig: input.asrConfig, acceptVoice: input.acceptVoice ?? true, generateVoice: input.generateVoice ?? true, storageConfig: input.storageConfig, moderationConfig: input.moderationConfig, costManagementConfig: input.costManagementConfig, constants: input.constants, metadata: input.metadata, timezone: input.timezone, languageCode: input.languageCode, autoCreateUsers: input.autoCreateUsers ?? false, userProfileVariableDescriptors: input.userProfileVariableDescriptors ?? [], defaultGuardrailClassifierId: input.defaultGuardrailClassifierId ?? null, sampleCopyConfig: input.sampleCopyConfig ?? null, startingStageId: input.startingStageId ?? null, conversationTimeoutSeconds: input.conversationTimeoutSeconds ?? null, recordingConfig: input.recordingConfig ?? null, version: 1 }).returning();

      const createdProject = project[0];

      await this.auditService.logCreate('project', createdProject.id, createdProject, context?.operatorId);

      logger.info({ projectId: createdProject.id }, 'Project created successfully');

      return projectResponseSchema.parse(createdProject);
    } catch (error) {
      logger.error({ error, name: input.name }, 'Failed to create project');
      throw error;
    }
  }

  /**
   * Retrieves a project by its unique identifier
   * @param id - The unique identifier of the project
   * @returns The project if found
   * @throws {NotFoundError} When project is not found
   */
  async getProjectById(id: string, context: RequestContext): Promise<ProjectResponse> {
    this.requirePermission(context, PERMISSIONS.PROJECT_READ);
    logger.debug({ projectId: id, operatorId: context.operatorId }, 'Fetching project by ID');

    try {
      const project = await db.query.projects.findFirst({ where: eq(projects.id, id) });

      if (!project) {
        throw new NotFoundError(`Project with id ${id} not found`);
      }

      return projectResponseSchema.parse(project);
    } catch (error) {
      logger.error({ error, projectId: id }, 'Failed to fetch project');
      throw error;
    }
  }

  /**
   * Lists projects with flexible filtering, sorting, and pagination
   * @param params - List parameters including filters, sorting, pagination, text search, and archived flag
   * @returns Paginated array of projects matching the criteria
   */
  async listProjects(context: RequestContext, params?: ListProjectsQuery): Promise<ProjectListResponse> {
    this.requirePermission(context, PERMISSIONS.PROJECT_READ);
    logger.debug({ params, operatorId: context.operatorId }, 'Listing projects');

    try {
      const conditions: SQL[] = [];
      const offset = params?.offset ?? 0;
      const limit = normalizeListLimit(params?.limit);

      // Filter by archived status: default to active (non-archived) projects
      if (params?.archived) {
        conditions.push(isNotNull(projects.archivedAt));
      } else {
        conditions.push(isNull(projects.archivedAt));
      }

      const columnMap = { id: projects.id, name: projects.name, version: projects.version, createdAt: projects.createdAt, updatedAt: projects.updatedAt };

      if (params?.filters) {
        for (const [field, filter] of Object.entries(params.filters)) {
          const condition = buildFilterCondition(field, filter, columnMap, logger);
          if (condition) {
            conditions.push(condition);
          }
        }
      }

      if (params?.textSearch) {
        const searchCondition = buildTextSearchCondition(params.textSearch, [projects.name]);
        if (searchCondition) conditions.push(searchCondition);
      }

      const orderBy = buildOrderBy(params?.orderBy, columnMap) ?? desc(projects.createdAt);
      const whereCondition = conditions.length > 0 ? and(...conditions) : undefined;
      const projectList = await db.query.projects.findMany({ where: whereCondition, orderBy, offset, limit });
      const total = await countRows(projects, whereCondition);

      logger.debug({ count: projectList.length, total }, 'Projects listed successfully');

      return projectListResponseSchema.parse({ items: projectList, total });
    } catch (error) {
      logger.error({ error, params }, 'Failed to list projects');
      throw error;
    }
  }

  /**
   * Updates an existing project with optimistic locking to prevent concurrent modification issues.
   * Archive status (archivedAt / archivedBy) cannot be changed via this method —
   * use archiveProject / unarchiveProject for that purpose.
   * @param id - The project identifier
   * @param input - Update data with version for optimistic locking
   * @param context - Request context for auditing and authorization
   * @returns The updated project
   * @throws {NotFoundError} When project is not found
   * @throws {ArchivedProjectError} When the project is archived
   * @throws {OptimisticLockError} When the version does not match, indicating concurrent modification
   */
  async updateProject(id: string, input: UpdateProjectRequest, context: RequestContext): Promise<ProjectResponse> {
    this.requirePermission(context, PERMISSIONS.PROJECT_WRITE);
    await this.requireProjectNotArchived(id);
    logger.info({ projectId: id, operatorId: context?.operatorId }, 'Updating project');

    // Validate storage provider if being updated
    if (input.storageConfig?.storageProviderId) {
      await this.validateStorageProvider(input.storageConfig.storageProviderId);
    }

    try {
      const existingProject = await db.query.projects.findFirst({ where: eq(projects.id, id) });

      if (!existingProject) {
        throw new NotFoundError(`Project with id ${id} not found`);
      }

      if (existingProject.version !== input.version) {
        logger.warn({ projectId: id, expectedVersion: input.version, actualVersion: existingProject.version }, 'Optimistic lock version mismatch');
        throw new OptimisticLockError('Project');
      }

      const effectiveAcceptVoice = input.acceptVoice !== undefined ? input.acceptVoice : existingProject.acceptVoice;
      const effectiveAsrConfig = input.asrConfig !== undefined ? input.asrConfig : existingProject.asrConfig;
      if (effectiveAcceptVoice && !effectiveAsrConfig) {
        throw new InvalidOperationError('asrConfig is required when acceptVoice is enabled');
      }

      const updateData = { name: input.name !== undefined ? input.name : existingProject.name, description: input.description !== undefined ? input.description : existingProject.description, asrConfig: input.asrConfig !== undefined ? input.asrConfig : existingProject.asrConfig, acceptVoice: input.acceptVoice !== undefined ? input.acceptVoice : existingProject.acceptVoice, generateVoice: input.generateVoice !== undefined ? input.generateVoice : existingProject.generateVoice, storageConfig: input.storageConfig !== undefined ? input.storageConfig : existingProject.storageConfig, moderationConfig: input.moderationConfig !== undefined ? input.moderationConfig : existingProject.moderationConfig, costManagementConfig: input.costManagementConfig !== undefined ? input.costManagementConfig : existingProject.costManagementConfig, constants: input.constants !== undefined ? input.constants : existingProject.constants, metadata: input.metadata !== undefined ? input.metadata : existingProject.metadata, timezone: input.timezone !== undefined ? input.timezone : existingProject.timezone, languageCode: input.languageCode !== undefined ? input.languageCode : existingProject.languageCode, autoCreateUsers: input.autoCreateUsers !== undefined ? input.autoCreateUsers : existingProject.autoCreateUsers, userProfileVariableDescriptors: input.userProfileVariableDescriptors !== undefined ? input.userProfileVariableDescriptors : existingProject.userProfileVariableDescriptors, defaultGuardrailClassifierId: input.defaultGuardrailClassifierId !== undefined ? input.defaultGuardrailClassifierId : existingProject.defaultGuardrailClassifierId, sampleCopyConfig: input.sampleCopyConfig !== undefined ? input.sampleCopyConfig : existingProject.sampleCopyConfig, startingStageId: input.startingStageId !== undefined ? input.startingStageId : existingProject.startingStageId, conversationTimeoutSeconds: input.conversationTimeoutSeconds !== undefined ? input.conversationTimeoutSeconds : existingProject.conversationTimeoutSeconds, recordingConfig: input.recordingConfig !== undefined ? input.recordingConfig : existingProject.recordingConfig, version: existingProject.version + 1, updatedAt: new Date() };
      const updatedProject = await db.update(projects).set(updateData).where(eq(projects.id, id)).returning();

      if (!updatedProject[0]) {
        throw new NotFoundError(`Project with id ${id} not found`);
      }

      await this.auditService.logUpdate('project', id, existingProject, updatedProject[0], context?.operatorId, id);

      logger.info({ projectId: id }, 'Project updated successfully');

      return projectResponseSchema.parse(updatedProject[0]);
    } catch (error) {
      logger.error({ error, projectId: id }, 'Failed to update project');
      throw error;
    }
  }

  /**
   * Deletes a project and all related entities (cascading deletion)
   * @param id - The project identifier
   * @param context - Request context for auditing and authorization
   * @throws {NotFoundError} When project is not found
   */
  async deleteProject(id: string, context: RequestContext): Promise<void> {
    this.requirePermission(context, PERMISSIONS.PROJECT_DELETE);
    logger.info({ projectId: id, operatorId: context?.operatorId }, 'Deleting project with cascading deletion');

    try {
      const existingProject = await db.query.projects.findFirst({ where: eq(projects.id, id) });

      if (!existingProject) {
        throw new NotFoundError(`Project with id ${id} not found`);
      }

     // Use transaction to ensure atomicity - all or nothing
      await db.transaction(async (tx) => {
        // Delete in FK-safe order (reverse of import order from MigrationService)

        // 1. Delete apiKeys (batch)
        const apiKeyRecords = await tx.query.apiKeys.findMany({ where: eq(apiKeys.projectId, id) });
        if (apiKeyRecords.length > 0) {
          const apiKeyIds = apiKeyRecords.map(apiKey => apiKey.id);
          await tx.delete(apiKeys).where(and(eq(apiKeys.projectId, id), inArray(apiKeys.id, apiKeyIds)));
          for (const apiKey of apiKeyRecords) {
            const { key: _key, ...safeApiKey } = apiKey;
            await this.auditService.logDelete('api_key', apiKey.id, safeApiKey, context?.operatorId);
          }
        }
        logger.debug({ projectId: id, count: apiKeyRecords.length }, 'Deleted apiKeys');

        // 2. Delete stages (must be before agents/classifiers due to FK references) (batch)
        const stageRecords = await tx.query.stages.findMany({ where: eq(stages.projectId, id) });
        if (stageRecords.length > 0) {
          const stageIds = stageRecords.map(stage => stage.id);
          await tx.delete(stages).where(and(eq(stages.projectId, id), inArray(stages.id, stageIds)));
          for (const stage of stageRecords) {
            await this.auditService.logDelete('stage', stage.id, stage, context?.operatorId);
          }
        }
        logger.debug({ projectId: id, count: stageRecords.length }, 'Deleted stages');

        // 3. Delete knowledgeItems (children of knowledgeCategories) (batch)
        const categoryRecords = await tx.query.knowledgeCategories.findMany({ where: eq(knowledgeCategories.projectId, id) });
        const itemRecords = await tx.query.knowledgeItems.findMany({ where: eq(knowledgeItems.projectId, id) });
        if (itemRecords.length > 0) {
          const itemIds = itemRecords.map(item => item.id);
          await tx.delete(knowledgeItems).where(and(eq(knowledgeItems.projectId, id), inArray(knowledgeItems.id, itemIds)));
          for (const item of itemRecords) {
            await this.auditService.logDelete('knowledge_item', item.id, item, context?.operatorId, id);
          }
        }
        logger.debug({ projectId: id, categoryCount: categoryRecords.length }, 'Deleted knowledgeItems');

        // 4. Delete knowledgeCategories (batch)
        if (categoryRecords.length > 0) {
          const categoryIds = categoryRecords.map(category => category.id);
          await tx.delete(knowledgeCategories).where(and(eq(knowledgeCategories.projectId, id), inArray(knowledgeCategories.id, categoryIds)));
          for (const category of categoryRecords) {
            await this.auditService.logDelete('knowledge_category', category.id, category, context?.operatorId);
          }
        }
        logger.debug({ projectId: id, count: categoryRecords.length }, 'Deleted knowledgeCategories');

        // 5. Delete globalActions (batch)
        const globalActionRecords = await tx.query.globalActions.findMany({ where: eq(globalActions.projectId, id) });
        if (globalActionRecords.length > 0) {
          const globalActionIds = globalActionRecords.map(action => action.id);
          await tx.delete(globalActions).where(and(eq(globalActions.projectId, id), inArray(globalActions.id, globalActionIds)));
          for (const action of globalActionRecords) {
            await this.auditService.logDelete('global_action', action.id, action, context?.operatorId);
          }
        }
        logger.debug({ projectId: id, count: globalActionRecords.length }, 'Deleted globalActions');

        // 6. Delete tools (batch)
        const toolRecords = await tx.query.tools.findMany({ where: eq(tools.projectId, id) });
        if (toolRecords.length > 0) {
          const toolIds = toolRecords.map(tool => tool.id);
          await tx.delete(tools).where(and(eq(tools.projectId, id), inArray(tools.id, toolIds)));
          for (const tool of toolRecords) {
            await this.auditService.logDelete('tool', tool.id, tool, context?.operatorId);
          }
        }
        logger.debug({ projectId: id, count: toolRecords.length }, 'Deleted tools');

        // 7. Delete contextTransformers (batch)
        const transformerRecords = await tx.query.contextTransformers.findMany({ where: eq(contextTransformers.projectId, id) });
        if (transformerRecords.length > 0) {
          const transformerIds = transformerRecords.map(transformer => transformer.id);
          await tx.delete(contextTransformers).where(and(eq(contextTransformers.projectId, id), inArray(contextTransformers.id, transformerIds)));
          for (const transformer of transformerRecords) {
            await this.auditService.logDelete('context_transformer', transformer.id, transformer, context?.operatorId);
          }
        }
        logger.debug({ projectId: id, count: transformerRecords.length }, 'Deleted contextTransformers');

        // 8. Delete classifiers (batch)
        const classifierRecords = await tx.query.classifiers.findMany({ where: eq(classifiers.projectId, id) });
        if (classifierRecords.length > 0) {
          const classifierIds = classifierRecords.map(classifier => classifier.id);
          await tx.delete(classifiers).where(and(eq(classifiers.projectId, id), inArray(classifiers.id, classifierIds)));
          for (const classifier of classifierRecords) {
            await this.auditService.logDelete('classifier', classifier.id, classifier, context?.operatorId);
          }
        }
        logger.debug({ projectId: id, count: classifierRecords.length }, 'Deleted classifiers');

        // 9. Delete agents (batch)
        const agentRecords = await tx.query.agents.findMany({ where: eq(agents.projectId, id) });
        if (agentRecords.length > 0) {
          const agentIds = agentRecords.map(agent => agent.id);
          await tx.delete(agents).where(and(eq(agents.projectId, id), inArray(agents.id, agentIds)));
          for (const agent of agentRecords) {
            await this.auditService.logDelete('agent', agent.id, agent, context?.operatorId);
          }
        }
        logger.debug({ projectId: id, count: agentRecords.length }, 'Deleted agents');

        // 10. Delete conversations (auto-cascades to conversationEvents and conversationArtifacts via DB constraints) (batch)
        const conversationRecords = await tx.query.conversations.findMany({ where: eq(conversations.projectId, id) });
        if (conversationRecords.length > 0) {
          const conversationIds = conversationRecords.map(conversation => conversation.id);
          await tx.delete(conversations).where(and(eq(conversations.projectId, id), inArray(conversations.id, conversationIds)));
          for (const conversation of conversationRecords) {
            await this.auditService.logDelete('conversation', conversation.id, conversation, context?.operatorId);
          }
        }
        logger.debug({ projectId: id, count: conversationRecords.length }, 'Deleted conversations');

        // 11. Delete users (must come after conversations due to composite FK from conversations to users) (batch)
        const userRecords = await tx.query.users.findMany({ where: eq(users.projectId, id) });
        if (userRecords.length > 0) {
          const userIds = userRecords.map(user => user.id);
          await tx.delete(users).where(and(eq(users.projectId, id), inArray(users.id, userIds)));
          for (const user of userRecords) {
            await this.auditService.logDelete('user', user.id, user, context?.operatorId, id);
          }
        }
        logger.debug({ projectId: id, count: userRecords.length }, 'Deleted users');

        // 12. Delete guardrails (batch)
        const guardrailRecords = await tx.query.guardrails.findMany({ where: eq(guardrails.projectId, id) });
        if (guardrailRecords.length > 0) {
          const guardrailIds = guardrailRecords.map(guardrail => guardrail.id);
          await tx.delete(guardrails).where(and(eq(guardrails.projectId, id), inArray(guardrails.id, guardrailIds)));
          for (const guardrail of guardrailRecords) {
            await this.auditService.logDelete('guardrail', guardrail.id, guardrail, context?.operatorId);
          }
        }
        logger.debug({ projectId: id, count: guardrailRecords.length }, 'Deleted guardrails');

        // 13. Delete issues (batch)
        const issueRecords = await tx.query.issues.findMany({ where: eq(issues.projectId, id) });
        if (issueRecords.length > 0) {
          const issueIds = issueRecords.map(issue => issue.id);
          await tx.delete(issues).where(and(eq(issues.projectId, id), inArray(issues.id, issueIds)));
          for (const issue of issueRecords) {
            await this.auditService.logDelete('issue', String(issue.id), issue, context?.operatorId);
          }
        }
        logger.debug({ projectId: id, count: issueRecords.length }, 'Deleted issues');

        // 14. Finally delete the project itself
        await tx.delete(projects).where(eq(projects.id, id));
        await this.auditService.logDelete('project', id, existingProject, context?.operatorId);
      });

      logger.info({ projectId: id }, 'Project and all related entities deleted successfully');
    } catch (error) {
      logger.error({ error, projectId: id }, 'Failed to delete project');
      throw error;
    }
  }

  /**
   * Archives a project, blocking all modifications to its entities
   * @param id - The project identifier
   * @param input - Archive request with version for optimistic locking
   * @param context - Request context for auditing and authorization
   * @returns The archived project
   * @throws {NotFoundError} When project is not found
   * @throws {ArchivedProjectError} When the project is already archived
   * @throws {OptimisticLockError} When the version does not match
   */
  async archiveProject(id: string, input: ArchiveProjectRequest, context: RequestContext): Promise<ProjectResponse> {
    this.requirePermission(context, PERMISSIONS.PROJECT_WRITE);
    logger.info({ projectId: id, operatorId: context?.operatorId }, 'Archiving project');

    try {
      const existingProject = await db.query.projects.findFirst({ where: eq(projects.id, id) });

      if (!existingProject) {
        throw new NotFoundError(`Project with id ${id} not found`);
      }

      if (existingProject.archivedAt !== null) {
        throw new ArchivedProjectError(`Project ${id} is already archived`);
      }

      if (existingProject.version !== input.version) {
        logger.warn({ projectId: id, expectedVersion: input.version, actualVersion: existingProject.version }, 'Optimistic lock version mismatch');
        throw new OptimisticLockError('Project');
      }

      const updatedProject = await db.update(projects).set({ archivedAt: new Date(), archivedBy: context.operatorId, version: existingProject.version + 1, updatedAt: new Date() }).where(and(eq(projects.id, id), eq(projects.version, input.version))).returning();

      if (!updatedProject[0]) {
        throw new OptimisticLockError('Project');
      }

      await this.auditService.logUpdate('project', id, existingProject, updatedProject[0], context?.operatorId, id);
      logger.info({ projectId: id }, 'Project archived successfully');

      return projectResponseSchema.parse(updatedProject[0]);
    } catch (error) {
      logger.error({ error, projectId: id }, 'Failed to archive project');
      throw error;
    }
  }

  /**
   * Restores a previously archived project, re-enabling all modifications to its entities
   * @param id - The project identifier
   * @param input - Unarchive request with version for optimistic locking
   * @param context - Request context for auditing and authorization
   * @returns The restored project
   * @throws {NotFoundError} When project is not found
   * @throws {InvalidOperationError} When the project is not archived
   * @throws {OptimisticLockError} When the version does not match
   */
  async unarchiveProject(id: string, input: ArchiveProjectRequest, context: RequestContext): Promise<ProjectResponse> {
    this.requirePermission(context, PERMISSIONS.PROJECT_WRITE);
    logger.info({ projectId: id, operatorId: context?.operatorId }, 'Unarchiving project');

    try {
      const existingProject = await db.query.projects.findFirst({ where: eq(projects.id, id) });

      if (!existingProject) {
        throw new NotFoundError(`Project with id ${id} not found`);
      }

      if (existingProject.archivedAt === null) {
        throw new InvalidOperationError(`Project ${id} is not archived`);
      }

      if (existingProject.version !== input.version) {
        logger.warn({ projectId: id, expectedVersion: input.version, actualVersion: existingProject.version }, 'Optimistic lock version mismatch');
        throw new OptimisticLockError('Project');
      }

      const updatedProject = await db.update(projects).set({ archivedAt: null, archivedBy: null, version: existingProject.version + 1, updatedAt: new Date() }).where(and(eq(projects.id, id), eq(projects.version, input.version))).returning();

      if (!updatedProject[0]) {
        throw new OptimisticLockError('Project');
      }

      await this.auditService.logUpdate('project', id, existingProject, updatedProject[0], context?.operatorId, id);
      logger.info({ projectId: id }, 'Project unarchived successfully');

      return projectResponseSchema.parse(updatedProject[0]);
    } catch (error) {
      logger.error({ error, projectId: id }, 'Failed to unarchive project');
      throw error;
    }
  }

  /**
   * Retrieves all audit log entries for a specific project
   * @param projectId - The unique identifier of the project
   * @returns Array of audit log entries for the project
   */
  async getProjectAuditLogs(projectId: string, context: RequestContext): Promise<any[]> {
    this.requirePermission(context, PERMISSIONS.AUDIT_READ);
    logger.debug({ projectId, operatorId: context.operatorId }, 'Fetching audit logs for project');

    try {
      return await this.auditService.getEntityAuditLogs('project', projectId);
    } catch (error) {
      logger.error({ error, projectId }, 'Failed to fetch project audit logs');
      throw error;
    }
  }

  /**
   * Validates that a storage provider exists and is of type 'storage'
   */
  private async validateStorageProvider(storageProviderId: string): Promise<void> {
    const provider = await db.query.providers.findFirst({ where: eq(providers.id, storageProviderId) });

    if (!provider) {
      throw new NotFoundError(`Storage provider with id ${storageProviderId} not found`);
    }

    if (provider.providerType !== 'storage') {
      throw new InvalidOperationError(`Provider ${storageProviderId} is not a storage provider (type: ${provider.providerType})`);
    }
  }
}
