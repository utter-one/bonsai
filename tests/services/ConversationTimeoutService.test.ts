import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ConversationService } from '../../src/services/ConversationService';
import type { SessionManager, Session } from '../../src/channels/SessionManager';
import type { IClientConnection } from '../../src/channels/IClientConnection';

vi.mock('../../src/db/index', () => {
  const selectFn = vi.fn().mockReturnThis();
  return {
    db: {
      select: selectFn,
      from: selectFn,
      innerJoin: selectFn,
      where: selectFn,
    },
    __mocks: { select: selectFn },
  };
});

vi.mock('../../src/utils/logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

const mockSchedule = vi.fn();

vi.mock('node-cron', () => ({
  schedule: (...args: unknown[]) => mockSchedule(...args),
}));

import { ConversationTimeoutService } from '../../src/services/ConversationTimeoutService';
import { db, __mocks as dbMock } from '../../src/db/index';
import logger from '../../src/utils/logger';

const TIMEOUT_REASON = 'Conversation timed out due to inactivity';

const createMockConversationService = (): jest.Mocked<ConversationService> => ({
  abortConversation: vi.fn().mockResolvedValue(undefined),
  saveConversationEvent: vi.fn().mockResolvedValue('event_001'),
} as any);

const createMockClientConnection = (id: string): IClientConnection => ({
  sendMessage: vi.fn().mockResolvedValue(undefined),
  getId: () => id,
  isActive: () => true,
  close: vi.fn(),
} as any);

const createMockSession = (overrides: Partial<Session> = {}): Session => ({
  id: 'session_test001',
  projectId: 'proj_test001',
  conversationId: 'conv_test001',
  runner: null as any,
  clientConnection: createMockClientConnection('client_001'),
  sessionSettings: {
    sendVoiceInput: true,
    sendTextInput: true,
    receiveVoiceOutput: true,
    receiveTranscriptionUpdates: true,
    receiveEvents: true,
    sendAudioFormat: 'pcm_16000' as const,
    receiveAudioFormat: 'pcm_16000' as const,
  },
  keySettings: null,
  ...overrides,
});

const createMockSessionManager = (): jest.Mocked<SessionManager> => ({
  getSessionsForConversation: vi.fn().mockReturnValue([]),
  detachConversationFromSessions: vi.fn(),
} as any);

describe('ConversationTimeoutService', () => {
  let conversationService: ReturnType<typeof createMockConversationService>;
  let sessionManager: ReturnType<typeof createMockSessionManager>;
  let service: ConversationTimeoutService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSchedule.mockClear();
    conversationService = createMockConversationService();
    sessionManager = createMockSessionManager();
    service = new ConversationTimeoutService(conversationService as any, sessionManager as any);
  });

  describe('start', () => {
    it('schedules a cron job that runs every minute', () => {
      service.start();
      expect(mockSchedule).toHaveBeenCalledWith('* * * * *', expect.any(Function));
    });

    it('logs startup message', () => {
      service.start();
      expect(logger.info).toHaveBeenCalledWith('Starting ConversationTimeoutService (runs every 1 minute)');
    });

    it('wraps processTimeouts in a catch handler for unhandled errors', async () => {
      service.start();
      const cronCallback = mockSchedule.mock.calls[0][1];
      expect(typeof cronCallback).toBe('function');

      vi.spyOn(service, 'processTimeouts').mockRejectedValueOnce(new Error('simulated crash'));
      await cronCallback();

      expect(logger.error).toHaveBeenCalledWith(
        { error: expect.any(Error) },
        'Unhandled error in ConversationTimeoutService.processTimeouts'
      );
    });
  });

  describe('processTimeouts', () => {
    it('returns early when no conversations are timed out', async () => {
      vi.mocked(dbMock.select).mockReturnValueOnce({
        from: vi.fn().mockReturnThis(),
        innerJoin: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([]),
      });

      await service.processTimeouts();

      expect(logger.debug).toHaveBeenCalledWith('No conversations to time out');
      expect(conversationService.abortConversation).not.toHaveBeenCalled();
    });

    it('aborts each timed-out conversation', async () => {
      vi.mocked(dbMock.select).mockReturnValueOnce({
        from: vi.fn().mockReturnThis(),
        innerJoin: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([
          { id: 'conv_test001', projectId: 'proj_test001', stageId: 'stage_001' },
          { id: 'conv_test002', projectId: 'proj_test001', stageId: 'stage_002' },
        ]),
      });

      await service.processTimeouts();

      expect(conversationService.abortConversation).toHaveBeenCalledTimes(2);
      expect(conversationService.abortConversation).toHaveBeenCalledWith('proj_test001', 'conv_test001', TIMEOUT_REASON);
      expect(conversationService.abortConversation).toHaveBeenCalledWith('proj_test001', 'conv_test002', TIMEOUT_REASON);
    });

    it('saves conversation_aborted event for each timed-out conversation', async () => {
      vi.mocked(dbMock.select).mockReturnValueOnce({
        from: vi.fn().mockReturnThis(),
        innerJoin: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([
          { id: 'conv_test001', projectId: 'proj_test001', stageId: 'stage_001' },
        ]),
      });

      await service.processTimeouts();

      expect(conversationService.saveConversationEvent).toHaveBeenCalledWith(
        'proj_test001',
        'conv_test001',
        'conversation_aborted',
        { stageId: 'stage_001', reason: TIMEOUT_REASON },
        'stage_001'
      );
    });

    it('handles multiple timed-out conversations in one scan', async () => {
      vi.mocked(dbMock.select).mockReturnValueOnce({
        from: vi.fn().mockReturnThis(),
        innerJoin: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([
          { id: 'conv_001', projectId: 'proj_001', stageId: 'stage_001' },
          { id: 'conv_002', projectId: 'proj_002', stageId: 'stage_002' },
          { id: 'conv_003', projectId: 'proj_001', stageId: 'stage_003' },
        ]),
      });

      await service.processTimeouts();

      expect(conversationService.abortConversation).toHaveBeenCalledTimes(3);
      expect(conversationService.saveConversationEvent).toHaveBeenCalledTimes(3);
    });

    it('returns early on DB query error without crashing', async () => {
      vi.mocked(dbMock.select).mockReturnValueOnce({
        from: vi.fn().mockReturnThis(),
        innerJoin: vi.fn().mockReturnThis(),
        where: vi.fn().mockRejectedValue(new Error('connection timeout')),
      });

      await service.processTimeouts();

      expect(logger.error).toHaveBeenCalledWith(
        { error: expect.any(Error) },
        'Failed to query timed-out conversations'
      );
      expect(conversationService.abortConversation).not.toHaveBeenCalled();
    });
  });

  describe('abortTimedOutConversation (via processTimeouts)', () => {
    it('detaches conversation from all associated sessions', async () => {
      const mockSession = createMockSession();
      sessionManager.getSessionsForConversation.mockReturnValue([mockSession]);

      vi.mocked(dbMock.select).mockReturnValueOnce({
        from: vi.fn().mockReturnThis(),
        innerJoin: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([
          { id: 'conv_test001', projectId: 'proj_test001', stageId: 'stage_001' },
        ]),
      });

      await service.processTimeouts();

      expect(sessionManager.detachConversationFromSessions).toHaveBeenCalledWith('conv_test001');
    });

    it('sends conversation_event message to each session with client connection', async () => {
      const conn1 = createMockClientConnection('client_001');
      const conn2 = createMockClientConnection('client_002');
      const session1 = createMockSession({ id: 'session_001', conversationId: 'conv_test001', clientConnection: conn1 });
      const session2 = createMockSession({ id: 'session_002', conversationId: 'conv_test001', clientConnection: conn2 });
      sessionManager.getSessionsForConversation.mockReturnValue([session1, session2]);

      vi.mocked(dbMock.select).mockReturnValueOnce({
        from: vi.fn().mockReturnThis(),
        innerJoin: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([
          { id: 'conv_test001', projectId: 'proj_test001', stageId: 'stage_001' },
        ]),
      });

      await service.processTimeouts();

      expect(conn1.sendMessage).toHaveBeenCalledWith({
        type: 'conversation_event',
        conversationId: 'conv_test001',
        eventType: 'conversation_aborted',
        eventData: { stageId: 'stage_001', reason: TIMEOUT_REASON },
      });
      expect(conn2.sendMessage).toHaveBeenCalledWith({
        type: 'conversation_event',
        conversationId: 'conv_test001',
        eventType: 'conversation_aborted',
        eventData: { stageId: 'stage_001', reason: TIMEOUT_REASON },
      });
    });

    it('handles sessions without client connection gracefully', async () => {
      const sessionNoConn = createMockSession({ clientConnection: null as any });
      sessionManager.getSessionsForConversation.mockReturnValue([sessionNoConn]);

      vi.mocked(dbMock.select).mockReturnValueOnce({
        from: vi.fn().mockReturnThis(),
        innerJoin: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([
          { id: 'conv_test001', projectId: 'proj_test001', stageId: 'stage_001' },
        ]),
      });

      await service.processTimeouts();

      expect(conversationService.abortConversation).toHaveBeenCalled();
      expect(sessionManager.detachConversationFromSessions).toHaveBeenCalled();
    });

    it('continues processing remaining conversations when one fails', async () => {
      conversationService.abortConversation
        .mockRejectedValueOnce(new Error('abort failed'))
        .mockResolvedValueOnce(undefined);

      vi.mocked(dbMock.select).mockReturnValueOnce({
        from: vi.fn().mockReturnThis(),
        innerJoin: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([
          { id: 'conv_fail', projectId: 'proj_test001', stageId: 'stage_001' },
          { id: 'conv_ok', projectId: 'proj_test001', stageId: 'stage_002' },
        ]),
      });

      await service.processTimeouts();

      expect(conversationService.abortConversation).toHaveBeenCalledTimes(2);
      expect(conversationService.abortConversation).toHaveBeenLastCalledWith('proj_test001', 'conv_ok', TIMEOUT_REASON);
    });

    it('logs failure when aborting a conversation throws', async () => {
      conversationService.abortConversation.mockRejectedValueOnce(new Error('abort failed'));

      vi.mocked(dbMock.select).mockReturnValueOnce({
        from: vi.fn().mockReturnThis(),
        innerJoin: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([
          { id: 'conv_fail', projectId: 'proj_test001', stageId: 'stage_001' },
        ]),
      });

      await service.processTimeouts();

      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.any(Error), conversationId: 'conv_fail', projectId: 'proj_test001' }),
        'Failed to abort timed-out conversation'
      );
    });

    it('logs success when a conversation is aborted', async () => {
      vi.mocked(dbMock.select).mockReturnValueOnce({
        from: vi.fn().mockReturnThis(),
        innerJoin: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([
          { id: 'conv_test001', projectId: 'proj_test001', stageId: 'stage_001' },
        ]),
      });

      await service.processTimeouts();

      expect(logger.info).toHaveBeenCalledWith(
        { conversationId: 'conv_test001', projectId: 'proj_test001' },
        'Conversation aborted due to inactivity timeout'
      );
    });
  });
});
