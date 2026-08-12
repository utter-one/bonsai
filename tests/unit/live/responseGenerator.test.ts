import 'reflect-metadata';
import { describe, it, beforeEach } from 'mocha';
import { expect } from 'chai';
import { ResponseGenerator } from '../../../src/services/live/ResponseGenerator';
import type { ConversationContext } from '../../../src/services/live/ConversationContextBuilder';
import type { ILlmProvider, LlmMessage } from '../../../src/services/providers/llm/ILlmProvider';

function makeContext(overrides: Partial<ConversationContext> = {}): ConversationContext {
  return {
    conversationId: 'conv_test',
    projectId: 'proj_test',
    userId: 'user_test',
    vars: {},
    stageVars: {},
    userProfile: {},
    consts: {},
    history: [],
    events: [],
    actions: {},
    results: { tools: {}, webhooks: {} },
    stage: { id: 'stage_main', name: 'Main', availableActions: [], useKnowledge: false, enterBehavior: 'generate_response' },
    time: { iso: '2024-01-01T00:00:00.000+00:00', timestamp: 0, date: '2024-01-01', time: '00:00:00', dateTime: '2024-01-01 00:00:00', year: '2024', month: '01', day: '01', hour: '00', minute: '00', second: '00', monthName: 'January', monthNameShort: 'Jan', dayOfWeek: 'Friday', dayOfWeekShort: 'Fri', timezone: 'UTC', offset: '+00:00', nextMonday: '2024-01-08', nextTuesday: '2024-01-09', nextWednesday: '2024-01-10', nextThursday: '2024-01-11', nextFriday: '2024-01-12', nextSaturday: '2024-01-13', nextSunday: '2024-01-14', calendar: [], anchor: '' },
    project: { timezone: 'UTC', languageCode: 'en', language: 'English' },
    channel: 'websocket' as any,
    ...overrides,
  };
}

function makeStage(overrides: Partial<any> = {}): any {
  return {
    id: 'stage_main',
    name: 'Main',
    actions: {},
    useKnowledge: false,
    enterBehavior: 'generate_response',
    ...overrides,
  };
}

function makeMockProvider(): ILlmProvider {
  return {
    generate: async () => ({ content: 'response', usage: { inputTokens: 10, outputTokens: 5 } }),
    generateStream: async () => {},
    enumerateModels: async () => [],
    init: async () => {},
    cleanup: async () => {},
  } as any;
}

describe('ResponseGenerator', () => {
  let generator: ResponseGenerator;
  let mockProvider: ILlmProvider;
  let templatingEngine: any;

  beforeEach(() => {
    templatingEngine = { render: async (tpl: string) => tpl };
    generator = new ResponseGenerator(templatingEngine);
    mockProvider = makeMockProvider();
  });

  describe('message ordering', () => {
    it('builds messages with system prompt first', async () => {
      const capturedMessages: LlmMessage[] = [];
      mockProvider.generateStream = async (messages: LlmMessage[]) => {
        capturedMessages.push(...messages);
      };

      const context = makeContext({ userInput: 'hello' });

      await generator.generateResponse(context, makeStage(), 'You are a bot', mockProvider);

      expect(capturedMessages[0].role).to.equal('system');
      expect(capturedMessages[0].content).to.equal('You are a bot');
    });

    it('includes history between system and user message', async () => {
      const capturedMessages: LlmMessage[] = [];
      mockProvider.generateStream = async (messages: LlmMessage[]) => {
        capturedMessages.push(...messages);
      };

      const context = makeContext({
        userInput: 'hello',
        history: [
          { role: 'user', content: 'previous question' },
          { role: 'assistant', content: 'previous answer' },
        ],
      });

      await generator.generateResponse(context, makeStage(), 'prompt', mockProvider);

      expect(capturedMessages).to.have.length(4);
      expect(capturedMessages[0].role).to.equal('system');
      expect(capturedMessages[1].role).to.equal('user');
      expect(capturedMessages[1].content).to.equal('previous question');
      expect(capturedMessages[2].role).to.equal('assistant');
      expect(capturedMessages[2].content).to.equal('previous answer');
    });

    it('includes user input as last message', async () => {
      const capturedMessages: LlmMessage[] = [];
      mockProvider.generateStream = async (messages: LlmMessage[]) => {
        capturedMessages.push(...messages);
      };

      const context = makeContext({ userInput: 'hello' });

      await generator.generateResponse(context, makeStage(), 'prompt', mockProvider);

      expect(capturedMessages.at(-1).role).to.equal('user');
      expect(capturedMessages.at(-1).content).to.equal('hello');
    });

    it('appends assistant prefix after user message', async () => {
      const capturedMessages: LlmMessage[] = [];
      mockProvider.generateStream = async (messages: LlmMessage[]) => {
        capturedMessages.push(...messages);
      };

      const context = makeContext({ userInput: 'hello' });

      await generator.generateResponse(context, makeStage(), 'prompt', mockProvider, 'Let me help...');

      expect(capturedMessages.at(-1).role).to.equal('assistant');
      expect(capturedMessages.at(-1).content).to.equal('Let me help...');
    });

    it('uses --- placeholder when userInput is null', async () => {
      const capturedMessages: LlmMessage[] = [];
      mockProvider.generateStream = async (messages: LlmMessage[]) => {
        capturedMessages.push(...messages);
      };

      const context = makeContext({ userInput: undefined });

      await generator.generateResponse(context, makeStage(), 'prompt', mockProvider);

      expect(capturedMessages.at(-1).role).to.equal('user');
      expect(capturedMessages.at(-1).content).to.equal('---');
    });
  });

  describe('duplicate user message removal', () => {
    it('removes trailing user message from history when userInput is set', async () => {
      const capturedMessages: LlmMessage[] = [];
      mockProvider.generateStream = async (messages: LlmMessage[]) => {
        capturedMessages.push(...messages);
      };

      const context = makeContext({
        userInput: 'hello',
        history: [
          { role: 'user', content: 'hello' },
        ],
      });

      await generator.generateResponse(context, makeStage(), 'prompt', mockProvider);

      // Should have system + user (not duplicated)
      expect(capturedMessages).to.have.length(2);
    });

    it('keeps trailing assistant message in history', async () => {
      const capturedMessages: LlmMessage[] = [];
      mockProvider.generateStream = async (messages: LlmMessage[]) => {
        capturedMessages.push(...messages);
      };

      const context = makeContext({
        userInput: 'hello',
        history: [
          { role: 'assistant', content: 'previous' },
        ],
      });

      await generator.generateResponse(context, makeStage(), 'prompt', mockProvider);

      // system + assistant (history) + user (input)
      expect(capturedMessages).to.have.length(3);
    });

    it('keeps non-trailing user message in history', async () => {
      const capturedMessages: LlmMessage[] = [];
      mockProvider.generateStream = async (messages: LlmMessage[]) => {
        capturedMessages.push(...messages);
      };

      const context = makeContext({
        userInput: 'hello again',
        history: [
          { role: 'user', content: 'hello' },
          { role: 'assistant', content: 'hi' },
        ],
      });

      await generator.generateResponse(context, makeStage(), 'prompt', mockProvider);

      // system + user (hello) + assistant (hi) + user (hello again)
      expect(capturedMessages).to.have.length(4);
    });
  });

  describe('context truncation integration', () => {
    it('calls truncateMessagesToTokenBudget with inputTokenCap', async () => {
      const capturedTruncation: any = [];
      const capturedMessages: LlmMessage[] = [];
      mockProvider.generateStream = async (messages: LlmMessage[]) => {
        capturedMessages.push(...messages);
      };

      const context = makeContext({ userInput: 'hello' });

      await generator.generateResponse(context, makeStage(), 'prompt', mockProvider, undefined, undefined, 500, 'gpt-4', (info) => {
        capturedTruncation.push(info);
      });

      expect(capturedTruncation).to.have.length(1);
    });

    it('calls onTruncation callback', async () => {
      let truncationCalled = false;
      const context = makeContext({ userInput: 'hello' });

      await generator.generateResponse(context, makeStage(), 'prompt', mockProvider, undefined, undefined, 500, 'gpt-4', (info) => {
        truncationCalled = true;
      });

      expect(truncationCalled).to.be.true;
    });

    it('passes maxTokens to generateStream when provided', async () => {
      let capturedOptions: any = null;
      mockProvider.generateStream = async (_messages: LlmMessage[], options: any) => {
        capturedOptions = options;
      };

      const context = makeContext({ userInput: 'hello' });

      await generator.generateResponse(context, makeStage(), 'prompt', mockProvider, undefined, 1000);

      expect(capturedOptions.maxTokens).to.equal(1000);
    });

    it('passes empty options when maxTokens is undefined', async () => {
      let capturedOptions: any = null;
      mockProvider.generateStream = async (_messages: LlmMessage[], options: any) => {
        capturedOptions = options;
      };

      const context = makeContext({ userInput: 'hello' });

      await generator.generateResponse(context, makeStage(), 'prompt', mockProvider);

      expect(capturedOptions).to.deep.equal({});
    });
  });

  describe('streaming callback wiring', () => {
    it('calls generateStream on the provider', async () => {
      let streamCalled = false;
      mockProvider.generateStream = async () => {
        streamCalled = true;
      };

      const context = makeContext({ userInput: 'hello' });

      await generator.generateResponse(context, makeStage(), 'prompt', mockProvider);

      expect(streamCalled).to.be.true;
    });
  });
});
