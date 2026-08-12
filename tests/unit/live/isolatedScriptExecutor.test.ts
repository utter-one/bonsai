import 'reflect-metadata';
import { expect } from 'chai';
import { IsolatedScriptExecutor } from '../../../src/services/live/IsolatedScriptExecutor';
import type { ConversationContext } from '../../../src/services/live/ConversationContextBuilder';

/** Build a minimal ConversationContext for testing */
function buildContext(overrides?: Partial<ConversationContext>): ConversationContext {
  return {
    conversationId: 'conv_test',
    projectId: 'proj_test',
    userId: 'user_test',
    stage: { id: 'stage_test', name: 'Test Stage', availableActions: [], metadata: null, enterBehavior: null, useKnowledge: false },
    vars: {},
    stageVars: {},
    userProfile: {},
    userInput: 'hello',
    originalUserInput: 'hello',
    history: [],
    events: [],
    actions: [],
    results: {},
    time: { iso: '2024-01-01T00:00:00Z', date: '2024-01-01', time: '00:00:00', dayOfWeek: 'Friday', timezone: 'UTC', calendar: {} as any, anchor: {} as any },
    channel: 'websocket' as any,
    project: { timezone: 'UTC', languageCode: 'en', language: 'English' },
    consts: {},
    ...overrides,
  };
}

describe('IsolatedScriptExecutor', () => {
  let executor: IsolatedScriptExecutor;

  beforeEach(() => {
    executor = new IsolatedScriptExecutor();
  });

  describe('basic script execution', () => {
    it('executes simple expressions', async () => {
      const context = buildContext();
      const result = await executor.executeScript('1 + 2', context);

      expect(result.value).to.equal(3);
    });

    it('executes string concatenation', async () => {
      const context = buildContext();
      const result = await executor.executeScript('"hello" + " " + "world"', context);

      expect(result.value).to.equal('hello world');
    });

    it('executes array operations and returns length', async () => {
      const context = buildContext();
      const result = await executor.executeScript(`
        var arr = [1, 2, 3];
        var doubled = [];
        for (var i = 0; i < arr.length; i++) { doubled.push(arr[i] * 2); }
        doubled.length;
      `, context);

      expect(result.value).to.equal(3);
    });

    it('executes object literals and returns property', async () => {
      const context = buildContext();
      const result = await executor.executeScript(`
        var obj = { foo: "bar", count: 42 };
        obj.count;
      `, context);

      expect(result.value).to.equal(42);
    });

    it('executes conditional expressions', async () => {
      const context = buildContext();
      const result = await executor.executeScript('true ? "yes" : "no"', context);

      expect(result.value).to.equal('yes');
    });

    it('executes loops', async () => {
      const context = buildContext();
      const result = await executor.executeScript(`
        var sum = 0;
        for (var i = 0; i < 10; i++) { sum += i; }
        sum;
      `, context);

      expect(result.value).to.equal(45);
    });

    it('executes function definitions', async () => {
      const context = buildContext();
      const result = await executor.executeScript(`
        function double(x) { return x * 2; }
        double(21);
      `, context);

      expect(result.value).to.equal(42);
    });

    it('returns undefined for void statements', async () => {
      const context = buildContext();
      const result = await executor.executeScript('var x = 5;', context);

      expect(result.value).to.be.undefined;
    });
  });

  describe('read-only context injection', () => {
    it('exposes conversationId', async () => {
      const context = buildContext({ conversationId: 'conv_123' });
      const result = await executor.executeScript('conversationId', context);

      expect(result.value).to.equal('conv_123');
    });

    it('exposes projectId', async () => {
      const context = buildContext({ projectId: 'proj_456' });
      const result = await executor.executeScript('projectId', context);

      expect(result.value).to.equal('proj_456');
    });

    it('exposes stageId', async () => {
      const context = buildContext();
      const result = await executor.executeScript('stageId', context);

      expect(result.value).to.equal('stage_test');
    });

    it('exposes stage object', async () => {
      const context = buildContext();
      const result = await executor.executeScript('stage.name', context);

      expect(result.value).to.equal('Test Stage');
    });

    it('exposes history', async () => {
      const context = buildContext({
        history: [
          { role: 'user', content: 'hi' },
          { role: 'assistant', content: 'hello' },
        ],
      });
      const result = await executor.executeScript('history.length', context);

      expect(result.value).to.equal(2);
    });

    it('exposes results', async () => {
      const context = buildContext({
        results: {
          tools: { tool_1: { result: 'data' } },
        },
      });
      const result = await executor.executeScript('results.tools.tool_1.result', context);

      expect(result.value).to.equal('data');
    });

    it('exposes originalUserInput', async () => {
      const context = buildContext({ originalUserInput: 'original text' });
      const result = await executor.executeScript('originalUserInput', context);

      expect(result.value).to.equal('original text');
    });

    it('exposes time context', async () => {
      const context = buildContext();
      const result = await executor.executeScript('time.iso', context);

      expect(result.value).to.equal('2024-01-01T00:00:00Z');
    });

    it('exposes channel', async () => {
      const context = buildContext({ channel: 'telegram' as any });
      const result = await executor.executeScript('channel', context);

      expect(result.value).to.equal('telegram');
    });

    it('exposes project settings', async () => {
      const context = buildContext({ project: { timezone: 'Europe/Warsaw', languageCode: 'pl', language: 'Polish' } });
      const result = await executor.executeScript('project.timezone', context);

      expect(result.value).to.equal('Europe/Warsaw');
    });

    it('exposes stageVars', async () => {
      const context = buildContext({ stageVars: { stage_test: { foo: 'bar' } } });
      const result = await executor.executeScript('stageVars.stage_test.foo', context);

      expect(result.value).to.equal('bar');
    });

    it('exposes consts', async () => {
      const context = buildContext({ consts: { api_key: 'secret' } });
      const result = await executor.executeScript('consts.api_key', context);

      expect(result.value).to.equal('secret');
    });
  });

  describe('mutable context', () => {
    it('allows modifying vars', async () => {
      const context = buildContext({ vars: { count: 0 } });
      await executor.executeScript('vars.count = 42;', context);

      expect(context.vars.count).to.equal(42);
    });

    it('allows deleting vars keys', async () => {
      const context = buildContext({ vars: { foo: 'bar', baz: 'qux' } });
      await executor.executeScript('delete vars.foo;', context);

      expect(context.vars.foo).to.be.undefined;
      expect(context.vars.baz).to.equal('qux');
    });

    it('allows modifying userProfile', async () => {
      const context = buildContext({ userProfile: { name: 'Alice' } });
      await executor.executeScript('userProfile.name = "Bob";', context);

      expect(context.userProfile.name).to.equal('Bob');
    });

    it('allows modifying userInput', async () => {
      const context = buildContext({ userInput: 'hello' });
      await executor.executeScript('userInput = "modified";', context);

      expect(context.userInput).to.equal('modified');
    });

    it('allows setting userInput to null', async () => {
      const context = buildContext({ userInput: 'hello' });
      await executor.executeScript('userInput = null;', context);

      expect(context.userInput).to.be.null;
    });

    it('reports hasModifiedVars when vars changed', async () => {
      const context = buildContext({ vars: { count: 0 } });
      const result = await executor.executeScript('vars.count = 42;', context);

      expect(result.hasModifiedVars).to.be.true;
    });

    it('reports hasModifiedUserInput when userInput changed', async () => {
      const context = buildContext({ userInput: 'hello' });
      const result = await executor.executeScript('userInput = "modified";', context);

      expect(result.hasModifiedUserInput).to.be.true;
    });

    it('reports hasModifiedUserProfile when userProfile changed', async () => {
      const context = buildContext({ userProfile: { name: 'Alice' } });
      const result = await executor.executeScript('userProfile.name = "Bob";', context);

      expect(result.hasModifiedUserProfile).to.be.true;
    });

    it('reports false when nothing changed', async () => {
      const context = buildContext();
      const result = await executor.executeScript('1 + 2', context);

      expect(result.hasModifiedVars).to.be.false;
      expect(result.hasModifiedUserInput).to.be.false;
      expect(result.hasModifiedUserProfile).to.be.false;
    });
  });

  describe('utility functions', () => {
    it('provides uuid() function', async () => {
      const context = buildContext();
      const result = await executor.executeScript('uuid()', context);

      // UUID v4 format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
      expect(result.value).to.match(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    });

    it('provides formatDate() function', async () => {
      const context = buildContext();
      const result = await executor.executeScript('formatDate("2024-01-01T00:00:00Z", "en-US")', context);

      expect(result.value).to.be.a('string');
    });

    it('provides formatDate() with options', async () => {
      const context = buildContext();
      const result = await executor.executeScript(
        'formatDate("2024-01-01T00:00:00Z", "en-US", { year: "numeric", month: "long", day: "numeric" })',
        context,
      );

      expect(result.value).to.equal('January 1, 2024');
    });
  });

  describe('history utility functions', () => {
    it('lastMessage() returns last message content', async () => {
      const context = buildContext({
        history: [
          { role: 'user', content: 'hi' },
          { role: 'assistant', content: 'hello' },
        ],
      });
      const result = await executor.executeScript('lastMessage()', context);

      expect(result.value).to.equal('hello');
    });

    it('lastMessage(role) filters by role', async () => {
      const context = buildContext({
        history: [
          { role: 'user', content: 'hi' },
          { role: 'assistant', content: 'hello' },
          { role: 'user', content: 'bye' },
        ],
      });
      const result = await executor.executeScript('lastMessage("assistant")', context);

      expect(result.value).to.equal('hello');
    });

    it('messageCount() returns total count', async () => {
      const context = buildContext({
        history: [
          { role: 'user', content: 'hi' },
          { role: 'assistant', content: 'hello' },
        ],
      });
      const result = await executor.executeScript('messageCount()', context);

      expect(result.value).to.equal(2);
    });

    it('messageCount(role) filters by role', async () => {
      const context = buildContext({
        history: [
          { role: 'user', content: 'hi' },
          { role: 'assistant', content: 'hello' },
          { role: 'user', content: 'bye' },
        ],
      });
      const result = await executor.executeScript('messageCount("user")', context);

      expect(result.value).to.equal(2);
    });

    it('historyContains() does case-insensitive search', async () => {
      const context = buildContext({
        history: [
          { role: 'user', content: 'Hello World' },
        ],
      });
      const result = await executor.executeScript('historyContains("hello")', context);

      expect(result.value).to.be.true;
    });

    it('historyContains() returns false for missing text', async () => {
      const context = buildContext({
        history: [
          { role: 'user', content: 'Hello World' },
        ],
      });
      const result = await executor.executeScript('historyContains("not here")', context);

      expect(result.value).to.be.false;
    });
  });

  describe('flow control signals', () => {
    it('goToStage() sets flow control', async () => {
      const context = buildContext();
      const result = await executor.executeScript('goToStage("next_stage"); "done";', context);

      expect(result.flowControl.goToStageId).to.equal('next_stage');
    });

    it('endConversation() sets flow control', async () => {
      const context = buildContext();
      const result = await executor.executeScript('endConversation("finished"); "done";', context);

      expect(result.flowControl.shouldEndConversation).to.be.true;
      expect(result.flowControl.endReason).to.equal('finished');
    });

    it('abortConversation() sets flow control', async () => {
      const context = buildContext();
      const result = await executor.executeScript('abortConversation("error"); "done";', context);

      expect(result.flowControl.shouldAbortConversation).to.be.true;
      expect(result.flowControl.abortReason).to.equal('error');
    });

    it('prescriptResponse() sets flow control', async () => {
      const context = buildContext();
      const result = await executor.executeScript('prescriptResponse("Fixed response"); "done";', context);

      expect(result.flowControl.shouldGenerateResponse).to.be.true;
      expect(result.flowControl.prescriptedResponse).to.equal('Fixed response');
    });

    it('suppressResponse() sets flow control', async () => {
      const context = buildContext();
      const result = await executor.executeScript('suppressResponse(); "done";', context);

      expect(result.flowControl.shouldGenerateResponse).to.be.false;
    });
  });

  describe('console output', () => {
    it('captures console.log', async () => {
      const context = buildContext();
      // console.log is captured via ivm callbacks and logged to pino; we can't easily
      // intercept pino output, but we can verify the script doesn't crash
      const result = await executor.executeScript('console.log("test"); "done";', context);

      expect(result.value).to.equal('done');
    });
  });

  describe('security and error handling', () => {
    it('handles syntax errors gracefully', async () => {
      const context = buildContext();
      const result = await executor.executeScript('this is not valid js', context);

      expect(result.value).to.be.undefined;
      expect(result.flowControl).to.deep.equal({});
    });

    it('handles runtime errors gracefully', async () => {
      const context = buildContext();
      const result = await executor.executeScript('undefinedMethod()', context);

      expect(result.value).to.be.undefined;
    });

    it('does not expose Node.js require', async () => {
      const context = buildContext();
      const result = await executor.executeScript('typeof require', context);

      expect(result.value).to.equal('undefined');
    });

    it('does not expose process', async () => {
      const context = buildContext();
      const result = await executor.executeScript('typeof process', context);

      expect(result.value).to.equal('undefined');
    });

    it('does not expose fs module', async () => {
      const context = buildContext();
      const result = await executor.executeScript('typeof fs', context);

      expect(result.value).to.equal('undefined');
    });

    it('times out on long-running scripts', async () => {
      const context = buildContext();
      const result = await executor.executeScript(`
        while (true) {}
      `, context);

      // Script should time out and return undefined
      expect(result.value).to.be.undefined;
      expect(result.hasModifiedVars).to.be.false;
    });

    it('does not crash on memory-heavy scripts', async () => {
      const context = buildContext();
      const result = await executor.executeScript(`
        var arr = [];
        for (var i = 0; i < 1000000; i++) { arr.push(i); }
        arr.length;
      `, context);

      // Should either succeed or fail gracefully without crashing
      expect(result.value).to.be.oneOf([1000000, undefined]);
    });
  });

  describe('tool parameters', () => {
    it('injects tool parameters as params', async () => {
      const context = buildContext();
      const result = await executor.executeScript('params.input', context, { input: 'test value' });

      expect(result.value).to.equal('test value');
    });

    it('params is undefined when no tool parameters provided', async () => {
      const context = buildContext();
      const result = await executor.executeScript('typeof params', context);

      expect(result.value).to.equal('undefined');
    });
  });

  describe('conditional visibility evaluation', () => {
    it('evaluates simple boolean conditions', async () => {
      const context = buildContext();
      const result = await executor.executeScript('true', context);

      expect(result.value).to.be.true;
    });

    it('evaluates conditions with vars', async () => {
      const context = buildContext({ vars: { count: 5 } });
      const result = await executor.executeScript('vars.count > 3', context);

      expect(result.value).to.be.true;
    });

    it('evaluates conditions with history', async () => {
      const context = buildContext({
        history: [
          { role: 'user', content: 'hello' },
          { role: 'assistant', content: 'hi' },
        ],
      });
      const result = await executor.executeScript('history.length >= 2', context);

      expect(result.value).to.be.true;
    });

    it('evaluates conditions with stageVars', async () => {
      const context = buildContext({ stageVars: { stage_test: { visited: true } } });
      const result = await executor.executeScript('stageVars.stage_test.visited === true', context);

      expect(result.value).to.be.true;
    });

    it('evaluates conditions with channel', async () => {
      const context = buildContext({ channel: 'telegram' as any });
      const result = await executor.executeScript('channel === "telegram"', context);

      expect(result.value).to.be.true;
    });

    it('evaluates complex conditions', async () => {
      const context = buildContext({ vars: { count: 5 }, channel: 'websocket' as any });
      const result = await executor.executeScript('vars.count > 3 && channel === "websocket"', context);

      expect(result.value).to.be.true;
    });
  });
});
