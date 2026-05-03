import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';

vi.mock('../../src/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../src/channels/ClientMessageHandlerRegistry', () => {
  const registry = new Map<string, any>();
  return {
    ClientMessageHandlerRegistry: {
      getAll: vi.fn(() => registry),
      register: vi.fn((type: string, factory: any, auth: boolean, schema: any, feature?: any) => {
        registry.set(type, { handlerFactory: factory, requiresAuth: auth, schema, requiredFeature: feature });
      }),
      clear: vi.fn(() => { registry.clear(); }),
      __registry: registry,
    },
  };
});

vi.mock('../../src/channels/handlers', () => ({}));

vi.mock('../../src/channels/SessionManager', () => {
  const isFeatureAllowed = vi.fn(() => true);
  return {
    isFeatureAllowed,
    __mocks: { isFeatureAllowed },
  };
});

import { ChannelHandlerDispatcher } from '../../src/channels/ChannelHandlerDispatcher';
import { ClientMessageHandlerRegistry } from '../../src/channels/ClientMessageHandlerRegistry';
import type { ClientMessageHandlerContext } from '../../src/channels/ClientMessageHandlerContext';
import type { CALInputMessage } from '../../src/channels/messages';
import { isFeatureAllowed, __mocks as sessionMocks } from '../../src/channels/SessionManager';

const mockSend = vi.fn();
const mockSendError = vi.fn();

const createMockContext = (overrides: Partial<ClientMessageHandlerContext> = {}): ClientMessageHandlerContext => ({
  send: mockSend,
  sendError: mockSendError,
  ...overrides,
});

describe('ChannelHandlerDispatcher', () => {
  let dispatcher: ChannelHandlerDispatcher;
  const testMessageType = 'send_user_text_input';
  const testSchema = z.object({
    type: z.literal(testMessageType),
    conversationId: z.string(),
    correlationId: z.string().optional(),
    text: z.string(),
  });

  beforeEach(() => {
    vi.clearAllMocks();
    (ClientMessageHandlerRegistry as any).clear();
    (ClientMessageHandlerRegistry as any).__registry.clear();
    dispatcher = new ChannelHandlerDispatcher();
  });

  describe('dispatch', () => {
    it('routes a valid message to the correct handler', async () => {
      const mockHandle = vi.fn().mockResolvedValue(undefined);
      const mockHandler = { handle: mockHandle };

      (ClientMessageHandlerRegistry as any).register(
        testMessageType,
        () => mockHandler,
        false,
        testSchema,
      );

      dispatcher = new ChannelHandlerDispatcher();

      const message: CALInputMessage = {
        type: testMessageType,
        conversationId: 'conv_test001',
        text: 'hello',
        correlationId: 'corr_001',
      } as any;

      await dispatcher.dispatch(message, createMockContext());

      expect(mockHandle).toHaveBeenCalledWith(
        expect.objectContaining({ send: mockSend, sendError: mockSendError }),
        message,
      );
    });

    it('returns an error for unknown message type', async () => {
      const context = createMockContext();
      const message = {
        type: 'nonexistent_message_type',
        conversationId: 'conv_test001',
        correlationId: 'corr_002',
      } as any;

      await dispatcher.dispatch(message, context);

      expect(context.sendError).toHaveBeenCalledWith('Unknown message type', 'corr_002');
    });

    it('fails gracefully on invalid message schema validation', async () => {
      const mockHandler = { handle: vi.fn() };

      (ClientMessageHandlerRegistry as any).register(
        testMessageType,
        () => mockHandler,
        false,
        testSchema,
      );

      dispatcher = new ChannelHandlerDispatcher();

      const context = createMockContext();
      const message = {
        type: testMessageType,
        conversationId: 'conv_test001',
        correlationId: 'corr_003',
      } as any;

      await dispatcher.dispatch(message, context);

      expect(context.sendError).toHaveBeenCalledWith(
        expect.stringContaining('Invalid message'),
        'corr_003',
      );
    });

    it('rejects auth-required messages when not authenticated', async () => {
      const mockHandler = { handle: vi.fn() };

      (ClientMessageHandlerRegistry as any).register(
        testMessageType,
        () => mockHandler,
        true,
        testSchema,
      );

      dispatcher = new ChannelHandlerDispatcher();

      const context = createMockContext({ session: undefined });
      const message: CALInputMessage = {
        type: testMessageType,
        conversationId: 'conv_test001',
        text: 'hello',
        correlationId: 'corr_004',
      } as any;

      await dispatcher.dispatch(message, context);

      expect(context.sendError).toHaveBeenCalledWith('Authentication required', 'corr_004');
      expect(mockHandler.handle).not.toHaveBeenCalled();
    });

    it('allows auth-required messages when authenticated', async () => {
      const mockHandle = vi.fn().mockResolvedValue(undefined);
      const mockHandler = { handle: mockHandle };

      (ClientMessageHandlerRegistry as any).register(
        testMessageType,
        () => mockHandler,
        true,
        testSchema,
      );

      dispatcher = new ChannelHandlerDispatcher();

      const session = { id: 'session_test001', projectId: 'proj_001', conversationId: 'conv_test001', runner: null as any, clientConnection: null as any, sessionSettings: {} as any, keySettings: null };
      const context = createMockContext({ session });
      const message: CALInputMessage = {
        type: testMessageType,
        conversationId: 'conv_test001',
        text: 'hello',
        correlationId: 'corr_005',
      } as any;

      await dispatcher.dispatch(message, context);

      expect(mockHandle).toHaveBeenCalled();
    });

    it('blocks feature-gated messages when the feature is disabled', async () => {
      (sessionMocks.isFeatureAllowed as vi.Mock).mockReturnValue(false);

      const mockHandler = { handle: vi.fn() };

      (ClientMessageHandlerRegistry as any).register(
        testMessageType,
        () => mockHandler,
        true,
        testSchema,
        'text_input',
      );

      dispatcher = new ChannelHandlerDispatcher();

      const session = { id: 'session_test001', projectId: 'proj_001', conversationId: 'conv_test001', runner: null as any, clientConnection: null as any, sessionSettings: {} as any, keySettings: { allowedFeatures: [] } };
      const context = createMockContext({ session });
      const message: CALInputMessage = {
        type: testMessageType,
        conversationId: 'conv_test001',
        text: 'hello',
        correlationId: 'corr_006',
      } as any;

      await dispatcher.dispatch(message, context);

      expect(isFeatureAllowed).toHaveBeenCalledWith(session, 'text_input');
      expect(context.sendError).toHaveBeenCalledWith(
        "Feature 'text_input' is not permitted by this API key",
        'corr_006',
      );
      expect(mockHandler.handle).not.toHaveBeenCalled();
    });

    it('allows feature-gated messages when the feature is enabled', async () => {
      (sessionMocks.isFeatureAllowed as vi.Mock).mockReturnValue(true);

      const mockHandle = vi.fn().mockResolvedValue(undefined);
      const mockHandler = { handle: mockHandle };

      (ClientMessageHandlerRegistry as any).register(
        testMessageType,
        () => mockHandler,
        true,
        testSchema,
        'text_input',
      );

      dispatcher = new ChannelHandlerDispatcher();

      const session = { id: 'session_test001', projectId: 'proj_001', conversationId: 'conv_test001', runner: null as any, clientConnection: null as any, sessionSettings: {} as any, keySettings: { allowedFeatures: ['text_input'] } };
      const context = createMockContext({ session });
      const message: CALInputMessage = {
        type: testMessageType,
        conversationId: 'conv_test001',
        text: 'hello',
        correlationId: 'corr_007',
      } as any;

      await dispatcher.dispatch(message, context);

      expect(isFeatureAllowed).toHaveBeenCalledWith(session, 'text_input');
      expect(mockHandle).toHaveBeenCalled();
    });

    it('wraps handler execution errors correctly', async () => {
      const handlerError = new Error('Handler internal error');
      const mockHandler = { handle: vi.fn().mockRejectedValue(handlerError) };

      (ClientMessageHandlerRegistry as any).register(
        testMessageType,
        () => mockHandler,
        false,
        testSchema,
      );

      dispatcher = new ChannelHandlerDispatcher();

      const context = createMockContext();
      const message: CALInputMessage = {
        type: testMessageType,
        conversationId: 'conv_test001',
        text: 'hello',
        correlationId: 'corr_008',
      } as any;

      await dispatcher.dispatch(message, context);

      expect(mockHandler.handle).toHaveBeenCalled();
      expect(context.sendError).toHaveBeenCalledWith('Handler internal error');
    });

    it('handles non-Error thrown values from handlers', async () => {
      const mockHandler = { handle: vi.fn().mockRejectedValue('string error') };

      (ClientMessageHandlerRegistry as any).register(
        testMessageType,
        () => mockHandler,
        false,
        testSchema,
      );

      dispatcher = new ChannelHandlerDispatcher();

      const context = createMockContext();
      const message: CALInputMessage = {
        type: testMessageType,
        conversationId: 'conv_test001',
        text: 'hello',
        correlationId: 'corr_009',
      } as any;

      await dispatcher.dispatch(message, context);

      expect(context.sendError).toHaveBeenCalledWith('string error');
    });

    it('preserves message correlation ID in error responses', async () => {
      const context = createMockContext();
      const message = {
        type: 'unknown_type',
        conversationId: 'conv_test001',
        correlationId: 'corr_010',
      } as any;

      await dispatcher.dispatch(message, context);

      expect(context.sendError).toHaveBeenCalledWith('Unknown message type', 'corr_010');
    });

    it('does not check feature gate when no requiredFeature is set', async () => {
      (sessionMocks.isFeatureAllowed as vi.Mock).mockReturnValue(false);

      const mockHandle = vi.fn().mockResolvedValue(undefined);
      const mockHandler = { handle: mockHandle };

      (ClientMessageHandlerRegistry as any).register(
        testMessageType,
        () => mockHandler,
        false,
        testSchema,
      );

      dispatcher = new ChannelHandlerDispatcher();

      const session = { id: 'session_test001', projectId: 'proj_001', conversationId: 'conv_test001', runner: null as any, clientConnection: null as any, sessionSettings: {} as any, keySettings: { allowedFeatures: [] } };
      const context = createMockContext({ session });
      const message: CALInputMessage = {
        type: testMessageType,
        conversationId: 'conv_test001',
        text: 'hello',
        correlationId: 'corr_011',
      } as any;

      await dispatcher.dispatch(message, context);

      expect(isFeatureAllowed).not.toHaveBeenCalled();
      expect(mockHandle).toHaveBeenCalled();
    });

    it('does not check feature gate when session is absent', async () => {
      (sessionMocks.isFeatureAllowed as vi.Mock).mockReturnValue(false);

      const mockHandler = { handle: vi.fn() };

      (ClientMessageHandlerRegistry as any).register(
        'test_no_auth',
        () => mockHandler,
        false,
        z.object({ type: z.literal('test_no_auth'), conversationId: z.string(), correlationId: z.string().optional() }),
        'text_input',
      );

      dispatcher = new ChannelHandlerDispatcher();

      const context = createMockContext({ session: undefined });
      const message = {
        type: 'test_no_auth',
        conversationId: 'conv_test001',
        correlationId: 'corr_012',
      } as any;

      await dispatcher.dispatch(message, context);

      expect(isFeatureAllowed).not.toHaveBeenCalled();
    });
  });
});
