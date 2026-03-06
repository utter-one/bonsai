import { eq } from 'drizzle-orm';
import { db } from '../db/index';
import { activeProjects, archivedProjects } from '../db/schema';
import type { RequestContext } from './RequestContext';
import type { Permission } from '../permissions';
import { hasAllPermissions } from '../permissions';
import { ForbiddenError, ArchivedProjectError } from '../errors';
import { logger } from '../utils/logger';

/**
 * Base service class that provides common functionality for all services
 * Includes permission checking and context-aware logging
 */
export abstract class BaseService {
  /**
   * Check if the request context has a specific permission
   * @param context - Request context with user roles
   * @param permission - Permission to check
   * @returns True if the user has the permission
   */
  protected hasPermission(context: RequestContext | undefined, permission: Permission): boolean {
    if (!context) return false;
    return hasAllPermissions(context.roles, [permission]);
  }

  /**
   * Require specific permissions for an operation
   * @param context - Request context with user roles
   * @param permissions - Required permissions
   * @throws {ForbiddenError} When user lacks required permissions
   */
  protected requirePermission(context: RequestContext | undefined, ...permissions: Permission[]): void {
    if (!context) {
      throw new ForbiddenError('Authentication required');
    }

    const hasRequired = hasAllPermissions(context.roles, permissions);
    if (!hasRequired) {
      logger.warn({ operatorId: context.operatorId, roles: context.roles, requiredPermissions: permissions }, 'Permission denied');
      throw new ForbiddenError(`Missing required permissions: ${permissions.join(', ')}`);
    }
  }

  /**
   * Log an operation with context information
   * @param context - Request context
   * @param operation - Operation name
   * @param details - Additional details to log
   */
  protected logOperation(context: RequestContext | undefined, operation: string, details: Record<string, any> = {}): void {
    logger.info({ operatorId: context?.operatorId, ip: context?.ip, requestId: context?.requestId, operation, ...details }, `Operation: ${operation}`);
  }

  /**
   * Throw an error if the given project is archived
   * @param projectId - The project identifier to check
   * @throws {ArchivedProjectError} When the project is archived
   */
  protected async requireProjectNotArchived(projectId: string): Promise<void> {
    const result = await db.select({ id: archivedProjects.id }).from(archivedProjects).where(eq(archivedProjects.id, projectId)).limit(1);
    logger.info({ projectId, isArchived: JSON.stringify(result) }, 'Checked if project is archived');
    if (result.length > 0) {
      throw new ArchivedProjectError(`Project ${projectId} is archived and cannot be modified`);
    }
  }

  /**
   * Check whether the given project is active (not archived)
   * @param projectId - The project identifier to check
   * @returns True if the project exists and is not archived
   */
  protected async isProjectActive(projectId: string): Promise<boolean> {
    const result = await db.select({ id: activeProjects.id }).from(activeProjects).where(eq(activeProjects.id, projectId)).limit(1);
    return result.length > 0;
  }
}
