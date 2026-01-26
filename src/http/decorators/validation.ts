import 'reflect-metadata';
import type { z } from 'zod';

const VALIDATION_SCHEMA_KEY = Symbol('validation:schema');
const VALIDATION_SOURCE_KEY = Symbol('validation:source');

type ValidationSource = 'body' | 'query' | 'params';

/**
 * Stores validation metadata for a parameter
 */
function setValidationMetadata(target: any, propertyKey: string, parameterIndex: number, schema: z.ZodType, source: ValidationSource): void {
  const existingSchemas = Reflect.getMetadata(VALIDATION_SCHEMA_KEY, target, propertyKey) || {};
  const existingSources = Reflect.getMetadata(VALIDATION_SOURCE_KEY, target, propertyKey) || {};
  existingSchemas[parameterIndex] = schema;
  existingSources[parameterIndex] = source;
  Reflect.defineMetadata(VALIDATION_SCHEMA_KEY, existingSchemas, target, propertyKey);
  Reflect.defineMetadata(VALIDATION_SOURCE_KEY, existingSources, target, propertyKey);
}

/**
 * Gets validation metadata for a method
 */
export function getValidationMetadata(target: any, propertyKey: string): { schemas: Record<number, z.ZodType>; sources: Record<number, ValidationSource> } {
  const schemas = Reflect.getMetadata(VALIDATION_SCHEMA_KEY, target, propertyKey) || {};
  const sources = Reflect.getMetadata(VALIDATION_SOURCE_KEY, target, propertyKey) || {};
  return { schemas, sources };
}

/**
 * Marks a parameter for automatic validation using a Zod schema
 * Usage:
 * - @Validated(createAdminSchema) @Body() body: CreateAdminRequest
 * - @Validated(listParamsSchema, 'query') @Req() req: Request (then access req.query as unknown as ListParams)
 * - @Validated(routeParamsSchema, 'params') @Params() params: RouteParams
 * 
 * Note: For query parameters, use @Req() instead of @QueryParams() because @QueryParams()
 * is incompatible with Zod-inferred types. The middleware validates req.query automatically.
 * Use double cast (as unknown as Type) to bypass Express's ParsedQs type.
 */
export function Validated(schema: z.ZodType, source: ValidationSource = 'body') {
  return function (target: any, propertyKey: string, parameterIndex: number) {
    setValidationMetadata(target, propertyKey, parameterIndex, schema, source);
  };
}
