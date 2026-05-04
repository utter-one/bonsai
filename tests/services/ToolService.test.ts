import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RequestContext } from '../../src/services/RequestContext';
import { ForbiddenError, NotFoundError, OptimisticLockError } from '../../src/errors';

vi.mock('../../src/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../../src/db/index', () => {
  const findFirst = vi.fn().mockResolvedValue({});
  const findMany = vi.fn().mockResolvedValue([]);
  const mocks = { lastInsertedValues: {} as Record<string, any> };
  const updateReturning = vi.fn().mockResolvedValue([]);

  const toolsTable = {
    findFirst,
    findMany,
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockImplementation((v: Record<string, any>) => {
        Object.assign(mocks.lastInsertedValues, v);
        return {
          returning: vi.fn().mockResolvedValue([{
            ...v,
            description: v.description ?? null,
            prompt: v.prompt ?? null,
            parameters: v.parameters ?? [],
            tags: v.tags ?? [],
            metadata: v.metadata ?? null,
            llmProviderId: v.llmProviderId ?? null,
            llmSettings: v.llmSettings ?? null,
            inputType: v.inputType ?? null,
            outputType: v.outputType ?? null,
            url: v.url ?? null,
            webhookMethod: v.webhookMethod ?? null,
            webhookHeaders: v.webhookHeaders ?? null,
            webhookBody: v.webhookBody ?? null,
            code: v.code ?? null,
            version: 1,
            createdAt: new Date(),
            updatedAt: new Date(),
          }]),
        };
      }),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: updateReturning,
        }),
      }),
    }),
    delete: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{
          id: 'tool_test123',
          projectId: 'proj_test123',
          name: 'Test Tool',
          description: null,
          type: 'smart_function',
          prompt: 'You are a helpful tool',
          llmProviderId: 'prov_test',
          llmSettings: { model: 'gpt-4' },
          inputType: 'text',
          outputType: 'text',
          url: null,
          webhookMethod: null,
          webhookHeaders: null,
          webhookBody: null,
          code: null,
          parameters: [],
          tags: [],
          metadata: null,
          version: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
        }]),
      }),
    }),
  };

  const selectMock = vi.fn().mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue([]),
      }),
    }),
  });

  return {
    db: {
      query: { tools: toolsTable },
      insert: toolsTable.insert,
      select: selectMock,
      update: toolsTable.update,
      delete: toolsTable.delete,
    },
    __mocks: { findFirst, findMany, updateReturning, ...mocks },
  };
});

vi.mock('../../src/utils/idGenerator', () => ({
  generateId: vi.fn().mockReturnValue('tool_test123'),
  ID_PREFIXES: { TOOL: 'tool' },
}));

vi.mock('../../src/utils/textSearch', () => ({
  parseTextSearch: vi.fn((v: string) => ({ type: 'text', value: v })),
  buildTextSearchCondition: vi.fn(() => null),
}));

vi.mock('../../src/utils/queryBuilder', () => ({
  buildFilterCondition: vi.fn(() => null),
  buildOrderBy: vi.fn(() => []),
}));

vi.mock('../../src/utils/pagination', () => ({
  DEFAULT_LIST_LIMIT: 100,
  MAX_LIST_LIMIT: 1000,
  countRows: vi.fn().mockResolvedValue(0),
  normalizeListLimit: vi.fn((v: number | undefined) => v ?? 100),
}));

import { ToolService } from '../../src/services/ToolService';
import { __mocks as dbMock } from '../../src/db/index';

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

function createToolRow(overrides?: Record<string, any>) {
  return {
    id: 'tool_test123',
    projectId: 'proj_test123',
    name: 'Test Tool',
    description: null,
    type: 'smart_function',
    prompt: 'You are a helpful tool',
    llmProviderId: 'prov_test',
    llmSettings: { model: 'gpt-4' },
    inputType: 'text',
    outputType: 'text',
    url: null,
    webhookMethod: null,
    webhookHeaders: null,
    webhookBody: null,
    code: null,
    parameters: [],
    tags: [],
    metadata: null,
    version: 1,
    createdAt: new Date('2025-01-01T00:00:00Z'),
    updatedAt: new Date('2025-01-01T00:00:00Z'),
    ...overrides,
  };
}

describe('ToolService', () => {
  let service: ToolService;

  beforeEach(() => {
    vi.clearAllMocks();
    const mockAudit = {
      logCreate: vi.fn().mockResolvedValue(undefined),
      logUpdate: vi.fn().mockResolvedValue(undefined),
      logDelete: vi.fn().mockResolvedValue(undefined),
      getEntityAuditLogs: vi.fn().mockResolvedValue([]),
    };
    service = new ToolService(mockAudit as any);
    dbMock.findFirst.mockResolvedValue(createToolRow());
    dbMock.updateReturning.mockResolvedValue([createToolRow({ version: 2 })]);
    dbMock.findMany.mockResolvedValue([]);
  });

  describe('createTool', () => {
    it('creates a smart_function tool and returns it', async () => {
      const result = await service.createTool('proj_test123', {
        type: 'smart_function',
        name: 'New Tool',
        prompt: 'System prompt',
        llmProviderId: 'prov_test',
        llmSettings: { model: 'gpt-4' },
inputType: 'text',
    outputType: 'text',
      }, defaultContext);
      expect(result).toBeDefined();
      expect(result.id).toBe('tool_test123');
    });

    it('creates a webhook tool and returns it', async () => {
      const result = await service.createTool('proj_test123', {
        type: 'webhook',
        name: 'Webhook Tool',
        url: 'https://example.com/api',
      }, defaultContext);
      expect(result).toBeDefined();
      expect(result.type).toBe('webhook');
    });

    it('creates a script tool and returns it', async () => {
      const result = await service.createTool('proj_test123', {
        type: 'script',
        name: 'Script Tool',
        code: 'return "hello";',
      }, defaultContext);
      expect(result).toBeDefined();
      expect(result.type).toBe('script');
    });

    it('creates the tool with a custom ID', async () => {
      const result = await service.createTool('proj_test123', {
        id: 'tool_custom',
        type: 'smart_function',
        name: 'Custom Tool',
        prompt: 'System prompt',
        llmProviderId: 'prov_test',
        llmSettings: { model: 'gpt-4' },
inputType: 'text',
    outputType: 'text',
      }, defaultContext);
      expect(result.id).toBe('tool_custom');
    });

    it('throws ForbiddenError when user lacks write permission', async () => {
      await expect(
        service.createTool('proj_test123', {
          type: 'smart_function',
          name: 'New Tool',
          prompt: 'System prompt',
          llmProviderId: 'prov_test',
          llmSettings: { model: 'gpt-4' },
          inputType: 'string',
          outputType: 'string',
        }, deniedContext)
      ).rejects.toThrow(ForbiddenError);
    });
  });

  describe('getToolById', () => {
    it('returns the tool when found', async () => {
      const result = await service.getToolById('proj_test123', 'tool_test123');
      expect(result).toBeDefined();
      expect(result.id).toBe('tool_test123');
    });

    it('throws NotFoundError when tool does not exist', async () => {
      dbMock.findFirst.mockResolvedValue(undefined);
      await expect(service.getToolById('proj_test123', 'nonexistent')).rejects.toThrow(NotFoundError);
    });
  });

  describe('listTools', () => {
    it('returns paginated results with total count', async () => {
      const result = await service.listTools('proj_test123');
      expect(result).toBeDefined();
      expect(Array.isArray(result.items)).toBe(true);
      expect(typeof result.total).toBe('number');
    });

    it('respects limit and offset parameters', async () => {
      await service.listTools('proj_test123', { limit: 5, offset: 0 });
      expect(dbMock.findMany).toHaveBeenCalled();
    });
  });

  describe('updateTool', () => {
    it('updates the tool and returns new state', async () => {
      const result = await service.updateTool('proj_test123', 'tool_test123', {
        type: 'smart_function',
        name: 'Updated Tool',
        llmProviderId: 'prov_test',
        llmSettings: { model: 'gpt-4' },
inputType: 'text',
    outputType: 'text',
        version: 1,
      }, defaultContext);
      expect(result).toBeDefined();
      expect(result.id).toBe('tool_test123');
    });

    it('throws ForbiddenError when user lacks write permission', async () => {
      await expect(
        service.updateTool('proj_test123', 'tool_test123', {
          type: 'smart_function',
          name: 'Updated',
          llmProviderId: 'prov_test',
          llmSettings: { model: 'gpt-4' },
          inputType: 'string',
          outputType: 'string',
          version: 1,
        }, deniedContext)
      ).rejects.toThrow(ForbiddenError);
    });

    it('throws NotFoundError when tool does not exist', async () => {
      dbMock.findFirst.mockResolvedValue(undefined);
      await expect(
        service.updateTool('proj_test123', 'nonexistent', {
          type: 'smart_function',
          name: 'Updated',
          llmProviderId: 'prov_test',
          llmSettings: { model: 'gpt-4' },
          inputType: 'string',
          outputType: 'string',
          version: 1,
        }, defaultContext)
      ).rejects.toThrow(NotFoundError);
    });

    it('throws OptimisticLockError on version mismatch', async () => {
      dbMock.findFirst.mockResolvedValue(createToolRow({ version: 5 }));
      await expect(
        service.updateTool('proj_test123', 'tool_test123', {
          type: 'smart_function',
          name: 'Updated',
          llmProviderId: 'prov_test',
          llmSettings: { model: 'gpt-4' },
          inputType: 'string',
          outputType: 'string',
          version: 1,
        }, defaultContext)
      ).rejects.toThrow(OptimisticLockError);
    });
  });

  describe('deleteTool', () => {
    it('deletes the tool successfully', async () => {
      await expect(
        service.deleteTool('proj_test123', 'tool_test123', 1, defaultContext)
      ).resolves.toBeUndefined();
    });

    it('throws ForbiddenError when user lacks delete permission', async () => {
      await expect(
        service.deleteTool('proj_test123', 'tool_test123', 1, deniedContext)
      ).rejects.toThrow(ForbiddenError);
    });

    it('throws NotFoundError when tool does not exist', async () => {
      dbMock.findFirst.mockResolvedValue(undefined);
      await expect(
        service.deleteTool('proj_test123', 'nonexistent', 1, defaultContext)
      ).rejects.toThrow(NotFoundError);
    });

    it('throws OptimisticLockError on version mismatch', async () => {
      dbMock.findFirst.mockResolvedValue(createToolRow({ version: 5 }));
      await expect(
        service.deleteTool('proj_test123', 'tool_test123', 1, defaultContext)
      ).rejects.toThrow(OptimisticLockError);
    });
  });

  describe('cloneTool', () => {
    it('clones the tool with new name', async () => {
      const result = await service.cloneTool('proj_test123', 'tool_test123', {
        name: 'Cloned Tool',
      }, defaultContext);
      expect(result).toBeDefined();
    });

    it('throws ForbiddenError when user lacks write permission', async () => {
      await expect(
        service.cloneTool('proj_test123', 'tool_test123', { name: 'Cloned' }, deniedContext)
      ).rejects.toThrow(ForbiddenError);
    });

    it('throws NotFoundError when tool does not exist', async () => {
      dbMock.findFirst.mockResolvedValue(undefined);
      await expect(
        service.cloneTool('proj_test123', 'nonexistent', { name: 'Cloned' }, defaultContext)
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe('getToolAuditLogs', () => {
    it('returns audit logs for a tool', async () => {
      const result = await service.getToolAuditLogs('tool_test123', 'proj_test123');
      expect(Array.isArray(result)).toBe(true);
    });
  });
});
