import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Session, SessionManager as SM_Type } from '../../src/channels/SessionManager';
import type { IClientConnection } from '../../src/channels/IClientConnection';
import type { ApiKeyChannel, ApiKeyFeature, ApiKeySettings } from '../../src/apiKeyFeatures';

vi.mock('../../src/services/live/ConversationRunner', () => {
  const prepareConversation = vi.fn().mockResolvedValue(undefined);
  const cleanup = vi.fn().mockResolvedValue(undefined);
  return {
    ConversationRunner: class MockRunner {
      prepareConversation = prepareConversation;
      cleanup = cleanup;
    },
    __mocks: { prepareConversation, cleanup },
  };
});

vi.mock('tsyringe', async (importOriginal) => {
  const actual = await importOriginal();
  const mockRunner = {
    prepareConversation: vi.fn().mockResolvedValue(undefined),
    cleanup: vi.fn().mockResolvedValue(undefined),
  };
  return {
    ...(actual as any),
    container: {
      resolve: vi.fn().mockReturnValue(mockRunner),
      __mockRunner: mockRunner,
    },
  };
});

vi.mock('../../src/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { SessionManager, isChannelAllowed, isFeatureAllowed } from '../../src/channels/SessionManager';
import { container } from 'tsyringe';

const mockContainerResolve = (container as any).resolve;
const mockRunner = (container as any).__mockRunner;
const mockPrepareConversation = mockRunner.prepareConversation;
const mockCleanup = mockRunner.cleanup;

const createMockClient = (overrides: Partial<IClientConnection> = {}): IClientConnection => ({
  connectionType: 'websocket',
  sendMessage: vi.fn().mockResolvedValue(undefined),
  close: vi.fn().mockResolvedValue(undefined),
  ...overrides,
});

describe('isChannelAllowed', () => {
  it('returns true when keySettings is null', () => {
    const session = { keySettings: null } as Session;
    expect(isChannelAllowed(session, 'websocket')).toBe(true);
  });

  it('returns true when allowedChannels is absent', () => {
    const session = { keySettings: {} as ApiKeySettings } as Session;
    expect(isChannelAllowed(session, 'websocket')).toBe(true);
  });

  it('returns true when channel is in allowed list', () => {
    const session = { keySettings: { allowedChannels: ['websocket', 'webrtc'] } as ApiKeySettings } as Session;
    expect(isChannelAllowed(session, 'websocket')).toBe(true);
    expect(isChannelAllowed(session, 'webrtc')).toBe(true);
  });

  it('returns false when channel is not in allowed list', () => {
    const session = { keySettings: { allowedChannels: ['websocket'] } as ApiKeySettings } as Session;
    expect(isChannelAllowed(session, 'webrtc')).toBe(false);
  });
});

describe('isFeatureAllowed', () => {
  it('returns true when keySettings is null', () => {
    const session = { keySettings: null } as Session;
    expect(isFeatureAllowed(session, 'voice_input' as ApiKeyFeature)).toBe(true);
  });

  it('returns true when allowedFeatures is absent', () => {
    const session = { keySettings: {} as ApiKeySettings } as Session;
    expect(isFeatureAllowed(session, 'voice_input' as ApiKeyFeature)).toBe(true);
  });

  it('returns true when feature is in allowed list', () => {
    const session = { keySettings: { allowedFeatures: ['voice_input', 'text_output'] } as ApiKeySettings } as Session;
    expect(isFeatureAllowed(session, 'voice_input' as ApiKeyFeature)).toBe(true);
    expect(isFeatureAllowed(session, 'text_output' as ApiKeyFeature)).toBe(true);
  });

  it('returns false when feature is not in allowed list', () => {
    const session = { keySettings: { allowedFeatures: ['voice_input'] } as ApiKeySettings } as Session;
    expect(isFeatureAllowed(session, 'text_output' as ApiKeyFeature)).toBe(false);
  });
});

describe('SessionManager', () => {
  let manager: SessionManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new SessionManager();
  });

  describe('registerSession', () => {
    it('creates a session with correct initial state', () => {
      const client = createMockClient();
      const sessionId = manager.registerSession(client);

      expect(sessionId).toMatch(/^session_/);
      const session = manager.getSession(sessionId);
      expect(session).not.toBeNull();
      expect(session!.projectId).toBeNull();
      expect(session!.conversationId).toBeNull();
      expect(session!.runner).toBeNull();
      expect(session!.clientConnection).toBe(client);
      expect(session!.keySettings).toBeNull();
    });

    it('sets default session settings', () => {
      const client = createMockClient();
      const sessionId = manager.registerSession(client);
      const session = manager.getSession(sessionId)!;

      expect(session.sessionSettings.sendVoiceInput).toBe(true);
      expect(session.sessionSettings.sendTextInput).toBe(true);
      expect(session.sessionSettings.receiveVoiceOutput).toBe(true);
      expect(session.sessionSettings.receiveTranscriptionUpdates).toBe(true);
      expect(session.sessionSettings.receiveEvents).toBe(true);
      expect(session.sessionSettings.sendAudioFormat).toBe('pcm_16000');
      expect(session.sessionSettings.receiveAudioFormat).toBe('pcm_16000');
    });

    it('throws when client connection is null', () => {
      expect(() => manager.registerSession(null as any)).toThrow('Client connection is required');
    });

    it('returns unique session IDs for multiple registrations', () => {
      const client1 = createMockClient();
      const client2 = createMockClient();
      const id1 = manager.registerSession(client1);
      const id2 = manager.registerSession(client2);
      expect(id1).not.toBe(id2);
    });
  });

  describe('setSessionProjectAndSettings', () => {
    it('updates project ID, settings, and key settings', () => {
      const client = createMockClient();
      const sessionId = manager.registerSession(client);
      const settings = { sendVoiceInput: false, sendTextInput: true, receiveVoiceOutput: true, receiveTranscriptionUpdates: true, receiveEvents: true, sendAudioFormat: 'opus' as any, receiveAudioFormat: 'mulaw' as any };
      const keySettings = { allowedChannels: ['websocket'], allowedFeatures: ['voice_input'] } as ApiKeySettings;

      manager.setSessionProjectAndSettings(sessionId, 'proj_test001', settings, keySettings);

      const session = manager.getSession(sessionId)!;
      expect(session.projectId).toBe('proj_test001');
      expect(session.sessionSettings.sendVoiceInput).toBe(false);
      expect(session.sessionSettings.sendAudioFormat).toBe('opus');
      expect(session.keySettings).toEqual(keySettings);
    });

    it('throws when session not found', () => {
      const settings = { sendVoiceInput: true, sendTextInput: true, receiveVoiceOutput: true, receiveTranscriptionUpdates: true, receiveEvents: true, sendAudioFormat: 'pcm_16000' as any, receiveAudioFormat: 'pcm_16000' as any };
      expect(() => manager.setSessionProjectAndSettings('nonexistent', 'proj_test001', settings, null)).toThrow('Session not found');
    });

    it('allows null keySettings', () => {
      const client = createMockClient();
      const sessionId = manager.registerSession(client);
      const settings = { sendVoiceInput: true, sendTextInput: true, receiveVoiceOutput: true, receiveTranscriptionUpdates: true, receiveEvents: true, sendAudioFormat: 'pcm_16000' as any, receiveAudioFormat: 'pcm_16000' as any };

      manager.setSessionProjectAndSettings(sessionId, 'proj_test001', settings, null);

      const session = manager.getSession(sessionId)!;
      expect(session.keySettings).toBeNull();
    });
  });

  describe('getSession', () => {
    it('returns the session for a valid ID', () => {
      const client = createMockClient();
      const sessionId = manager.registerSession(client);
      const session = manager.getSession(sessionId);
      expect(session).not.toBeNull();
      expect(session!.id).toBe(sessionId);
    });

    it('returns null for nonexistent ID', () => {
      expect(manager.getSession('nonexistent')).toBeNull();
    });
  });

  describe('attachConversationToSession', () => {
    it('attaches conversation and initializes runner', async () => {
      const client = createMockClient();
      const sessionId = manager.registerSession(client);

      await manager.attachConversationToSession(sessionId, 'conv_test001');

      const session = manager.getSession(sessionId)!;
      expect(session.conversationId).toBe('conv_test001');
      expect(session.runner).not.toBeNull();
      expect(mockPrepareConversation).toHaveBeenCalledWith('conv_test001', session, client);
    });

    it('throws when session not found', async () => {
      await expect(manager.attachConversationToSession('nonexistent', 'conv_test001')).rejects.toThrow('Session not found');
    });
  });

  describe('detachConversationFromSession', () => {
    it('clears conversation and runner from a session', () => {
      const client = createMockClient();
      const sessionId = manager.registerSession(client);
      manager.setSessionProjectAndSettings(
        sessionId, 'proj_test001',
        { sendVoiceInput: true, sendTextInput: true, receiveVoiceOutput: true, receiveTranscriptionUpdates: true, receiveEvents: true, sendAudioFormat: 'pcm_16000' as any, receiveAudioFormat: 'pcm_16000' as any },
        null,
      );

      (manager as any).idMap.get(sessionId).conversationId = 'conv_test001';
      (manager as any).idMap.get(sessionId).runner = { cleanup: mockCleanup };

      manager.detachConversationFromSession(sessionId);

      const session = manager.getSession(sessionId)!;
      expect(session.conversationId).toBeNull();
      expect(session.runner).toBeNull();
    });

    it('throws when session not found', () => {
      expect(() => manager.detachConversationFromSession('nonexistent')).toThrow('Session not found');
    });
  });

  describe('detachConversationFromSessions', () => {
    it('detaches conversation from all matching sessions', () => {
      const client1 = createMockClient();
      const client2 = createMockClient();
      const id1 = manager.registerSession(client1);
      const id2 = manager.registerSession(client2);
      const id3 = manager.registerSession(createMockClient());

      (manager as any).idMap.get(id1).conversationId = 'conv_test001';
      (manager as any).idMap.get(id1).runner = { cleanup: mockCleanup };
      (manager as any).idMap.get(id2).conversationId = 'conv_test001';
      (manager as any).idMap.get(id2).runner = { cleanup: mockCleanup };
      (manager as any).idMap.get(id3).conversationId = 'conv_other';
      (manager as any).idMap.get(id3).runner = { cleanup: mockCleanup };

      manager.detachConversationFromSessions('conv_test001');

      expect(manager.getSession(id1)!.conversationId).toBeNull();
      expect(manager.getSession(id1)!.runner).toBeNull();
      expect(manager.getSession(id2)!.conversationId).toBeNull();
      expect(manager.getSession(id2)!.runner).toBeNull();
      expect(manager.getSession(id3)!.conversationId).toBe('conv_other');
    });

    it('does nothing when no sessions match', () => {
      manager.detachConversationFromSessions('nonexistent');
    });
  });

  describe('unregisterSession', () => {
    it('removes session and cleans up runner', async () => {
      const client = createMockClient();
      const sessionId = manager.registerSession(client);
      (manager as any).idMap.get(sessionId).runner = { cleanup: mockCleanup };

      await manager.unregisterSession(sessionId);

      expect(mockCleanup).toHaveBeenCalled();
      expect(manager.getSession(sessionId)).toBeNull();
    });

    it('handles missing runner gracefully', async () => {
      const client = createMockClient();
      const sessionId = manager.registerSession(client);

      await manager.unregisterSession(sessionId);

      expect(mockCleanup).not.toHaveBeenCalled();
      expect(manager.getSession(sessionId)).toBeNull();
    });

    it('handles cleanup errors without throwing', async () => {
      const client = createMockClient();
      const sessionId = manager.registerSession(client);
      (manager as any).idMap.get(sessionId).runner = { cleanup: vi.fn().mockRejectedValue(new Error('cleanup failed')) };

      await expect(manager.unregisterSession(sessionId)).resolves.toBeUndefined();
      expect(manager.getSession(sessionId)).toBeNull();
    });

    it('does nothing for nonexistent session', async () => {
      await manager.unregisterSession('nonexistent');
      expect(mockCleanup).not.toHaveBeenCalled();
    });
  });

  describe('getSessionsForConversation', () => {
    it('returns all sessions for a conversation', () => {
      const client1 = createMockClient();
      const client2 = createMockClient();
      const id1 = manager.registerSession(client1);
      const id2 = manager.registerSession(client2);
      const id3 = manager.registerSession(createMockClient());

      (manager as any).idMap.get(id1).conversationId = 'conv_test001';
      (manager as any).idMap.get(id2).conversationId = 'conv_test001';
      (manager as any).idMap.get(id3).conversationId = 'conv_other';

      const sessions = manager.getSessionsForConversation('conv_test001');
      expect(sessions).toHaveLength(2);
      expect(sessions.map((s) => s.id)).toContain(id1);
      expect(sessions.map((s) => s.id)).toContain(id2);
    });

    it('returns empty array when no sessions match', () => {
      expect(manager.getSessionsForConversation('nonexistent')).toEqual([]);
    });
  });
});
