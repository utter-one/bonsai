import 'reflect-metadata';
import { describe, it, beforeEach } from 'mocha';
import { expect } from 'chai';
import { ToolExecutor } from '../../../src/services/live/ToolExecutor';
import type { ConversationContext } from '../../../src/services/live/ConversationContextBuilder';
import type { Tool } from '../../../src/types/models';

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

function makeTool(overrides: Partial<Tool> = {}): Tool {
  return {
    id: 'tool_1',
    projectId: 'proj_1',
    name: 'TestTool',
    type: 'smart_function',
    prompt: 'You are a tool',
    llmProviderId: 'provider_1',
    llmSettings: { model: 'gpt-4' },
    outputType: 'text',
    parameters: [],
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    ...overrides,
  };
}

describe('ToolExecutor', () => {
  let executor: ToolExecutor;
  let templatingEngine: any;
  let contextBuilder: any;
  let scriptExecutor: any;
  let llmProviderFactory: any;

  beforeEach(() => {
    templatingEngine = { render: async (tpl: string) => tpl };
    contextBuilder = {};
    scriptExecutor = {
      executeScript: async (code: string, context: any, params: any) => ({
        value: { result: 'script_output' },
        flowControl: {},
        hasModifiedVars: false,
        hasModifiedUserInput: false,
        hasModifiedUserProfile: false,
      }),
    };
    llmProviderFactory = {
      createProvider: async () => ({
        generate: async () => ({
          content: [{ contentType: 'text', text: 'tool_result' }],
          usage: { inputTokens: 10, outputTokens: 5 },
        }),
        generateStream: async () => {},
        enumerateModels: async () => [],
        init: async () => {},
        cleanup: async () => {},
      }),
    };
    executor = new ToolExecutor(
      llmProviderFactory,
      templatingEngine,
      contextBuilder,
      scriptExecutor,
    );
  });

  describe('executeTool dispatch', () => {
    it('dispatches to script executor', async () => {
      const tool = makeTool({ type: 'script', code: 'return { ok: true };' });
      const context = makeContext();

      const result = await executor.executeTool(tool, context, {});

      expect(result.success).to.be.true;
      expect(result.result).to.deep.equal({ result: 'script_output' });
    });
  });

  describe('executeScriptTool', () => {
    it('returns success with script result', async () => {
      const tool = makeTool({ type: 'script', code: 'return { ok: true };' });
      const context = makeContext();

      const result = await executor.executeTool(tool, context, {});

      expect(result.success).to.be.true;
      expect(result.toolId).to.equal('tool_1');
      expect(result.durationMs).to.be.a('number');
    });

    it('throws when script has no code', async () => {
      const tool = makeTool({ type: 'script', code: null });
      const context = makeContext();

      try {
        await executor.executeTool(tool, context, {});
        expect.fail('Should have thrown');
      } catch (error) {
        expect((error as Error).message).to.include('does not have code configured');
      }
    });

    it('returns flow control from script', async () => {
      scriptExecutor = {
        executeScript: async () => ({
          value: null,
          flowControl: { goToStage: 'next_stage' },
          hasModifiedVars: true,
          hasModifiedUserInput: false,
          hasModifiedUserProfile: false,
        }),
      };
      executor = new ToolExecutor(
        llmProviderFactory, templatingEngine, contextBuilder, scriptExecutor,
      );
      const tool = makeTool({ type: 'script', code: 'flowControl.goToStage = "next_stage";' });
      const context = makeContext();

      const result = await executor.executeTool(tool, context, {});

      expect(result.success).to.be.true;
      expect(result.flowControl).to.deep.equal({ goToStage: 'next_stage' });
      expect(result.hasModifiedVars).to.be.true;
    });

    it('returns failure on script error', async () => {
      scriptExecutor = {
        executeScript: async () => { throw new Error('script failed'); },
      };
      executor = new ToolExecutor(
        llmProviderFactory, templatingEngine, contextBuilder, scriptExecutor,
      );
      const tool = makeTool({ type: 'script', code: 'throw new Error();' });
      const context = makeContext();

      const result = await executor.executeTool(tool, context, {});

      expect(result.success).to.be.false;
      expect(result.failureReason).to.equal('script failed');
    });
  });

  describe('executeSmartFunctionTool', () => {
    it('throws when no llmProviderId', async () => {
      const tool = makeTool({ llmProviderId: null });
      const context = makeContext();

      try {
        await executor.executeTool(tool, context, {});
        expect.fail('Should have thrown');
      } catch (error) {
        expect((error as Error).message).to.include('does not have an associated LLM provider');
      }
    });

    // Smart function tests require DB (providers table) — covered in integration tests
    // Unit tests focus on the validation path above
  });

  describe('executeWebhookTool', () => {
    it('throws when no URL configured', async () => {
      const tool = makeTool({ type: 'webhook', url: null });
      const context = makeContext();

      try {
        await executor.executeTool(tool, context, {});
        expect.fail('Should have thrown');
      } catch (error) {
        expect((error as Error).message).to.include('does not have a URL configured');
      }
    });

    // Webhook URL validation happens after templating engine render
    // Actual fetch tests require network — covered in integration tests
  });

  describe('getOutputFormat', () => {
    it('returns text for text output type', () => {
      const tool = makeTool({ outputType: 'text' });
      const format = (executor as any).getOutputFormat(tool);
      expect(format).to.equal('text');
    });

    it('returns image for image output type', () => {
      const tool = makeTool({ outputType: 'image' });
      const format = (executor as any).getOutputFormat(tool);
      expect(format).to.equal('image');
    });

    it('returns image for multi-modal output type', () => {
      const tool = makeTool({ outputType: 'multi-modal' });
      const format = (executor as any).getOutputFormat(tool);
      expect(format).to.equal('image');
    });

    it('defaults to text for unknown output type', () => {
      const tool = makeTool({ outputType: null });
      const format = (executor as any).getOutputFormat(tool);
      expect(format).to.equal('text');
    });
  });

  describe('extractImageMessages', () => {
    it('returns empty array for no image parameters', () => {
      const messages = (executor as any).extractImageMessages({ name: 'John' });
      expect(messages).to.have.length(0);
    });

    it('extracts single image parameter', () => {
      const messages = (executor as any).extractImageMessages({
        photo: { data: 'base64data', mimeType: 'image/png' },
      });
      expect(messages).to.have.length(1);
      expect(messages[0].role).to.equal('user');
    });

    it('extracts array of image parameters', () => {
      const messages = (executor as any).extractImageMessages({
        photos: [
          { data: 'base64_1', mimeType: 'image/png' },
          { data: 'base64_2', mimeType: 'image/jpeg' },
        ],
      });
      expect(messages).to.have.length(1);
      expect(messages[0].content).to.have.length(2);
    });

    it('skips mixed array with non-image values', () => {
      const messages = (executor as any).extractImageMessages({
        mixed: [
          { data: 'base64', mimeType: 'image/png' },
          'not an image',
        ],
      });
      expect(messages).to.have.length(0);
    });

    it('skips non-image MIME types', () => {
      const messages = (executor as any).extractImageMessages({
        file: { data: 'base64', mimeType: 'application/pdf' },
      });
      expect(messages).to.have.length(0);
    });
  });

  describe('isImageParameter', () => {
    it('returns true for valid image parameter', () => {
      const result = (executor as any).isImageParameter({ data: 'abc', mimeType: 'image/png' });
      expect(result).to.be.true;
    });

    it('returns false for non-image MIME type', () => {
      const result = (executor as any).isImageParameter({ data: 'abc', mimeType: 'text/plain' });
      expect(result).to.be.false;
    });

    it('returns false for null value', () => {
      const result = (executor as any).isImageParameter(null);
      expect(result).to.be.false;
    });

    it('returns false for string value', () => {
      const result = (executor as any).isImageParameter('hello');
      expect(result).to.be.false;
    });
  });
});
