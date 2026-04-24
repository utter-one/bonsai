import { inject, singleton } from 'tsyringe';
import { SecretsManagerRegistry } from './SecretsManagerRegistry';

/**
 * Sensitive field names that may appear in provider config objects.
 * Values for these keys will be replaced with `@sec:name:id` references on write.
 */
export const SENSITIVE_PROVIDER_CONFIG_FIELDS = new Set([
  'apiKey',
  'subscriptionKey',
  'accountKey',
  'secretAccessKey',
  'authToken',
  'accessToken',
  'appSecret',
  'verifyToken',
  'keyFileJson',
  'accountSid',
]);

/**
 * Utility service for secretizing and resolving secret references within plain objects.
 * Operates on arbitrary JSON-serializable objects, replacing sensitive string values
 * with `@sec:name:id` references and vice-versa.
 */
@singleton()
export class SecretRefUtils {
  constructor(@inject(SecretsManagerRegistry) private readonly registry: SecretsManagerRegistry) {}

  /**
   * Traverses a plain object and replaces string values at the given sensitive keys
   * with `@sec:name:id` references. Already-referenced values are skipped.
   * @param obj - The source object (not mutated)
   * @param sensitiveFields - Set of top-level key names to secretize
   * @returns A new object with secret references in place of plaintext values
   */
  async secretizeObject<T extends Record<string, unknown>>(obj: T, sensitiveFields: Set<string>): Promise<T> {
    const result: Record<string, unknown> = { ...obj };
    const managerName = this.registry.defaultManagerName;
    for (const key of sensitiveFields) {
      const value = result[key];
      if (typeof value === 'string' && value.length > 0 && !this.registry.isSecretReference(value)) {
        result[key] = await this.registry.storeSecret(managerName, value);
      }
    }
    return result as T;
  }

  /**
   * Traverses a plain object (any depth) and replaces all `@sec:name:id` string values
   * with their resolved plaintext counterparts.
   * @param obj - The source object (not mutated)
   * @returns A new object with secret references resolved to plaintext values
   */
  async resolveObject<T extends Record<string, unknown>>(obj: T): Promise<T> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (this.registry.isSecretReference(value)) {
        result[key] = await this.registry.resolveSecret(value);
      } else if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        result[key] = await this.resolveObject(value as Record<string, unknown>);
      } else {
        result[key] = value;
      }
    }
    return result as T;
  }

  /**
   * Collects all `@sec:name:id` reference strings found anywhere in a plain object (any depth).
   * @param obj - The object to scan
   * @returns Array of unique reference strings found
   */
  collectReferences(obj: unknown): string[] {
    const refs = new Set<string>();
    this.collectRefsRecursive(obj, refs);
    return Array.from(refs);
  }

  private collectRefsRecursive(value: unknown, refs: Set<string>): void {
    if (this.registry.isSecretReference(value)) {
      refs.add(value);
    } else if (Array.isArray(value)) {
      for (const item of value) this.collectRefsRecursive(item, refs);
    } else if (value !== null && typeof value === 'object') {
      for (const v of Object.values(value as Record<string, unknown>)) this.collectRefsRecursive(v, refs);
    }
  }
}
