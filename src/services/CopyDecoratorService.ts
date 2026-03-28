import { injectable, inject } from 'tsyringe';
import { eq, and, SQL, desc } from 'drizzle-orm';
import { buildTextSearchCondition } from '../utils/textSearch';
import { db } from '../db/index';
import { copyDecorators } from '../db/schema';
import type { CreateCopyDecoratorRequest, UpdateCopyDecoratorRequest, CopyDecoratorResponse, CopyDecoratorListResponse } from '../http/contracts/copyDecorator';
import type { ListParams } from '../http/contracts/common';
import { copyDecoratorResponseSchema, copyDecoratorListResponseSchema } from '../http/contracts/copyDecorator';
import { AuditService } from './AuditService';
import { OptimisticLockError, NotFoundError } from '../errors';
import { buildFilterCondition, buildOrderBy } from '../utils/queryBuilder';
import { countRows, normalizeListLimit } from '../utils/pagination';
import { logger } from '../utils/logger';
import { BaseService } from './BaseService';
import type { RequestContext } from './RequestContext';
import { PERMISSIONS } from '../permissions';
import { generateId, ID_PREFIXES } from '../utils/idGenerator';

/**
 * Service for managing copy decorators with full CRUD operations and audit logging.
 * Copy decorators are simple templates applied to selected sample copy content at runtime.
 */
@injectable()
export class CopyDecoratorService extends BaseService {
  constructor(@inject(AuditService) private readonly auditService: AuditService) {
    super();
  }

  /**
   * Creates a new copy decorator and logs the creation in the audit trail.
   * @param projectId - The project this copy decorator belongs to
   * @param input - Copy decorator creation data
   * @param context - Request context for auditing and authorization
   * @returns The created copy decorator
   */
  async createCopyDecorator(projectId: string, input: CreateCopyDecoratorRequest, context: RequestContext): Promise<CopyDecoratorResponse> {
    this.requirePermission(context, PERMISSIONS.COPY_DECORATOR_WRITE);
    await this.requireProjectNotArchived(projectId);
    const copyDecoratorId = input.id ?? generateId(ID_PREFIXES.COPY_DECORATOR);
    logger.info({ copyDecoratorId, projectId, name: input.name, operatorId: context?.operatorId }, 'Creating copy decorator');

    try {
      const result = await db.insert(copyDecorators).values({ id: copyDecoratorId, projectId, name: input.name, template: input.template, version: 1 }).returning();

      const created = result[0];

      await this.auditService.logCreate('copy_decorator', created.id, created, context?.operatorId);

      logger.info({ copyDecoratorId: created.id }, 'Copy decorator created successfully');

      return copyDecoratorResponseSchema.parse(created);
    } catch (error) {
      logger.error({ error, copyDecoratorId: input.id }, 'Failed to create copy decorator');
      throw error;
    }
  }

  /**
   * Retrieves a copy decorator by its unique identifier.
   * @param projectId - The project this copy decorator belongs to
   * @param id - The unique identifier of the copy decorator
   * @returns The copy decorator if found
   * @throws {NotFoundError} When copy decorator is not found
   */
  async getCopyDecoratorById(projectId: string, id: string): Promise<CopyDecoratorResponse> {
    logger.debug({ copyDecoratorId: id, projectId }, 'Fetching copy decorator by ID');

    try {
      const copyDecorator = await db.query.copyDecorators.findFirst({ where: and(eq(copyDecorators.projectId, projectId), eq(copyDecorators.id, id)) });

      if (!copyDecorator) {
        throw new NotFoundError(`Copy decorator with id ${id} not found`);
      }

      const archived = !(await this.isProjectActive(projectId));
      return copyDecoratorResponseSchema.parse({ ...copyDecorator, archived });
    } catch (error) {
      logger.error({ error, copyDecoratorId: id }, 'Failed to fetch copy decorator');
      throw error;
    }
  }

  /**
   * Lists copy decorators with flexible filtering, sorting, and pagination.
   * @param projectId - The project to list copy decorators for
   * @param params - List parameters including filters, sorting, and pagination
   * @returns Paginated array of copy decorators matching the criteria
   */
  async listCopyDecorators(projectId: string, params?: ListParams): Promise<CopyDecoratorListResponse> {
    logger.debug({ projectId, params }, 'Listing copy decorators');

    try {
      const conditions: SQL[] = [eq(copyDecorators.projectId, projectId)];
      const offset = params?.offset ?? 0;
      const limit = normalizeListLimit(params?.limit);

      const columnMap = {
        id: copyDecorators.id,
        projectId: copyDecorators.projectId,
        name: copyDecorators.name,
        version: copyDecorators.version,
        createdAt: copyDecorators.createdAt,
        updatedAt: copyDecorators.updatedAt,
      };

      if (params?.filters) {
        for (const [field, filter] of Object.entries(params.filters)) {
          const condition = buildFilterCondition(field, filter, columnMap, logger);
          if (condition) {
            conditions.push(condition);
          }
        }
      }

      if (params?.textSearch) {
        const searchCondition = buildTextSearchCondition(params.textSearch, [copyDecorators.name, copyDecorators.template], undefined);
        if (searchCondition) conditions.push(searchCondition);
      }

      const orderByClause = buildOrderBy(params?.orderBy, columnMap);
      const whereCondition = conditions.length > 0 ? and(...conditions) : undefined;

      const total = await countRows(copyDecorators, whereCondition);

      const list = await db.query.copyDecorators.findMany({
        where: whereCondition,
        orderBy: orderByClause.length > 0 ? orderByClause : [desc(copyDecorators.createdAt)],
        limit,
        offset,
      });

      const archived = !(await this.isProjectActive(projectId));
      return copyDecoratorListResponseSchema.parse({
        items: list.map(d => ({ ...d, archived })),
        total,
        offset,
        limit,
      });
    } catch (error) {
      logger.error({ error, projectId, params }, 'Failed to list copy decorators');
      throw error;
    }
  }

  /**
   * Updates a copy decorator using optimistic locking to prevent concurrent modifications.
   * @param projectId - The project this copy decorator belongs to
   * @param id - The unique identifier of the copy decorator to update
   * @param input - Copy decorator update data (with version)
   * @param context - Request context for auditing and authorization
   * @returns The updated copy decorator
   * @throws {NotFoundError} When copy decorator is not found
   * @throws {OptimisticLockError} When the version doesn't match (concurrent modification detected)
   */
  async updateCopyDecorator(projectId: string, id: string, input: UpdateCopyDecoratorRequest, context: RequestContext): Promise<CopyDecoratorResponse> {
    this.requirePermission(context, PERMISSIONS.COPY_DECORATOR_WRITE);
    await this.requireProjectNotArchived(projectId);
    const { version: expectedVersion, ...updateData } = input;
    logger.info({ copyDecoratorId: id, expectedVersion, operatorId: context?.operatorId }, 'Updating copy decorator');

    try {
      const existing = await db.query.copyDecorators.findFirst({ where: and(eq(copyDecorators.projectId, projectId), eq(copyDecorators.id, id)) });

      if (!existing) {
        throw new NotFoundError(`Copy decorator with id ${id} not found`);
      }

      if (existing.version !== expectedVersion) {
        throw new OptimisticLockError(`Copy decorator version mismatch. Expected ${expectedVersion}, got ${existing.version}`);
      }

      const updatePayload: any = { version: existing.version + 1, updatedAt: new Date() };
      if (updateData.name !== undefined) updatePayload.name = updateData.name;
      if (updateData.template !== undefined) updatePayload.template = updateData.template;

      const updated = await db.update(copyDecorators).set(updatePayload).where(and(eq(copyDecorators.projectId, projectId), eq(copyDecorators.id, id), eq(copyDecorators.version, expectedVersion))).returning();

      if (updated.length === 0) {
        throw new OptimisticLockError(`Failed to update copy decorator due to version conflict`);
      }

      const copyDecorator = updated[0];

      await this.auditService.logUpdate('copy_decorator', copyDecorator.id, existing, copyDecorator, context?.operatorId, projectId);

      logger.info({ copyDecoratorId: copyDecorator.id, newVersion: copyDecorator.version }, 'Copy decorator updated successfully');

      return copyDecoratorResponseSchema.parse(copyDecorator);
    } catch (error) {
      logger.error({ error, copyDecoratorId: id }, 'Failed to update copy decorator');
      throw error;
    }
  }

  /**
   * Deletes a copy decorator using optimistic locking to prevent concurrent modifications.
   * @param projectId - The project this copy decorator belongs to
   * @param id - The unique identifier of the copy decorator to delete
   * @param expectedVersion - The expected version number for optimistic locking
   * @param context - Request context for auditing and authorization
   * @throws {NotFoundError} When copy decorator is not found
   * @throws {OptimisticLockError} When the version doesn't match (concurrent modification detected)
   */
  async deleteCopyDecorator(projectId: string, id: string, expectedVersion: number, context: RequestContext): Promise<void> {
    this.requirePermission(context, PERMISSIONS.COPY_DECORATOR_DELETE);
    await this.requireProjectNotArchived(projectId);
    logger.info({ copyDecoratorId: id, expectedVersion, operatorId: context?.operatorId }, 'Deleting copy decorator');

    try {
      const existing = await db.query.copyDecorators.findFirst({ where: and(eq(copyDecorators.projectId, projectId), eq(copyDecorators.id, id)) });

      if (!existing) {
        throw new NotFoundError(`Copy decorator with id ${id} not found`);
      }

      if (existing.version !== expectedVersion) {
        throw new OptimisticLockError(`Copy decorator version mismatch. Expected ${expectedVersion}, got ${existing.version}`);
      }

      const deleted = await db.delete(copyDecorators).where(and(eq(copyDecorators.projectId, projectId), eq(copyDecorators.id, id), eq(copyDecorators.version, expectedVersion))).returning();

      if (deleted.length === 0) {
        throw new OptimisticLockError(`Failed to delete copy decorator due to version conflict`);
      }

      await this.auditService.logDelete('copy_decorator', id, existing, context?.operatorId, projectId);

      logger.info({ copyDecoratorId: id }, 'Copy decorator deleted successfully');
    } catch (error) {
      logger.error({ error, copyDecoratorId: id }, 'Failed to delete copy decorator');
      throw error;
    }
  }

  /**
   * Retrieves all audit log entries for a specific copy decorator.
   * @param copyDecoratorId - The unique identifier of the copy decorator
   * @param projectId - The project ID the copy decorator belongs to
   * @returns Array of audit log entries for the copy decorator
   */
  async getCopyDecoratorAuditLogs(copyDecoratorId: string, projectId: string): Promise<any[]> {
    logger.debug({ copyDecoratorId, projectId }, 'Fetching audit logs for copy decorator');

    try {
      return await this.auditService.getEntityAuditLogs('copy_decorator', copyDecoratorId, projectId);
    } catch (error) {
      logger.error({ error, copyDecoratorId, projectId }, 'Failed to fetch copy decorator audit logs');
      throw error;
    }
  }
}
