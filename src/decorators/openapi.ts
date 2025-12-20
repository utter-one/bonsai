import 'reflect-metadata';
import type { z } from 'zod';
import type { RouteConfig } from '@asteasolutions/zod-to-openapi';

const OPENAPI_METADATA_KEY = Symbol('openapi:metadata');

export type OpenAPIMethodConfig = Partial<Omit<RouteConfig, 'method' | 'path'>>;

/**
 * Stores OpenAPI documentation metadata for a controller method
 */
export function setOpenAPIMetadata(target: any, propertyKey: string, config: OpenAPIMethodConfig): void {
  Reflect.defineMetadata(OPENAPI_METADATA_KEY, config, target, propertyKey);
}

/**
 * Gets OpenAPI documentation metadata from a controller method
 */
export function getOpenAPIMetadata(target: any, propertyKey: string): OpenAPIMethodConfig | undefined {
  return Reflect.getMetadata(OPENAPI_METADATA_KEY, target, propertyKey);
}

/**
 * OpenAPI documentation decorator for controller methods
 * 
 * @example
 * ```typescript
 * @OpenAPI({
 *   tags: ['Admins'],
 *   summary: 'Create a new admin user',
 *   description: 'Creates a new admin user with the specified credentials and roles',
 *   responses: {
 *     201: {
 *       description: 'Admin user created successfully',
 *       content: {
 *         'application/json': {
 *           schema: adminResponseSchema,
 *         },
 *       },
 *     },
 *     400: { description: 'Invalid request body' },
 *     409: { description: 'Admin user already exists' },
 *   },
 * })
 * @Post('/')
 * @HttpCode(201)
 * async createAdmin(@Body() body: CreateAdminRequest) { ... }
 * ```
 */
export function OpenAPI(config: OpenAPIMethodConfig) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    setOpenAPIMetadata(target, propertyKey, config);
    return descriptor;
  };
}

/**
 * Helper decorator for setting OpenAPI tags on a controller method
 */
export function ApiTags(...tags: string[]) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const existingConfig = getOpenAPIMetadata(target, propertyKey) || {};
    setOpenAPIMetadata(target, propertyKey, {
      ...existingConfig,
      tags,
    });
    return descriptor;
  };
}

/**
 * Helper decorator for setting OpenAPI summary on a controller method
 */
export function ApiSummary(summary: string) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const existingConfig = getOpenAPIMetadata(target, propertyKey) || {};
    setOpenAPIMetadata(target, propertyKey, {
      ...existingConfig,
      summary,
    });
    return descriptor;
  };
}

/**
 * Helper decorator for setting OpenAPI description on a controller method
 */
export function ApiDescription(description: string) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const existingConfig = getOpenAPIMetadata(target, propertyKey) || {};
    setOpenAPIMetadata(target, propertyKey, {
      ...existingConfig,
      description,
    });
    return descriptor;
  };
}

/**
 * Helper decorator for setting OpenAPI response on a controller method
 */
export function ApiResponse(statusCode: number, config: { description: string; content?: any }) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const existingConfig = getOpenAPIMetadata(target, propertyKey) || {};
    const responses = existingConfig.responses || {};
    setOpenAPIMetadata(target, propertyKey, {
      ...existingConfig,
      responses: {
        ...responses,
        [statusCode]: config,
      },
    });
    return descriptor;
  };
}
