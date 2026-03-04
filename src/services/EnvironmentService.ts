import { injectable, inject } from 'tsyringe';
import { eq, and, SQL, desc } from 'drizzle-orm';
import { buildTextSearchCondition } from '../utils/textSearch';
import { db } from '../db/index';
import { environments } from '../db/schema';
import type { CreateEnvironmentRequest, UpdateEnvironmentRequest, EnvironmentResponse, EnvironmentListResponse } from '../http/contracts/environment';
import type { ListParams } from '../http/contracts/common';
import { environmentResponseSchema, environmentListResponseSchema } from '../http/contracts/environment';
import { AuditService } from './AuditService';
import { OptimisticLockError, NotFoundError } from '../errors';
import { buildFilterCondition, buildOrderBy } from '../utils/queryBuilder';
import { logger } from '../utils/logger';
import { BaseService } from './BaseService';
import type { RequestContext } from './RequestContext';
import { PERMISSIONS } from '../permissions';
import { generateId, ID_PREFIXES } from '../utils/idGenerator';

/**
 * Service for managing environments with full CRUD operations and audit logging
 * Environments are used for data migration between server instances
 * Note: Credentials should be handled securely and encrypted at rest
 */
@injectable()
export class EnvironmentService extends BaseService {
  constructor(@inject(AuditService) private readonly auditService: AuditService) {
    super();
  }

  /**
   * Creates a new environment and logs the creation in the audit trail
   * @param input - Environment creation data including id, description, url, login, and password
   * @param context - Request context for auditing and authorization
   * @returns The created environment (without password)
   */
  async createEnvironment(input: CreateEnvironmentRequest, context: RequestContext): Promise<EnvironmentResponse> {
    this.requirePermission(context, PERMISSIONS.ENVIRONMENT_WRITE);
    const environmentId = input.id ?? generateId(ID_PREFIXES.ENVIRONMENT);
    logger.info({ environmentId, description: input.description, operatorId: context?.operatorId }, 'Creating environment');

    try {
      const environment = await db.insert(environments).values({ id: environmentId, description: input.description, url: input.url, login: input.login, password: input.password, version: 1 }).returning();

      const createdEnvironment = environment[0];

      await this.auditService.logCreate('environment', createdEnvironment.id, { id: createdEnvironment.id, description: createdEnvironment.description, url: createdEnvironment.url, login: createdEnvironment.login }, context?.operatorId);

      logger.info({ environmentId: createdEnvironment.id }, 'Environment created successfully');

      return environmentResponseSchema.parse(createdEnvironment);
    } catch (error) {
      logger.error({ error, environmentId: input.id }, 'Failed to create environment');
      throw error;
    }
  }

  /**
   * Retrieves an environment by its unique identifier
   * @param id - The unique identifier of the environment
   * @returns The environment if found (without password)
   * @throws {NotFoundError} When environment is not found
   */
  async getEnvironmentById(id: string): Promise<EnvironmentResponse> {
    logger.debug({ environmentId: id }, 'Fetching environment by ID');

    try {
      const environment = await db.query.environments.findFirst({ where: eq(environments.id, id) });

      if (!environment) {
        throw new NotFoundError(`Environment with id ${id} not found`);
      }

      return environmentResponseSchema.parse(environment);
    } catch (error) {
      logger.error({ error, environmentId: id }, 'Failed to fetch environment');
      throw error;
    }
  }

  /**
   * Lists environments with flexible filtering, sorting, and pagination
   * @param params - List parameters including filters, sorting, pagination, and text search
   * @returns Paginated array of environments matching the criteria (without passwords)
   */
  async listEnvironments(params?: ListParams): Promise<EnvironmentListResponse> {
    logger.debug({ params }, 'Listing environments');

    try {
      const conditions: SQL[] = [];
      const offset = params?.offset ?? 0;
      const limit = params?.limit ?? null;

      // Column map for filter and order by operations
      const columnMap = {
        id: environments.id,
        description: environments.description,
        url: environments.url,
        login: environments.login,
        version: environments.version,
        createdAt: environments.createdAt,
        updatedAt: environments.updatedAt,
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

      // Apply text search (searches id, description, url, login by ilike)
      if (params?.textSearch) {
        const searchCondition = buildTextSearchCondition(params.textSearch, [environments.id, environments.description, environments.url, environments.login]);
        if (searchCondition) conditions.push(searchCondition);
      }

      // Build order by clause
      const orderByClause = buildOrderBy(params?.orderBy, columnMap);

      // Get total count
      const totalResult = await db.query.environments.findMany({
        where: conditions.length > 0 ? and(...conditions) : undefined,
      });
      const total = totalResult.length;

      // Get paginated results
      const environmentList = await db.query.environments.findMany({
        where: conditions.length > 0 ? and(...conditions) : undefined,
        orderBy: orderByClause.length > 0 ? orderByClause : [desc(environments.createdAt)],
        limit: limit ?? undefined,
        offset,
      });

      return environmentListResponseSchema.parse({
        items: environmentList,
        total,
        offset,
        limit,
      });
    } catch (error) {
      logger.error({ error, params }, 'Failed to list environments');
      throw error;
    }
  }

  /**
   * Updates an environment using optimistic locking to prevent concurrent modifications
   * @param id - The unique identifier of the environment to update
   * @param input - Environment update data (with version)
   * @param context - Request context for auditing and authorization
   * @returns The updated environment (without password)
   * @throws {NotFoundError} When environment is not found
   * @throws {OptimisticLockError} When the version doesn't match (concurrent modification detected)
   */
  async updateEnvironment(id: string, input: UpdateEnvironmentRequest, context: RequestContext): Promise<EnvironmentResponse> {
    this.requirePermission(context, PERMISSIONS.ENVIRONMENT_WRITE);
    const { version: expectedVersion, ...updateData } = input;
    logger.info({ environmentId: id, expectedVersion, operatorId: context?.operatorId }, 'Updating environment');

    try {
      const existingEnvironment = await db.query.environments.findFirst({ where: eq(environments.id, id) });

      if (!existingEnvironment) {
        throw new NotFoundError(`Environment with id ${id} not found`);
      }

      if (existingEnvironment.version !== expectedVersion) {
        throw new OptimisticLockError(`Environment version mismatch. Expected ${expectedVersion}, got ${existingEnvironment.version}`);
      }

      const updatePayload: any = { version: existingEnvironment.version + 1, updatedAt: new Date() };
      if (updateData.description !== undefined) updatePayload.description = updateData.description;
      if (updateData.url !== undefined) updatePayload.url = updateData.url;
      if (updateData.login !== undefined) updatePayload.login = updateData.login;
      if (updateData.password !== undefined) updatePayload.password = updateData.password;

      const updatedEnvironment = await db.update(environments).set(updatePayload).where(and(eq(environments.id, id), eq(environments.version, expectedVersion))).returning();

      if (updatedEnvironment.length === 0) {
        throw new OptimisticLockError(`Failed to update environment due to version conflict`);
      }

      const environment = updatedEnvironment[0];

      await this.auditService.logUpdate('environment', environment.id, { id: existingEnvironment.id, description: existingEnvironment.description, url: existingEnvironment.url, login: existingEnvironment.login }, { id: environment.id, description: environment.description, url: environment.url, login: environment.login }, context?.operatorId);

      logger.info({ environmentId: environment.id, newVersion: environment.version }, 'Environment updated successfully');

      return environmentResponseSchema.parse(environment);
    } catch (error) {
      logger.error({ error, environmentId: id }, 'Failed to update environment');
      throw error;
    }
  }

  /**
   * Deletes an environment using optimistic locking to prevent concurrent modifications
   * @param id - The unique identifier of the environment to delete
   * @param expectedVersion - The expected version number for optimistic locking
   * @param context - Request context for auditing and authorization
   * @throws {NotFoundError} When environment is not found
   * @throws {OptimisticLockError} When the version doesn't match (concurrent modification detected)
   */
  async deleteEnvironment(id: string, expectedVersion: number, context: RequestContext): Promise<void> {
    this.requirePermission(context, PERMISSIONS.ENVIRONMENT_DELETE);
    logger.info({ environmentId: id, expectedVersion, operatorId: context?.operatorId }, 'Deleting environment');

    try {
      const existingEnvironment = await db.query.environments.findFirst({ where: eq(environments.id, id) });

      if (!existingEnvironment) {
        throw new NotFoundError(`Environment with id ${id} not found`);
      }

      if (existingEnvironment.version !== expectedVersion) {
        throw new OptimisticLockError(`Environment version mismatch. Expected ${expectedVersion}, got ${existingEnvironment.version}`);
      }

      const deleted = await db.delete(environments).where(and(eq(environments.id, id), eq(environments.version, expectedVersion))).returning();

      if (deleted.length === 0) {
        throw new OptimisticLockError(`Failed to delete environment due to version conflict`);
      }

      await this.auditService.logDelete('environment', id, { id: existingEnvironment.id, description: existingEnvironment.description, url: existingEnvironment.url, login: existingEnvironment.login }, context?.operatorId);

      logger.info({ environmentId: id }, 'Environment deleted successfully');
    } catch (error) {
      logger.error({ error, environmentId: id }, 'Failed to delete environment');
      throw error;
    }
  }

  /**
   * Retrieves all audit log entries for a specific environment
   * @param environmentId - The unique identifier of the environment
   * @returns Array of audit log entries for the environment
   */
  async getEnvironmentAuditLogs(environmentId: string): Promise<any[]> {
    logger.debug({ environmentId }, 'Fetching audit logs for environment');

    try {
      return await this.auditService.getEntityAuditLogs('environment', environmentId);
    } catch (error) {
      logger.error({ error, environmentId }, 'Failed to fetch environment audit logs');
      throw error;
    }
  }
}
