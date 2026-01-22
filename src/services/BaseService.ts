import type { RequestContext } from './RequestContext';
import type { Permission } from '../permissions';
import { hasAllPermissions } from '../permissions';
import { ForbiddenError } from '../errors';
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
      logger.warn({ adminId: context.adminId, roles: context.roles, requiredPermissions: permissions }, 'Permission denied');
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
    logger.info({ adminId: context?.adminId, ip: context?.ip, requestId: context?.requestId, operation, ...details }, `Operation: ${operation}`);
  }
}
