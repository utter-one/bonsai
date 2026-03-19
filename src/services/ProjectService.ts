import { injectable, inject } from 'tsyringe';
import { eq, SQL, desc, and, isNull, isNotNull } from 'drizzle-orm';
import { buildTextSearchCondition } from '../utils/textSearch';
import { db } from '../db/index';
import { projects, providers, apiKeys, stages, knowledgeCategories, knowledgeItems, globalActions, tools, contextTransformers, classifiers, agents, conversations, issues } from '../db/schema';
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
      const project = await db.insert(projects).values({ id, name: input.name, description: input.description, asrConfig: input.asrConfig, acceptVoice: input.acceptVoice ?? true, generateVoice: input.generateVoice ?? true, storageConfig: input.storageConfig, moderationConfig: input.moderationConfig, constants: input.constants, metadata: input.metadata, timezone: input.timezone, languageCode: input.languageCode, autoCreateUsers: input.autoCreateUsers ?? false, userProfileVariableDescriptors: input.userProfileVariableDescriptors ?? [], defaultGuardrailClassifierId: input.defaultGuardrailClassifierId ?? null, conversationTimeoutSeconds: input.conversationTimeoutSeconds ?? null, version: 1 }).returning();

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
  async getProjectById(id: string): Promise<ProjectResponse> {
    logger.debug({ projectId: id }, 'Fetching project by ID');

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
  async listProjects(params?: ListProjectsQuery): Promise<ProjectListResponse> {
    logger.debug({ params }, 'Listing projects');

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

      const updateData = { name: input.name, description: input.description, asrConfig: input.asrConfig, acceptVoice: input.acceptVoice, generateVoice: input.generateVoice, storageConfig: input.storageConfig, moderationConfig: input.moderationConfig, constants: input.constants, metadata: input.metadata, timezone: input.timezone, languageCode: input.languageCode, autoCreateUsers: input.autoCreateUsers, userProfileVariableDescriptors: input.userProfileVariableDescriptors, defaultGuardrailClassifierId: input.defaultGuardrailClassifierId, conversationTimeoutSeconds: input.conversationTimeoutSeconds ?? null, version: existingProject.version + 1, updatedAt: new Date() };
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

        // 1. Delete apiKeys
        const apiKeyRecords = await tx.query.apiKeys.findMany({ where: eq(apiKeys.projectId, id) });
        for (const apiKey of apiKeyRecords) {
          const { key: _key, ...safeApiKey } = apiKey;
          await tx.delete(apiKeys).where(and(eq(apiKeys.projectId, id), eq(apiKeys.id, apiKey.id)));
          await this.auditService.logDelete('api_key', apiKey.id, safeApiKey, context?.operatorId);
        }
        logger.debug({ projectId: id, count: apiKeyRecords.length }, 'Deleted apiKeys');

        // 2. Delete stages (must be before agents/classifiers due to FK references)
        const stageRecords = await tx.query.stages.findMany({ where: eq(stages.projectId, id) });
        for (const stage of stageRecords) {
          await tx.delete(stages).where(and(eq(stages.projectId, id), eq(stages.id, stage.id)));
          await this.auditService.logDelete('stage', stage.id, stage, context?.operatorId);
        }
        logger.debug({ projectId: id, count: stageRecords.length }, 'Deleted stages');

        // 3. Delete knowledgeItems (children of knowledgeCategories)
        const categoryRecords = await tx.query.knowledgeCategories.findMany({ where: eq(knowledgeCategories.projectId, id) });
        for (const category of categoryRecords) {
          const itemRecords = await tx.query.knowledgeItems.findMany({ where: and(eq(knowledgeItems.projectId, id), eq(knowledgeItems.categoryId, category.id)) });
          for (const item of itemRecords) {
            await tx.delete(knowledgeItems).where(and(eq(knowledgeItems.projectId, id), eq(knowledgeItems.id, item.id)));
            await this.auditService.logDelete('knowledge_item', item.id, item, context?.operatorId, id);
          }
        }
        logger.debug({ projectId: id, categoryCount: categoryRecords.length }, 'Deleted knowledgeItems');

        // 4. Delete knowledgeCategories
        for (const category of categoryRecords) {
          await tx.delete(knowledgeCategories).where(and(eq(knowledgeCategories.projectId, id), eq(knowledgeCategories.id, category.id)));
          await this.auditService.logDelete('knowledge_category', category.id, category, context?.operatorId);
        }
        logger.debug({ projectId: id, count: categoryRecords.length }, 'Deleted knowledgeCategories');

        // 5. Delete globalActions
        const globalActionRecords = await tx.query.globalActions.findMany({ where: eq(globalActions.projectId, id) });
        for (const action of globalActionRecords) {
          await tx.delete(globalActions).where(and(eq(globalActions.projectId, id), eq(globalActions.id, action.id)));
          await this.auditService.logDelete('global_action', action.id, action, context?.operatorId);
        }
        logger.debug({ projectId: id, count: globalActionRecords.length }, 'Deleted globalActions');

        // 6. Delete tools
        const toolRecords = await tx.query.tools.findMany({ where: eq(tools.projectId, id) });
        for (const tool of toolRecords) {
          await tx.delete(tools).where(and(eq(tools.projectId, id), eq(tools.id, tool.id)));
          await this.auditService.logDelete('tool', tool.id, tool, context?.operatorId);
        }
        logger.debug({ projectId: id, count: toolRecords.length }, 'Deleted tools');

        // 7. Delete contextTransformers
        const transformerRecords = await tx.query.contextTransformers.findMany({ where: eq(contextTransformers.projectId, id) });
        for (const transformer of transformerRecords) {
          await tx.delete(contextTransformers).where(and(eq(contextTransformers.projectId, id), eq(contextTransformers.id, transformer.id)));
          await this.auditService.logDelete('context_transformer', transformer.id, transformer, context?.operatorId);
        }
        logger.debug({ projectId: id, count: transformerRecords.length }, 'Deleted contextTransformers');

        // 8. Delete classifiers
        const classifierRecords = await tx.query.classifiers.findMany({ where: eq(classifiers.projectId, id) });
        for (const classifier of classifierRecords) {
          await tx.delete(classifiers).where(and(eq(classifiers.projectId, id), eq(classifiers.id, classifier.id)));
          await this.auditService.logDelete('classifier', classifier.id, classifier, context?.operatorId);
        }
        logger.debug({ projectId: id, count: classifierRecords.length }, 'Deleted classifiers');

        // 9. Delete agents
        const agentRecords = await tx.query.agents.findMany({ where: eq(agents.projectId, id) });
        for (const agent of agentRecords) {
          await tx.delete(agents).where(and(eq(agents.projectId, id), eq(agents.id, agent.id)));
          await this.auditService.logDelete('agent', agent.id, agent, context?.operatorId);
        }
        logger.debug({ projectId: id, count: agentRecords.length }, 'Deleted agents');

        // 10. Delete conversations (auto-cascades to conversationEvents and conversationArtifacts via DB constraints)
        const conversationRecords = await tx.query.conversations.findMany({ where: eq(conversations.projectId, id) });
        for (const conversation of conversationRecords) {
          await tx.delete(conversations).where(and(eq(conversations.projectId, id), eq(conversations.id, conversation.id)));
          await this.auditService.logDelete('conversation', conversation.id, conversation, context?.operatorId);
        }
        logger.debug({ projectId: id, count: conversationRecords.length }, 'Deleted conversations');

        // 11. Delete issues
        const issueRecords = await tx.query.issues.findMany({ where: eq(issues.projectId, id) });
        for (const issue of issueRecords) {
          await tx.delete(issues).where(and(eq(issues.projectId, id), eq(issues.id, issue.id)));
          await this.auditService.logDelete('issue', String(issue.id), issue, context?.operatorId);
        }
        logger.debug({ projectId: id, count: issueRecords.length }, 'Deleted issues');

        // 12. Finally delete the project itself
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
  async getProjectAuditLogs(projectId: string): Promise<any[]> {
    logger.debug({ projectId }, 'Fetching audit logs for project');

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
