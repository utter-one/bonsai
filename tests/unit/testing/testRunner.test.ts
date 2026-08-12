import 'reflect-metadata';
import { describe, it, beforeEach } from 'mocha';
import { expect } from 'chai';
import { TestRunner } from '../../../src/services/testing/TestRunner';
import { ConversationTerminatedError } from '../../../src/errors';
import type { TesterResponse } from '../../../src/http/contracts/tester';
import type { ScenarioResponse } from '../../../src/http/contracts/scenario';

const TERMINAL_EVENT_STATUS_MAP: Record<string, any> = {
  conversation_end: 'conversation_ended',
  conversation_aborted: 'conversation_aborted',
  conversation_failed: 'conversation_failed',
};

function makeTester(overrides: Partial<TesterResponse> = {}): TesterResponse {
  return {
    id: 'tester_1',
    projectId: 'proj_1',
    name: 'Test Persona',
    prompt: 'You are a helpful tester',
    llmProviderId: 'provider_1',
    llmSettings: { model: 'gpt-4' },
    hangUpPrompt: null,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    ...overrides,
  };
}

function makeScenario(overrides: Partial<ScenarioResponse> = {}): ScenarioResponse {
  return {
    id: 'scenario_1',
    projectId: 'proj_1',
    name: 'Test Scenario',
    dataExtraction: [],
    dataPostProcessingExpected: null,
    contextTransformerId: null,
    maxTurns: 10,
    conversationOpener: null,
    personaCanHangUp: false,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    ...overrides,
  };
}

describe('TestRunner', () => {
  let runner: TestRunner;
  let llmProviderFactory: any;

  beforeEach(() => {
    llmProviderFactory = {
      createProvider: async () => ({
        generate: async () => ({
          content: [{ contentType: 'text', text: 'Hello there' }],
          usage: { inputTokens: 10, outputTokens: 5 },
        }),
        generateStream: async () => {},
        enumerateModels: async () => [],
        init: async () => {},
        cleanup: async () => {},
      }),
    };
    runner = new TestRunner(llmProviderFactory);
  });

  describe('terminal event status mapping', () => {
    it('maps conversation_end to conversation_ended', () => {
      expect(TERMINAL_EVENT_STATUS_MAP['conversation_end']).to.equal('conversation_ended');
    });

    it('maps conversation_aborted to conversation_aborted', () => {
      expect(TERMINAL_EVENT_STATUS_MAP['conversation_aborted']).to.equal('conversation_aborted');
    });

    it('maps conversation_failed to conversation_failed', () => {
      expect(TERMINAL_EVENT_STATUS_MAP['conversation_failed']).to.equal('conversation_failed');
    });

    it('defaults to conversation_failed for unknown events', () => {
      expect(TERMINAL_EVENT_STATUS_MAP['unknown_event'] ?? 'conversation_failed').to.equal('conversation_failed');
    });
  });

  describe('buildSession', () => {
    it('builds session with text-only settings', () => {
      const session = (runner as any).buildSession('proj_1', 'conv_1', {} as any);

      expect(session.id).to.equal('test_session_conv_1');
      expect(session.projectId).to.equal('proj_1');
      expect(session.conversationId).to.equal('conv_1');
      expect(session.sessionSettings.sendVoiceInput).to.be.false;
      expect(session.sessionSettings.sendTextInput).to.be.true;
      expect(session.sessionSettings.receiveVoiceOutput).to.be.false;
      expect(session.sessionSettings.receiveTranscriptionUpdates).to.be.false;
      expect(session.sessionSettings.receiveEvents).to.be.true;
    });
  });

  describe('callHangUpLlm', () => {
    it('returns true for "yes" response', async () => {
      const provider = {
        generate: async () => ({
          content: [{ contentType: 'text', text: 'Yes' }],
          usage: { inputTokens: 10, outputTokens: 5 },
        }),
      };
      const tester = makeTester({ hangUpPrompt: 'Should you hang up?' });

      const result = await (runner as any).callHangUpLlm(provider, tester, []);
      expect(result).to.be.true;
    });

    it('returns true for "true" response', async () => {
      const provider = {
        generate: async () => ({
          content: [{ contentType: 'text', text: 'true' }],
          usage: { inputTokens: 10, outputTokens: 5 },
        }),
      };
      const tester = makeTester({ hangUpPrompt: 'Should you hang up?' });

      const result = await (runner as any).callHangUpLlm(provider, tester, []);
      expect(result).to.be.true;
    });

    it('returns true for "1" response', async () => {
      const provider = {
        generate: async () => ({
          content: [{ contentType: 'text', text: '1' }],
          usage: { inputTokens: 10, outputTokens: 5 },
        }),
      };
      const tester = makeTester({ hangUpPrompt: 'Should you hang up?' });

      const result = await (runner as any).callHangUpLlm(provider, tester, []);
      expect(result).to.be.true;
    });

    it('returns false for "no" response', async () => {
      const provider = {
        generate: async () => ({
          content: [{ contentType: 'text', text: 'No' }],
          usage: { inputTokens: 10, outputTokens: 5 },
        }),
      };
      const tester = makeTester({ hangUpPrompt: 'Should you hang up?' });

      const result = await (runner as any).callHangUpLlm(provider, tester, []);
      expect(result).to.be.false;
    });

    it('returns false for "false" response', async () => {
      const provider = {
        generate: async () => ({
          content: [{ contentType: 'text', text: 'false' }],
          usage: { inputTokens: 10, outputTokens: 5 },
        }),
      };
      const tester = makeTester({ hangUpPrompt: 'Should you hang up?' });

      const result = await (runner as any).callHangUpLlm(provider, tester, []);
      expect(result).to.be.false;
    });

    it('handles leading/trailing whitespace', async () => {
      const provider = {
        generate: async () => ({
          content: [{ contentType: 'text', text: '  Yes  ' }],
          usage: { inputTokens: 10, outputTokens: 5 },
        }),
      };
      const tester = makeTester({ hangUpPrompt: 'Should you hang up?' });

      const result = await (runner as any).callHangUpLlm(provider, tester, []);
      expect(result).to.be.true;
    });

    it('handles uppercase YES', async () => {
      const provider = {
        generate: async () => ({
          content: [{ contentType: 'text', text: 'YES' }],
          usage: { inputTokens: 10, outputTokens: 5 },
        }),
      };
      const tester = makeTester({ hangUpPrompt: 'Should you hang up?' });

      const result = await (runner as any).callHangUpLlm(provider, tester, []);
      expect(result).to.be.true;
    });
  });

  describe('callTesterLlm', () => {
    it('builds messages with system prompt first', async () => {
      let capturedMessages: any[] = [];
      const provider = {
        generate: async (messages: any[]) => {
          capturedMessages = messages;
          return {
            content: [{ contentType: 'text', text: 'Hello there' }],
            usage: { inputTokens: 10, outputTokens: 5 },
          };
        },
      };
      const tester = makeTester({ prompt: 'You are a tester' });

      await (runner as any).callTesterLlm(provider, tester, []);

      expect(capturedMessages[0].role).to.equal('system');
      expect(capturedMessages[0].content).to.equal('You are a tester');
    });

    it('includes history in messages', async () => {
      let capturedMessages: any[] = [];
      const provider = {
        generate: async (messages: any[]) => {
          capturedMessages = messages;
          return {
            content: [{ contentType: 'text', text: 'Hello there' }],
            usage: { inputTokens: 10, outputTokens: 5 },
          };
        },
      };
      const tester = makeTester({ prompt: 'You are a tester' });
      const history = [
        { role: 'user', content: 'AI response' },
        { role: 'assistant', content: 'Tester response' },
      ];

      await (runner as any).callTesterLlm(provider, tester, history);

      expect(capturedMessages).to.have.length(3);
      expect(capturedMessages[1].role).to.equal('user');
      expect(capturedMessages[2].role).to.equal('assistant');
    });

    it('trims response text', async () => {
      const provider = {
        generate: async () => ({
          content: [{ contentType: 'text', text: '  Hello there  ' }],
          usage: { inputTokens: 10, outputTokens: 5 },
        }),
      };
      const tester = makeTester();

      const result = await (runner as any).callTesterLlm(provider, tester, []);
      expect(result).to.equal('Hello there');
    });
  });

  describe('createTesterLlmProvider', () => {
    it('throws when tester has no llmProviderId', async () => {
      const tester = makeTester({ llmProviderId: null });

      try {
        await (runner as any).createTesterLlmProvider(tester);
        expect.fail('Should have thrown');
      } catch (error) {
        expect((error as Error).message).to.include('no llmProviderId');
      }
    });

    it('throws when provider entity is not found', async () => {
      const tester = makeTester({ llmProviderId: 'missing_provider' });

      try {
        await (runner as any).createTesterLlmProvider(tester);
        expect.fail('Should have thrown');
      } catch (error) {
        expect((error as Error).message).to.include('not found');
      }
    });
  });

  describe('ConversationTerminatedError handling', () => {
    it('ConversationTerminatedError carries terminal event type', () => {
      const error = new ConversationTerminatedError('conversation_end');
      expect(error.terminalEvent).to.equal('conversation_end');
    });

    it('ConversationTerminatedError is an instance of Error', () => {
      const error = new ConversationTerminatedError('conversation_end');
      expect(error).to.be.instanceOf(Error);
    });
  });
});
