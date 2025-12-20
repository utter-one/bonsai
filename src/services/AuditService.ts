import { injectable } from 'tsyringe';
import { db } from '../db/index';
import { auditLogs } from '../db/schema';
import type { AuditLog } from '../types/models';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger';

export interface AuditLogInput {
  userId?: string;
  action: string;
  entityId: string;
  entityType: string;
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
    logger.info({ action: input.action, entityType: input.entityType, entityId: input.entityId, userId: input.userId, }, 'Logging audit change' );

    try {
      const auditLog = await db
        .insert(auditLogs)
        .values({
          id: uuidv4(),
          userId: input.userId,
          action: input.action,
          entityId: input.entityId,
          entityType: input.entityType,
          oldEntity: input.oldEntity,
          newEntity: input.newEntity,
          version: 1,
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
   * @param entityType - The type of entity being created (e.g., 'admin')
   * @param entityId - The unique identifier of the created entity
   * @param newEntity - The newly created entity data
   * @param userId - Optional ID of the user who created the entity
   * @returns The created audit log entry
   */
  async logCreate(
    entityType: string,
    entityId: string,
    newEntity: Record<string, any>,
    userId?: string
  ): Promise<AuditLog> {
    return this.logChange({
      userId,
      action: 'CREATE',
      entityType,
      entityId,
      newEntity,
    });
  }

  /**
   * Log entity update
   * @param entityType - The type of entity being updated (e.g., 'admin')
   * @param entityId - The unique identifier of the updated entity
   * @param oldEntity - The entity data before the update
   * @param newEntity - The entity data after the update
   * @param userId - Optional ID of the user who updated the entity
   * @returns The created audit log entry
   */
  async logUpdate(
    entityType: string,
    entityId: string,
    oldEntity: Record<string, any>,
    newEntity: Record<string, any>,
    userId?: string
  ): Promise<AuditLog> {
    return this.logChange({
      userId,
      action: 'UPDATE',
      entityType,
      entityId,
      oldEntity,
      newEntity,
    });
  }

  /**
   * Log entity deletion
   * @param entityType - The type of entity being deleted (e.g., 'admin')
   * @param entityId - The unique identifier of the deleted entity
   * @param oldEntity - The entity data before deletion
   * @param userId - Optional ID of the user who deleted the entity
   * @returns The created audit log entry
   */
  async logDelete(
    entityType: string,
    entityId: string,
    oldEntity: Record<string, any>,
    userId?: string
  ): Promise<AuditLog> {
    return this.logChange({
      userId,
      action: 'DELETE',
      entityType,
      entityId,
      oldEntity,
    });
  }

  /**
   * Query audit logs for a specific entity
   * @param entityType - The type of entity to retrieve logs for (e.g., 'admin')
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
}
