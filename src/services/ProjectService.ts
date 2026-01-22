import { injectable, inject } from 'tsyringe';
import { eq, SQL, desc } from 'drizzle-orm';
import { db } from '../db/index';
import { projects } from '../db/schema';
import type { CreateProjectRequest, UpdateProjectRequest, ProjectResponse, ProjectListResponse } from '../http/contracts/project';
import type { ListParams } from '../http/contracts/common';
import { projectResponseSchema, projectListResponseSchema } from '../http/contracts/project';
import { AuditService } from './AuditService';
import { OptimisticLockError, NotFoundError } from '../errors';
import { buildFilterCondition, buildOrderBy } from '../utils/queryBuilder';
import { logger } from '../utils/logger';
import { BaseService } from './BaseService';
import type { RequestContext } from './RequestContext';
import { PERMISSIONS } from '../permissions';

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
    logger.info({ name: input.name, adminId: context?.adminId }, 'Creating project');

    try {
      const id = `proj_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      const project = await db.insert(projects).values({ id, name: input.name, description: input.description, asrConfig: input.asrConfig, acceptVoice: input.acceptVoice ?? true, generateVoice: input.generateVoice ?? true, constants: input.constants, metadata: input.metadata, version: 1 }).returning();

      const createdProject = project[0];

      await this.auditService.logCreate('project', createdProject.id, { id: createdProject.id, name: createdProject.name, description: createdProject.description, asrConfig: createdProject.asrConfig, acceptVoice: createdProject.acceptVoice, generateVoice: createdProject.generateVoice, constants: createdProject.constants, metadata: createdProject.metadata }, context?.adminId);

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
   * @param params - List parameters including filters, sorting, pagination, and text search
   * @returns Paginated array of projects matching the criteria
   */
  async listProjects(params?: ListParams): Promise<ProjectListResponse> {
    logger.debug({ params }, 'Listing projects');

    try {
      const conditions: SQL[] = [];
      const offset = params?.offset ?? 0;
      const limit = params?.limit ?? null;

      const columnMap = { id: projects.id, name: projects.name, version: projects.version, createdAt: projects.createdAt, updatedAt: projects.updatedAt };

      if (params?.filters) {
        for (const [field, filter] of Object.entries(params.filters)) {
          const condition = buildFilterCondition(field, filter, columnMap, logger);
          if (condition) {
            conditions.push(condition);
          }
        }
      }

      const orderBy = buildOrderBy(params?.orderBy, columnMap) ?? desc(projects.createdAt);
      const whereCondition = conditions.length > 0 ? conditions : undefined;
      const projectList = await db.query.projects.findMany({ where: whereCondition ? (whereCondition.length === 1 ? whereCondition[0] : undefined) : undefined, orderBy, offset, limit: limit ?? undefined });
      const totalQuery = await db.select({ count: projects.id }).from(projects).where(whereCondition ? (whereCondition.length === 1 ? whereCondition[0] : undefined) : undefined);
      const total = totalQuery.length;

      logger.debug({ count: projectList.length, total }, 'Projects listed successfully');

      return projectListResponseSchema.parse({ items: projectList, total });
    } catch (error) {
      logger.error({ error, params }, 'Failed to list projects');
      throw error;
    }
  }

  /**
   * Updates an existing project with optimistic locking to prevent concurrent modification issues
   * @param id - The project identifier
   * @param input - Update data with version for optimistic locking
   * @param context - Request context for auditing and authorization
   * @returns The updated project
   * @throws {NotFoundError} When project is not found
   * @throws {OptimisticLockError} When the version does not match, indicating concurrent modification
   */
  async updateProject(id: string, input: UpdateProjectRequest & { version: number }, context: RequestContext): Promise<ProjectResponse> {
    this.requirePermission(context, PERMISSIONS.PROJECT_WRITE);
    logger.info({ projectId: id, adminId: context?.adminId }, 'Updating project');

    try {
      const existingProject = await db.query.projects.findFirst({ where: eq(projects.id, id) });

      if (!existingProject) {
        throw new NotFoundError(`Project with id ${id} not found`);
      }

      if (existingProject.version !== input.version) {
        throw new OptimisticLockError('Project');
      }

      const updateData = { name: input.name, description: input.description, asrConfig: input.asrConfig, acceptVoice: input.acceptVoice, generateVoice: input.generateVoice, constants: input.constants, metadata: input.metadata, version: existingProject.version + 1, updatedAt: new Date() };
      const updatedProject = await db.update(projects).set(updateData).where(eq(projects.id, id)).returning();

      if (!updatedProject[0]) {
        throw new NotFoundError(`Project with id ${id} not found`);
      }

      await this.auditService.logUpdate('project', id, { id: existingProject.id, name: existingProject.name, description: existingProject.description, asrConfig: existingProject.asrConfig, acceptVoice: existingProject.acceptVoice, generateVoice: existingProject.generateVoice, constants: existingProject.constants, metadata: existingProject.metadata }, { id: updatedProject[0].id, name: updatedProject[0].name, description: updatedProject[0].description, asrConfig: updatedProject[0].asrConfig, acceptVoice: updatedProject[0].acceptVoice, generateVoice: updatedProject[0].generateVoice, constants: updatedProject[0].constants, metadata: updatedProject[0].metadata }, context?.adminId);

      logger.info({ projectId: id }, 'Project updated successfully');

      return projectResponseSchema.parse(updatedProject[0]);
    } catch (error) {
      logger.error({ error, projectId: id }, 'Failed to update project');
      throw error;
    }
  }

  /**
   * Deletes a project by their identifier
   * @param id - The project identifier
   * @param context - Request context for auditing and authorization
   * @throws {NotFoundError} When project is not found
   */
  async deleteProject(id: string, context: RequestContext): Promise<void> {
    this.requirePermission(context, PERMISSIONS.PROJECT_DELETE);
    logger.info({ projectId: id, adminId: context?.adminId }, 'Deleting project');

    try {
      const existingProject = await db.query.projects.findFirst({ where: eq(projects.id, id) });

      if (!existingProject) {
        throw new NotFoundError(`Project with id ${id} not found`);
      }

      await db.delete(projects).where(eq(projects.id, id));

      await this.auditService.logDelete('project', id, { id: existingProject.id, name: existingProject.name, description: existingProject.description, asrConfig: existingProject.asrConfig, acceptVoice: existingProject.acceptVoice, generateVoice: existingProject.generateVoice, constants: existingProject.constants, metadata: existingProject.metadata }, context?.adminId);

      logger.info({ projectId: id }, 'Project deleted successfully');
    } catch (error) {
      logger.error({ error, projectId: id }, 'Failed to delete project');
      throw error;
    }
  }
}
