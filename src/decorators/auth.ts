import 'reflect-metadata';

/** Metadata key for permission requirements */
const PERMISSIONS_KEY = 'route:permissions';

/** Metadata key for public routes */
const PUBLIC_ROUTE_KEY = 'route:public';

/**
 * Decorator to mark a route as public (no authentication required)
 */
export function PublicRoute(): MethodDecorator {
  return (target: any, propertyKey: string | symbol) => {
    Reflect.defineMetadata(PUBLIC_ROUTE_KEY, true, target, propertyKey);
  };
}

/**
 * Decorator to require specific permissions for a route
 * @param permissions - Array of required permissions
 */
export function RequirePermissions(permissions: string[]): MethodDecorator {
  return (target: any, propertyKey: string | symbol) => {
    Reflect.defineMetadata(PERMISSIONS_KEY, permissions, target, propertyKey);
  };
}

/**
 * Get required permissions for a route
 * @param target - Controller instance
 * @param propertyKey - Method name
 * @returns Array of required permissions or undefined
 */
export function getRequiredPermissions(target: any, propertyKey: string | symbol): string[] | undefined {
  return Reflect.getMetadata(PERMISSIONS_KEY, target, propertyKey);
}

/**
 * Check if a route is marked as public
 * @param target - Controller instance
 * @param propertyKey - Method name
 * @returns True if route is public
 */
export function isPublicRoute(target: any, propertyKey: string | symbol): boolean {
  return Reflect.getMetadata(PUBLIC_ROUTE_KEY, target, propertyKey) === true;
}
