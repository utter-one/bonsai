import { injectable } from 'tsyringe';
import { and, SQL, desc } from 'drizzle-orm';
import { buildTextSearchCondition } from '../utils/textSearch';
import { db } from '../db/index';
import { auditLogs } from '../db/schema';
import type { AuditLog } from '../types/models';
import { logger } from '../utils/logger';
import { buildFilterCondition, buildOrderBy } from '../utils/queryBuilder';
import { countRows, normalizeListLimit } from '../utils/pagination';
import type { ListParams } from '../http/contracts/common';
import { generateId, ID_PREFIXES } from '../utils/idGenerator';

export interface AuditLogInput {
  userId?: string;
  action: string;
  entityId: string;
  entityType: string;
  projectId?: string;
  oldEntity?: Record<string, any>;
  newEntity?: Record<string, any>;
}

/**
 * Service for managing audit logs of all entity changes in the system
 */
@injectable()
export class AuditService {
  /**
   * Log a change to an entity in the audit log
   * @param input - Audit log input containing userId, action, entityId, entityType, and entity snapshots
   * @returns The created audit log entry
   */
  async logChange(input: AuditLogInput): Promise<AuditLog> {
    logger.info({ action: input.action, entityType: input.entityType, entityId: input.entityId, userId: input.userId, }, 'Logging audit change');

    try {
      const auditLog = await db
        .insert(auditLogs)
        .values({
          id: generateId(ID_PREFIXES.AUDIT),
          userId: input.userId,
          action: input.action,
          entityId: input.entityId,
          entityType: input.entityType,
          projectId: input.projectId,
          oldEntity: input.oldEntity,
          newEntity: input.newEntity,
        })
        .returning();

      logger.debug(
        { auditLogId: auditLog[0].id },
        'Audit log created successfully'
      );

      return auditLog[0];
    } catch (error) {
      logger.error(
        {
          error,
          action: input.action,
          entityType: input.entityType,
          entityId: input.entityId,
        },
        'Failed to create audit log'
      );
      throw error;
    }
  }

  /**
   * Log entity creation
   * @param entityType - The type of entity being created (e.g., 'operator')
   * @param entityId - The unique identifier of the created entity
   * @param newEntity - The newly created entity data
   * @param userId - Optional ID of the user who created the entity
   * @param projectId - Optional project ID the entity belongs to (preferred over projectId extracted from entity snapshot)
   * @returns The created audit log entry
   */
  async logCreate<T extends object>(
    entityType: string,
    entityId: string,
    newEntity: T,
    userId?: string,
    projectId?: string
  ): Promise<AuditLog> {
    const entity = newEntity as Record<string, any>;
    return this.logChange({
      userId,
      action: 'CREATE',
      entityType,
      entityId,
      newEntity: entity,
      projectId: projectId ?? entity?.projectId,
    });
  }

  /**
   * Log entity update
   * @param entityType - The type of entity being updated (e.g., 'operator')
   * @param entityId - The unique identifier of the updated entity
   * @param oldEntity - The entity data before the update
   * @param newEntity - The entity data after the update
   * @param userId - Optional ID of the user who updated the entity
   * @param projectId - Optional project ID the entity belongs to (preferred over projectId extracted from entity snapshots)
   * @returns The created audit log entry
   */
  async logUpdate<T extends object>(
    entityType: string,
    entityId: string,
    oldEntity: T,
    newEntity: T,
    userId?: string,
    projectId?: string
  ): Promise<AuditLog> {
    const oldRec = oldEntity as Record<string, any>;
    const newRec = newEntity as Record<string, any>;
    return this.logChange({
      userId,
      action: 'UPDATE',
      entityType,
      entityId,
      oldEntity: oldRec,
      newEntity: newRec,
      projectId: projectId ?? newRec?.projectId ?? oldRec?.projectId,
    });
  }

  /**
   * Log entity deletion
   * @param entityType - The type of entity being deleted (e.g., 'operator')
   * @param entityId - The unique identifier of the deleted entity
   * @param oldEntity - The entity data before deletion
   * @param userId - Optional ID of the user who deleted the entity
   * @param projectId - Optional project ID the entity belongs to (preferred over projectId extracted from entity snapshot)
   * @returns The created audit log entry
   */
  async logDelete<T extends object>(
    entityType: string,
    entityId: string,
    oldEntity: T,
    userId?: string,
    projectId?: string
  ): Promise<AuditLog> {
    const oldRec = oldEntity as Record<string, any>;
    return this.logChange({
      userId,
      action: 'DELETE',
      entityType,
      entityId,
      oldEntity: oldRec,
      projectId: projectId ?? oldRec?.projectId,
    });
  }

  /**
   * Query audit logs for a specific entity
   * @param entityType - The type of entity to retrieve logs for (e.g., 'operator')
   * @param entityId - The unique identifier of the entity
   * @returns Array of audit logs for the specified entity, ordered by creation date descending
   */
  async getEntityAuditLogs(
    entityType: string,
    entityId: string
  ): Promise<AuditLog[]> {
    logger.debug(
      { entityType, entityId },
      'Fetching audit logs for entity'
    );

    try {
      const logs = await db.query.auditLogs.findMany({
        where: (auditLogs, { eq, and }) =>
          and(
            eq(auditLogs.entityType, entityType),
            eq(auditLogs.entityId, entityId)
          ),
        orderBy: (auditLogs, { desc }) => [desc(auditLogs.createdAt)],
      });

      return logs;
    } catch (error) {
      logger.error(
        { error, entityType, entityId },
        'Failed to fetch audit logs'
      );
      throw error;
    }
  }

  /**
   * Query audit logs by user
   * @param userId - The unique identifier of the user
   * @param limit - Maximum number of logs to retrieve (default: 100)
   * @returns Array of audit logs for the specified user, ordered by creation date descending
   */
  async getUserAuditLogs(userId: string, limit = 100): Promise<AuditLog[]> {
    logger.debug({ userId, limit }, 'Fetching audit logs for user');

    try {
      const logs = await db.query.auditLogs.findMany({
        where: (auditLogs, { eq }) => eq(auditLogs.userId, userId),
        orderBy: (auditLogs, { desc }) => [desc(auditLogs.createdAt)],
        limit,
      });

      return logs;
    } catch (error) {
      logger.error({ error, userId }, 'Failed to fetch user audit logs');
      throw error;
    }
  }

  /**
   * Lists all audit logs with flexible filtering, sorting, and pagination
   * @param params - List parameters including filters, sorting, pagination, and text search
   * @returns Paginated array of audit logs matching the criteria
   */
  async listAuditLogs(params?: ListParams): Promise<{ items: AuditLog[]; total: number; offset: number; limit: number | null }> {
    logger.debug({ params }, 'Listing audit logs');

    try {
      const conditions: SQL[] = [];
      const offset = params?.offset ?? 0;
      const limit = normalizeListLimit(params?.limit);

      // Column map for filter and order by operations
      const columnMap = {
        id: auditLogs.id,
        userId: auditLogs.userId,
        action: auditLogs.action,
        entityId: auditLogs.entityId,
        entityType: auditLogs.entityType,
        projectId: auditLogs.projectId,
        createdAt: auditLogs.createdAt,
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

      // Apply text search (searches action, entityType, entityId, userId by ilike)
      if (params?.textSearch) {
        const searchCondition = buildTextSearchCondition(params.textSearch, [auditLogs.action, auditLogs.entityType, auditLogs.entityId, auditLogs.userId]);
        if (searchCondition) conditions.push(searchCondition);
      }

      // Build order by clause
      const orderByClause = buildOrderBy(params?.orderBy, columnMap);
      const whereCondition = conditions.length > 0 ? and(...conditions) : undefined;

      const total = await countRows(auditLogs, whereCondition);

      // Get paginated results
      const logsList = await db.query.auditLogs.findMany({
        where: whereCondition,
        orderBy: orderByClause.length > 0 ? orderByClause : [desc(auditLogs.createdAt)],
        limit,
        offset,
      });

      return {
        items: logsList,
        total,
        offset,
        limit,
      };
    } catch (error) {
      logger.error({ error, params }, 'Failed to list audit logs');
      throw error;
    }
  }
}
