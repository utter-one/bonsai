import { z } from 'zod';

/**
 * Global registry mapping type names to their Zod schemas
 * Schemas are registered using naming convention: TypeName -> schema
 */
class ValidationRegistry {
  private schemas = new Map<string, z.ZodType>();

  /**
   * Register a schema with a type name key
   * Convention: CreateOperatorRequest -> 'CreateOperatorRequest'
   */
  register(typeName: string, schema: z.ZodType): void {
    this.schemas.set(typeName, schema);
  }

  /**
   * Get schema by type name
   */
  get(typeName: string): z.ZodType | undefined {
    return this.schemas.get(typeName);
  }

  /**
   * Check if a schema is registered
   */
  has(typeName: string): boolean {
    return this.schemas.has(typeName);
  }
}

export const validationRegistry = new ValidationRegistry();

/**
 * Helper to register a schema with its associated type name
 * Use this in API files to register schemas for automatic validation
 */
export function registerSchema<T extends z.ZodType>(typeName: string, schema: T): T {
  validationRegistry.register(typeName, schema);
  return schema;
}
