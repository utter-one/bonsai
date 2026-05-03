import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import type { RequestContext } from '../../src/services/RequestContext';
import type { Permission } from '../../src/permissions';
import { ForbiddenError, NotFoundError, OptimisticLockError } from '../../src/errors';

/**
 * Configuration for parameterized CRUD service tests.
 */
export interface CrudTestConfig<EntityName extends string = string> {
  /** Singular entity name (e.g., 'classifier', 'guardrail') */
  entityName: EntityName;

  /** Permission constants for write/delete */
  permissions: {
    write: Permission;
    delete: Permission;
  };

  /** Whether the entity uses optimistic locking with a version column */
  hasVersion: boolean;

  /** Whether the entity supports cloning */
  hasClone: boolean;

  /** Factory that returns the service instance */
  createService: () => {
    service: any;
    methods?: Partial<CrudMethodNames>;
  };

  /** Creates a minimal valid create request payload */
  createPayload: () => Record<string, any>;

  /** Creates a mock entity row with given id */
  createEntityRow: (id: string, overrides?: Record<string, any>) => Record<string, any>;

  /** The project ID used in all tests */
  projectId?: string;

  /** Set findFirst to return undefined (entity not found) */
  mockNotFound?: () => void;

  /** Set findFirst to return entity with wrong version for optimistic lock test */
  mockVersionMismatch?: () => void;

  /** Reset mocks to default state (entity exists, project active) */
  resetMocks?: () => void;
}

/** Standard CRUD method name mapping */
export interface CrudMethodNames {
  create: string;
  getById: string;
  list: string;
  update: string;
  delete: string;
  clone: string;
  auditLogs: string;
}

const defaultMethodNames = (entity: string): CrudMethodNames => ({
  create: `create${capitalize(entity)}`,
  getById: `get${capitalize(entity)}ById`,
  list: `list${capitalize(pluralize(entity))}`,
  update: `update${capitalize(entity)}`,
  delete: `delete${capitalize(entity)}`,
  clone: `clone${capitalize(entity)}`,
  auditLogs: `get${capitalize(entity)}AuditLogs`,
});

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function pluralize(s: string): string {
  return s.endsWith('s') ? s + 'es' : s + 's';
}

const defaultContext: RequestContext = {
  operatorId: 'op_test123',
  roles: ['super_admin'],
  ip: '127.0.0.1',
  userAgent: 'TestAgent/1.0',
  requestId: 'req-123',
  timestamp: new Date('2025-01-01T00:00:00Z'),
};

const deniedContext: RequestContext = {
  ...defaultContext,
  roles: ['viewer'],
};

/**
 * Creates a suite of parameterized CRUD tests for a service.
 */
export function createCrudTests<EntityName extends string>(config: CrudTestConfig<EntityName>) {
  const pid = config.projectId ?? 'proj-test123';

  describe(`${capitalize(config.entityName)} CRUD operations`, () => {
    let service: any;
    let methods: CrudMethodNames;

    beforeEach(() => {
      vi.clearAllMocks();
      config.resetMocks?.call(config);
      const result = config.createService();
      service = result.service;
      methods = result.methods ? { ...defaultMethodNames(config.entityName), ...result.methods } : defaultMethodNames(config.entityName);
    });

    // --- CREATE ---
    describe('create', () => {
      it('creates the entity and returns it with version 1', async () => {
        const payload = config.createPayload();
        const entityId = payload.id ?? `ent_${config.entityName}_001`;
        const result = await service[methods.create](pid, payload, defaultContext);
        expect(result).toBeDefined();
        expect(result.id).toBe(entityId);
        if (config.hasVersion) expect(result.version).toBe(1);
      });

      it('throws ForbiddenError when user lacks write permission', async () => {
        const payload = config.createPayload();
        await expect(service[methods.create](pid, payload, deniedContext)).rejects.toThrow(ForbiddenError);
      });
    });

    // --- GET BY ID ---
    describe('getById', () => {
      it('returns the entity when found', async () => {
        const entityId = config.createPayload().id ?? `ent_${config.entityName}_001`;
        const result = await service[methods.getById](pid, entityId);
        expect(result).toBeDefined();
        expect(result.id).toBe(entityId);
      });

      it('throws NotFoundError when entity does not exist', async () => {
        config.mockNotFound?.call(config);
        await expect(service[methods.getById](pid, 'nonexistent')).rejects.toThrow(NotFoundError);
      });
    });

    // --- LIST ---
    describe('list', () => {
      it('returns paginated results with total count', async () => {
        const result = await service[methods.list](pid);
        expect(result).toBeDefined();
        expect(Array.isArray(result.items)).toBe(true);
        expect(typeof result.total).toBe('number');
        expect(typeof result.offset).toBe('number');
        expect(typeof result.limit).toBe('number');
      });

      it('respects limit and offset parameters', async () => {
        const result = await service[methods.list](pid, { limit: 5, offset: 0 });
        expect(result.limit).toBe(5);
        expect(result.offset).toBe(0);
      });
    });

    // --- UPDATE ---
    describe('update', () => {
      const entityId = config.createPayload().id ?? `ent_${config.entityName}_001`;
      const updated = config.createPayload();
      updated.name = 'Updated Name';

      it('updates the entity and returns the new state', async () => {
        const result = await service[methods.update](pid, entityId, { ...updated, version: 1 }, defaultContext);
        expect(result).toBeDefined();
        expect(result.id).toBe(entityId);
        if (config.hasVersion) expect(result.version).toBe(2);
      });

      it('throws ForbiddenError when user lacks write permission', async () => {
        await expect(service[methods.update](pid, entityId, { ...updated, version: 1 }, deniedContext)).rejects.toThrow(ForbiddenError);
      });

      it('throws NotFoundError when entity does not exist', async () => {
        config.mockNotFound?.call(config);
        await expect(service[methods.update](pid, 'nonexistent', { ...updated, version: 1 }, defaultContext)).rejects.toThrow(NotFoundError);
      });

      if (config.hasVersion) {
        it('throws OptimisticLockError on version mismatch', async () => {
          config.mockVersionMismatch?.call(config);
          await expect(
            service[methods.update](pid, entityId, { ...updated, version: 1 }, defaultContext)
          ).rejects.toThrow(OptimisticLockError);
        });
      }
    });

    // --- DELETE ---
    describe('delete', () => {
      const entityId = config.createPayload().id ?? `ent_${config.entityName}_001`;

      it('deletes the entity successfully', async () => {
        await expect(
          service[methods.delete](pid, entityId, config.hasVersion ? 1 : undefined, defaultContext)
        ).resolves.toBeUndefined();
      });

      it('throws ForbiddenError when user lacks delete permission', async () => {
        await expect(
          service[methods.delete](pid, entityId, config.hasVersion ? 1 : undefined, deniedContext)
        ).rejects.toThrow(ForbiddenError);
      });

      it('throws NotFoundError when entity does not exist', async () => {
        config.mockNotFound?.call(config);
        await expect(
          service[methods.delete](pid, 'nonexistent', config.hasVersion ? 1 : undefined, defaultContext)
        ).rejects.toThrow(NotFoundError);
      });

      if (config.hasVersion) {
        it('throws OptimisticLockError on version mismatch', async () => {
          config.mockVersionMismatch?.call(config);
          await expect(
            service[methods.delete](pid, entityId, 99, defaultContext)
          ).rejects.toThrow(OptimisticLockError);
        });
      }
    });

    // --- CLONE (optional) ---
    if (config.hasClone) {
      describe('clone', () => {
        const entityId = config.createPayload().id ?? `ent_${config.entityName}_001`;

        it('creates a copy with a new ID and "(Clone)" suffix name', async () => {
          const result = await service[methods.clone](pid, entityId, {}, defaultContext);
          expect(result).toBeDefined();
          expect(result.id).toBeDefined();
          expect(result.name).toContain('(Clone)');
        });

        it('allows overriding the cloned entity name', async () => {
          const result = await service[methods.clone](pid, entityId, { name: 'Custom Clone' }, defaultContext);
          expect(result.name).toBe('Custom Clone');
        });

        it('throws NotFoundError when source entity does not exist', async () => {
          config.mockNotFound?.call(config);
          await expect(service[methods.clone](pid, 'nonexistent', {}, defaultContext)).rejects.toThrow(NotFoundError);
        });

        it('throws ForbiddenError when user lacks write permission', async () => {
          await expect(service[methods.clone](pid, entityId, {}, deniedContext)).rejects.toThrow(ForbiddenError);
        });
      });
    }
  });
}
