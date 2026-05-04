import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';

describe('validationRegistry', () => {
  let registry: typeof import('../../src/utils/validationRegistry').validationRegistry;
  let registerSchema: typeof import('../../src/utils/validationRegistry').registerSchema;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('../../src/utils/validationRegistry');
    registry = mod.validationRegistry;
    registerSchema = mod.registerSchema;
  });

  describe('register', () => {
    it('registers a schema with a type name', () => {
      const schema = z.string();
      registry.register('TestSchema', schema);
      expect(registry.has('TestSchema')).toBe(true);
    });

    it('overwrites an existing registration', () => {
      const stringSchema = z.string();
      const numberSchema = z.number();
      registry.register('TestSchema', stringSchema);
      registry.register('TestSchema', numberSchema);
      expect(registry.get('TestSchema')).toBe(numberSchema);
    });
  });

  describe('get', () => {
    it('returns the registered schema', () => {
      const schema = z.object({ name: z.string() });
      registry.register('UserSchema', schema);
      expect(registry.get('UserSchema')).toBe(schema);
    });

    it('returns undefined for unregistered type', () => {
      expect(registry.get('NonExistent')).toBeUndefined();
    });
  });

  describe('has', () => {
    it('returns true for registered type', () => {
      registry.register('TestType', z.string());
      expect(registry.has('TestType')).toBe(true);
    });

    it('returns false for unregistered type', () => {
      expect(registry.has('NonExistent')).toBe(false);
    });
  });

  describe('registerSchema helper', () => {
    it('registers and returns the schema', () => {
      const schema = z.object({ id: z.string() });
      const result = registerSchema('MySchema', schema);
      expect(result).toBe(schema);
      expect(registry.has('MySchema')).toBe(true);
      expect(registry.get('MySchema')).toBe(schema);
    });

    it('works with complex schemas', () => {
      const schema = z.object({
        name: z.string(),
        age: z.number().min(0),
        nested: z.object({ active: z.boolean() }),
      });
      const result = registerSchema('ComplexSchema', schema);
      expect(result).toBe(schema);

      const retrieved = registry.get('ComplexSchema');
      expect(retrieved).toBe(schema);
    });
  });
});
