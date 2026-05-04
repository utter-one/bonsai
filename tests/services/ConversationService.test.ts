import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConversationService, CreateConversationInput } from '../../src/services/ConversationService';
import { ForbiddenError, NotFoundError } from '../../src/errors';
import type { RequestContext } from '../../src/services/RequestContext';
import { PERMISSIONS } from '../../src/permissions';


vi.mock('../../src/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock('../../src/db/index', () => {
  const convFindFirst = vi.fn().mockResolvedValue({});
  const convFindMany = vi.fn().mockResolvedValue([]);
  const eventFindFirst = vi.fn().mockResolvedValue({});
  const eventFindMany = vi.fn().mockResolvedValue([]);
  const mocks = { lastInsertedValues: {} as Record<string, any> };
  const updateReturning = vi.fn().mockResolvedValue([]);
  const deleteReturning = vi.fn().mockResolvedValue([]);

  const mockInsert = () => vi.fn().mockReturnValue({
    values: vi.fn().mockImplementation((v) => {
      Object.assign(mocks.lastInsertedValues, v);
      // Check if this is a conversation insert
      const isConversation = v && 'projectId' in v && 'userId' in v;
      const isEvent = v && 'conversationId' in v;

      let extraFields: any = {
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      if (isConversation) {
        extraFields = {
          ...extraFields,
          startingStageId: v.startingStageId ?? v.stageId ?? null,
          endingStageId: null,
          stageVars: v.stageVars ?? {},
        };
      } else if (isEvent) {
        extraFields = {
          ...extraFields,
          eventType: v.eventType ?? 'message',
          eventData: v.eventData ?? { role: 'user', text: '', originalText: '' },
          stageId: v.stageId ?? null,
          timestamp: new Date(),
        };
      }

      return {
        returning: vi.fn().mockResolvedValue([{
          ...v,
          ...extraFields,
        }]),
      };
    }),
  });

  const mockUpdate = () => vi.fn().mockReturnValue({
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        returning: updateReturning,
      }),
    }),
  });

  const mockDelete = () => vi.fn().mockReturnValue({
    where: vi.fn().mockReturnValue({
      returning: deleteReturning,
    }),
  });

  const selectMock = vi.fn().mockImplementation((args) => {
    const isCountQuery = args && typeof args === 'object' && 'count' in args;

    if (isCountQuery) {
      return {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue([{ count: 0 }]),
        }),
      };
    }

    return {
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
    };
  });

  return {
    db: {
      query: {
        conversations: {
          findFirst: convFindFirst,
          findMany: convFindMany,
          insert: mockInsert(),
          update: mockUpdate(),
          delete: mockDelete(),
        },
        conversationEvents: {
          findFirst: eventFindFirst,
          findMany: eventFindMany,
          insert: mockInsert(),
          update: mockUpdate(),
          delete: mockDelete(),
        },
      },
      select: selectMock,
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockImplementation((v) => {
          Object.assign(mocks.lastInsertedValues, v);
          const isConversation = v && 'projectId' in v && 'userId' in v;
          const isEvent = v && 'conversationId' in v;

          let extraFields: any = {
            createdAt: new Date(),
            updatedAt: new Date(),
          };

          if (isConversation) {
            extraFields = {
              ...extraFields,
              startingStageId: v.startingStageId ?? v.stageId ?? null,
              endingStageId: null,
              stageVars: v.stageVars ?? {},
            };
          } else if (isEvent) {
            extraFields = {
              ...extraFields,
              eventType: v.eventType ?? 'message',
              eventData: v.eventData ?? { role: 'user', text: '', originalText: '' },
              stageId: v.stageId ?? null,
              timestamp: new Date(),
            };
          }

          return {
            returning: vi.fn().mockResolvedValue([{
              ...v,
              ...extraFields,
            }]),
          };
        }),
      }),
      update: mockUpdate(),
      delete: mockDelete(),
    },
    __mocks: { convFindFirst, convFindMany, eventFindFirst, eventFindMany, updateReturning, deleteReturning, lastInsertedValues: mocks.lastInsertedValues },
  };
});

vi.mock('../../src/utils/idGenerator', () => ({
  generateId: vi.fn().mockReturnValue('conv_auto001'),
  ID_PREFIXES: {
    CONVERSATION: 'conv_',
    CONVERSATION_EVENT: 'cevent_',
  },
}));

const { __mocks: dbMock } = await import('../../src/db/index');

describe('ConversationService', () => {
  const defaultContext: RequestContext = {
    operatorId: 'op_test123',
    roles: ['super_admin'],
    ip: '127.0.0.1',
    userAgent: 'TestAgent/1.0',
    requestId: 'req_test123',
    timestamp: new Date().toISOString(),
  };

  const deniedContext: RequestContext = {
    operatorId: 'op_denied123',
    roles: ['viewer'],
    ip: '127.0.0.1',
    userAgent: 'TestAgent/1.0',
    requestId: 'req_test124',
    timestamp: new Date().toISOString(),
  };

  const testProjectId = '__test_project__';

  const createConversationRow = (overrides?: any) => ({
    id: 'conv_test001',
    projectId: testProjectId,
    userId: 'user_test001',
    sessionId: 'session_test001',
    stageId: 'stage_test001',
    startingStageId: 'stage_test001',
    endingStageId: null,
    stageVars: null,
    status: 'initialized',
    statusDetails: null,
    direction: 'incoming',
    metadata: null,
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  const createEventRow = (overrides?: any) => ({
    id: 'cevent_test001',
    projectId: testProjectId,
    conversationId: 'conv_test001',
    eventType: 'message',
    eventData: { role: 'user', text: 'test message', originalText: 'test message' },
    stageId: null,
    timestamp: new Date(),
    metadata: null,
    createdAt: new Date(),
    ...overrides,
  });

  let service: ConversationService;
  let mockAudit: { logCreate: ReturnType<typeof vi.fn>; logUpdate: ReturnType<typeof vi.fn>; logDelete: ReturnType<typeof vi.fn>; getEntityAuditLogs: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    mockAudit = {
      logCreate: vi.fn().mockResolvedValue(undefined),
      logUpdate: vi.fn().mockResolvedValue(undefined),
      logDelete: vi.fn().mockResolvedValue(undefined),
      getEntityAuditLogs: vi.fn().mockResolvedValue([]),
    };
    service = new ConversationService(mockAudit as any);
    dbMock.convFindFirst.mockResolvedValue(createConversationRow());
    dbMock.convFindMany.mockResolvedValue([createConversationRow()]);
    dbMock.eventFindFirst.mockResolvedValue(createEventRow());
    dbMock.eventFindMany.mockResolvedValue([createEventRow()]);
    dbMock.updateReturning.mockResolvedValue([createConversationRow({ version: 2 })]);
    dbMock.deleteReturning.mockResolvedValue([createConversationRow()]);
  });

  describe('createConversation', () => {
    it('creates the conversation and returns it', async () => {
      const input: CreateConversationInput = {
        id: 'conv_test001',
        projectId: testProjectId,
        userId: 'user_test001',
        sessionId: 'session_test001',
        stageId: 'stage_test001',
        status: 'initialized',
      };
      const result = await service.createConversation(input, defaultContext);
      expect(result).toBeDefined();
      expect(result.id).toBe('conv_test001');
    });

    it('generates ID when not provided', async () => {
      const input: CreateConversationInput = {
        projectId: testProjectId,
        userId: 'user_test001',
        sessionId: 'session_test001',
        stageId: 'stage_test001',
        status: 'initialized',
      };
      const result = await service.createConversation(input, defaultContext);
      expect(result.id).toBe('conv_auto001');
    });

    it('logs audit entry on successful creation', async () => {
      const input: CreateConversationInput = {
        id: 'conv_test001',
        projectId: testProjectId,
        userId: 'user_test001',
        sessionId: 'session_test001',
        stageId: 'stage_test001',
        status: 'initialized',
      };
      await service.createConversation(input, defaultContext);
      expect(mockAudit.logCreate).toHaveBeenCalledWith('conversation', 'conv_test001', expect.any(Object), 'op_test123');
    });

    it('creates initial event when stageId is provided', async () => {
      const input: CreateConversationInput = {
        id: 'conv_test001',
        projectId: testProjectId,
        userId: 'user_test001',
        sessionId: 'session_test001',
        stageId: 'stage_test001',
        status: 'initialized',
      };
      const result = await service.createConversation(input, defaultContext);
      expect(result).toBeDefined();
      expect(result.startingStageId).toBe('stage_test001');
    });
  });

  describe('getConversationById', () => {
    it('returns the conversation when found', async () => {
      const result = await service.getConversationById(testProjectId, 'conv_test001');
      expect(result).toBeDefined();
      expect(result.id).toBe('conv_test001');
    });

    it('throws NotFoundError when conversation not found', async () => {
      dbMock.convFindFirst.mockResolvedValue(undefined);
      await expect(
        service.getConversationById(testProjectId, 'conv_nonexistent')
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe('listConversations', () => {
    it('returns paginated conversations list', async () => {
      dbMock.convFindMany.mockResolvedValue([createConversationRow()]);
      const result = await service.listConversations(testProjectId, { limit: 10, offset: 0 });
      expect(result).toBeDefined();
    });

    it('returns empty list when no conversations exist', async () => {
      dbMock.convFindMany.mockResolvedValue([]);
      const result = await service.listConversations(testProjectId);
      expect(result).toBeDefined();
    });
  });

  describe('saveConversationState', () => {
    it('updates conversation status and creates state change event', async () => {
      dbMock.convFindFirst.mockResolvedValue(createConversationRow());
      await expect(
        service.saveConversationState(testProjectId, 'conv_test001', 'finished', 'completed successfully')
      ).resolves.toBeUndefined();
    });

    it('does not check conversation existence before saving state', async () => {
      // saveConversationState doesn't verify conversation exists - it just does an update
      await expect(
        service.saveConversationState(testProjectId, 'conv_nonexistent', 'finished')
      ).resolves.toBeUndefined();
    });
  });

  describe('saveConversationEvent', () => {
    it('creates a new event for the conversation', async () => {
      dbMock.convFindFirst.mockResolvedValue(createConversationRow());
      const eventId = await service.saveConversationEvent(testProjectId, 'conv_test001', 'message', { role: 'user', text: 'test', originalText: 'test' });
      expect(eventId).toBeDefined();
    });

    it('does not check conversation existence before saving event', async () => {
      // saveConversationEvent doesn't verify conversation exists - it just inserts the event
      const eventId = await service.saveConversationEvent(testProjectId, 'conv_nonexistent', 'message', { role: 'user', text: 'test', originalText: 'test' });
      expect(eventId).toBeDefined();
    });
  });

  describe('setConversationMetadata', () => {
    it('updates conversation metadata', async () => {
      dbMock.convFindFirst.mockResolvedValue(createConversationRow());
      await expect(
        service.setConversationMetadata(testProjectId, 'conv_test001', { key: 'value' })
      ).resolves.toBeUndefined();
    });

    it('does not check conversation existence before updating metadata', async () => {
      // setConversationMetadata doesn't verify conversation exists - it just does an update
      await expect(
        service.setConversationMetadata(testProjectId, 'conv_nonexistent', { key: 'value' })
      ).resolves.toBeUndefined();
    });
  });

  describe('finishConversation', () => {
    it('marks conversation as finished', async () => {
      dbMock.convFindFirst.mockResolvedValue(createConversationRow());
      await expect(
        service.finishConversation(testProjectId, 'conv_test001', 'completed')
      ).resolves.toBeUndefined();
    });

    it('throws NotFoundError when conversation not found', async () => {
      dbMock.convFindFirst.mockResolvedValue(undefined);
      await expect(
        service.finishConversation(testProjectId, 'conv_nonexistent', 'reason')
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe('failConversation', () => {
    it('marks conversation as failed', async () => {
      dbMock.convFindFirst.mockResolvedValue(createConversationRow());
      await expect(
        service.failConversation(testProjectId, 'conv_test001', 'error occurred')
      ).resolves.toBeUndefined();
    });

    it('throws NotFoundError when conversation not found', async () => {
      dbMock.convFindFirst.mockResolvedValue(undefined);
      await expect(
        service.failConversation(testProjectId, 'conv_nonexistent', 'reason')
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe('abortConversation', () => {
    it('marks conversation as aborted', async () => {
      dbMock.convFindFirst.mockResolvedValue(createConversationRow());
      await expect(
        service.abortConversation(testProjectId, 'conv_test001', 'user cancelled')
      ).resolves.toBeUndefined();
    });

    it('throws NotFoundError when conversation not found', async () => {
      dbMock.convFindFirst.mockResolvedValue(undefined);
      await expect(
        service.abortConversation(testProjectId, 'conv_nonexistent', 'reason')
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe('deleteConversation', () => {
    it('deletes the conversation successfully', async () => {
      dbMock.convFindFirst.mockResolvedValue(createConversationRow());
      await expect(
        service.deleteConversation(testProjectId, 'conv_test001', defaultContext)
      ).resolves.toBeUndefined();
    });

    it('logs audit entry on successful deletion', async () => {
      dbMock.convFindFirst.mockResolvedValue(createConversationRow());
      await service.deleteConversation(testProjectId, 'conv_test001', defaultContext);
      expect(mockAudit.logDelete).toHaveBeenCalledWith('conversation', 'conv_test001', expect.any(Object), 'op_test123');
    });

    it('throws NotFoundError when conversation not found', async () => {
      dbMock.convFindFirst.mockResolvedValue(undefined);
      await expect(
        service.deleteConversation(testProjectId, 'conv_nonexistent', defaultContext)
      ).rejects.toThrow(NotFoundError);
    });

    it('throws ForbiddenError when user lacks write permission', async () => {
      dbMock.convFindFirst.mockResolvedValue(createConversationRow());
      await expect(
        service.deleteConversation(testProjectId, 'conv_test001', deniedContext)
      ).rejects.toThrow(ForbiddenError);
    });
  });

  describe('getConversationEvents', () => {
    it('returns paginated events list', async () => {
      dbMock.eventFindMany.mockResolvedValue([createEventRow()]);
      const result = await service.getConversationEvents(testProjectId, 'conv_test001', { limit: 10, offset: 0 });
      expect(result).toBeDefined();
    });

    it('returns empty list when no events exist', async () => {
      dbMock.eventFindMany.mockResolvedValue([]);
      const result = await service.getConversationEvents(testProjectId, 'conv_test001');
      expect(result).toBeDefined();
    });
  });

  describe('getConversationEventById', () => {
    it('returns the event when found', async () => {
      dbMock.eventFindFirst.mockResolvedValue(createEventRow());
      const result = await service.getConversationEventById(testProjectId, 'conv_test001', 'cevent_test001');
      expect(result).toBeDefined();
      expect(result.id).toBe('cevent_test001');
    });

    it('throws NotFoundError when event not found', async () => {
      dbMock.eventFindFirst.mockResolvedValue(undefined);
      await expect(
        service.getConversationEventById(testProjectId, 'conv_test001', 'cevent_nonexistent')
      ).rejects.toThrow(NotFoundError);
    });
  });

describe('updateMessageEvent', () => {
    it('updates message event data', async () => {
      const mockEvent = createEventRow({
        eventType: 'message',
        eventData: { role: 'user', text: 'original', originalText: 'original' },
      });
      dbMock.eventFindFirst.mockResolvedValue(mockEvent);
      dbMock.updateReturning.mockResolvedValueOnce([mockEvent]);
      const result = await service.updateMessageEvent(testProjectId, 'cevent_test001', 'updated content', {}, { visibility: 'always' });
      expect(result).toBeDefined();
    });

    it('returns null when event not found', async () => {
      dbMock.eventFindFirst.mockResolvedValue(undefined);
      const result = await service.updateMessageEvent(testProjectId, 'cevent_nonexistent', 'content', {}, { visibility: 'always' });
      expect(result).toBeUndefined();
    });
  });

  describe('updateConversationEventMetadata', () => {
    it('updates event metadata with deep merge', async () => {
      dbMock.eventFindFirst.mockResolvedValue(createEventRow({
        metadata: { existing: 'value' },
      }));
      const result = await service.updateConversationEventMetadata(testProjectId, 'cevent_test001', { newKey: 'newValue' });
      expect(result).toBeDefined();
    });

    it('returns null when event not found', async () => {
      dbMock.eventFindFirst.mockResolvedValue(undefined);
      const result = await service.updateConversationEventMetadata(testProjectId, 'cevent_nonexistent', { key: 'value' });
      expect(result).toBeUndefined();
    });
  });

  describe('getConversationAuditLogs', () => {
    it('delegates to audit service', async () => {
      mockAudit.getEntityAuditLogs.mockResolvedValue([{ action: 'create' }]);
      const result = await service.getConversationAuditLogs('conv_test001', testProjectId);
      expect(mockAudit.getEntityAuditLogs).toHaveBeenCalledWith('conversation', 'conv_test001', testProjectId);
      expect(result).toEqual([{ action: 'create' }]);
    });
  });
});
