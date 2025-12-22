import type { Action, InterceptorInterface } from 'routing-controllers';
import { Interceptor } from 'routing-controllers';
import type { Request } from 'express';
import { getRequiredPermissions, isPublicRoute } from '../decorators/auth';
import { hasAllPermissions } from '../permissions';
import type { Permission } from '../permissions';
import { UnauthorizedError, ForbiddenError } from '../errors';
import { logger } from '../utils/logger';

/**
 * Interceptor that checks @RequirePermissions decorator before executing controller actions
 */
@Interceptor()
export class PermissionInterceptor implements InterceptorInterface {
  intercept(action: Action, content: any): any {
    const req = action.request as Request;
    const target = action.context.target;
    const method = action.context.method;

    // Check if route is marked as public
    const targetPrototype = target.constructor.prototype;
    if (isPublicRoute(targetPrototype, method)) {
      return content;
    }

    // Check if user is authenticated
    if (!req.user) {
      logger.warn({ url: req.url, method: req.method }, 'Unauthenticated access attempt to protected route');
      throw new UnauthorizedError('Authentication required');
    }

    // Get required permissions for this route
    const requiredPermissions = getRequiredPermissions(targetPrototype, method);
    
    // If no permissions specified, allow any authenticated user
    if (!requiredPermissions || requiredPermissions.length === 0) {
      return content;
    }

    // Check if user has required permissions
    const userRoles = req.user.roles;
    const hasRequired = hasAllPermissions(userRoles, requiredPermissions as Permission[]);

    if (!hasRequired) {
      logger.warn({ adminId: req.user.adminId, roles: userRoles, requiredPermissions, method: req.method, url: req.url }, 'Permission denied');
      throw new ForbiddenError(`Missing required permissions: ${requiredPermissions.join(', ')}`);
    }

    return content;
  }
}

