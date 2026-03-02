import type { Request } from 'express';
import { hasAllPermissions } from '../permissions';
import type { Permission } from '../permissions';
import { UnauthorizedError, ForbiddenError } from '../errors';
import logger from './logger';

/**
 * Check if the user has the required permissions
 * @throws UnauthorizedError if user is not authenticated
 * @throws ForbiddenError if user lacks required permissions
 */
export function checkPermissions(req: Request, requiredPermissions: Permission[]): void {
  if (!req.user) {
    logger.warn({ url: req.url, method: req.method }, 'Unauthenticated access attempt to protected route');
    throw new UnauthorizedError('Authentication required');
  }

  const userRoles = req.user.roles;
  const hasRequired = hasAllPermissions(userRoles, requiredPermissions);

  if (!hasRequired) {
    logger.warn({ operatorId: req.user.operatorId, roles: userRoles, requiredPermissions, method: req.method, url: req.url }, 'Permission denied');
    throw new ForbiddenError(`Missing required permissions: ${requiredPermissions.join(', ')}`);
  }
}
