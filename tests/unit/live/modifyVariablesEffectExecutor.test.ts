import 'reflect-metadata';
import { describe, it, beforeEach } from 'mocha';
import { expect } from 'chai';
import { ModifyVariablesEffectExecutor } from '../../../src/services/live/ModifyVariablesEffectExecutor';
import type { ConversationContext } from '../../../src/services/live/ConversationContextBuilder';
import type { IsolatedScriptExecutor, ScriptExecutionResult } from '../../../src/services/live/IsolatedScriptExecutor';
import type { TemplatingEngine } from '../../../src/services/live/TemplatingEngine';
import type { ModifyVariablesEffect } from '../../../src/types/actions';

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
    results: { tools: {} },
    stage: { id: 'stage_test', name: 'Test Stage', actions: {} },
    ...overrides,
  };
}

function makeMockScriptRunner(resultValue: any): IsolatedScriptExecutor {
  return {
    executeScript: async (_code: string, _context: ConversationContext): Promise<ScriptExecutionResult> => ({
      value: resultValue,
      flowControl: {},
      hasModifiedVars: false,
      hasModifiedUserInput: false,
      hasModifiedUserProfile: false,
    }),
  } as any;
}

function makeMockTemplatingEngine(renderResult: string): TemplatingEngine {
  return {
    render: async (_template: string, _context: ConversationContext): Promise<string> => renderResult,
    clearCache: () => {},
    getCacheStats: () => ({ size: 0, maxSize: 1000 }),
  } as any;
}

function makeEffect(modifications: ModifyVariablesEffect['modifications']): ModifyVariablesEffect {
  return { type: 'modify_variables', modifications };
}

describe('ModifyVariablesEffectExecutor', () => {
  let executor: ModifyVariablesEffectExecutor;
  let scriptRunner: IsolatedScriptExecutor;
  let templatingEngine: TemplatingEngine;

  beforeEach(() => {
    scriptRunner = makeMockScriptRunner('script_result');
    templatingEngine = makeMockTemplatingEngine('template_result');
    executor = new ModifyVariablesEffectExecutor(scriptRunner, templatingEngine);
  });

  describe('set operation', () => {
    it('sets a variable with string value via {{vars.*}} pattern', async () => {
      const context = makeContext({ vars: { sourceName: 'Alice' } });
      const effect = makeEffect([{ variableName: 'name', operation: 'set', value: '{{vars.sourceName}}' }]);
      const outcome = await executor.execute(effect, context);

      expect(context.vars['name']).to.equal('Alice');
      expect(outcome.hasModifiedVars).to.equal(true);
    });

    it('sets a variable with plain string (goes through templating engine)', async () => {
      const context = makeContext({ vars: {} });
      const effect = makeEffect([{ variableName: 'greeting', operation: 'set', value: 'Hello' }]);
      const outcome = await executor.execute(effect, context);

      expect(context.vars['greeting']).to.equal('template_result');
      expect(outcome.hasModifiedVars).to.equal(true);
    });

    it('sets a variable with number value', async () => {
      const context = makeContext({ vars: {} });
      const effect = makeEffect([{ variableName: 'count', operation: 'set', value: 42 }]);
      const outcome = await executor.execute(effect, context);

      expect(context.vars['count']).to.equal(42);
      expect(outcome.hasModifiedVars).to.equal(true);
    });

    it('sets a variable with object value', async () => {
      const context = makeContext({ vars: {} });
      const effect = makeEffect([{ variableName: 'data', operation: 'set', value: { x: 1 } }]);
      const outcome = await executor.execute(effect, context);

      expect(context.vars['data']).to.deep.equal({ x: 1 });
      expect(outcome.hasModifiedVars).to.equal(true);
    });

    it('overwrites existing variable', async () => {
      const context = makeContext({ vars: { name: 'Old' } });
      const effect = makeEffect([{ variableName: 'name', operation: 'set', value: 99 }]);
      await executor.execute(effect, context);

      expect(context.vars['name']).to.equal(99);
    });

    it('applies value transformation for {{vars.*}} pattern', async () => {
      const context = makeContext({ vars: { source: 'fromSource' } });
      const effect = makeEffect([{ variableName: 'target', operation: 'set', value: '{{vars.source}}' }]);
      await executor.execute(effect, context);

      expect(context.vars['target']).to.equal('fromSource');
    });

    it('applies value transformation for {{results.tools.*}} pattern', async () => {
      const context = makeContext({ results: { tools: { weather: { result: 'Sunny' } } } });
      const effect = makeEffect([{ variableName: 'weather', operation: 'set', value: '{{results.tools.weather.result}}' }]);
      await executor.execute(effect, context);

      expect(context.vars['weather']).to.equal('Sunny');
    });

    it('passes template strings through templating engine', async () => {
      const context = makeContext({ vars: {} });
      const effect = makeEffect([{ variableName: 'greeting', operation: 'set', value: 'Hello {{name}}' }]);
      await executor.execute(effect, context);

      expect(context.vars['greeting']).to.equal('template_result');
    });
  });

  describe('reset operation', () => {
    it('resets variable to undefined', async () => {
      const context = makeContext({ vars: { name: 'Alice' } });
      const effect = makeEffect([{ variableName: 'name', operation: 'reset', value: null }]);
      const outcome = await executor.execute(effect, context);

      expect(context.vars['name']).to.equal(undefined);
      expect(outcome.hasModifiedVars).to.equal(true);
    });

    it('resets non-existent variable (still marks as modified)', async () => {
      const context = makeContext({ vars: {} });
      const effect = makeEffect([{ variableName: 'missing', operation: 'reset', value: null }]);
      const outcome = await executor.execute(effect, context);

      expect(context.vars['missing']).to.equal(undefined);
      expect(outcome.hasModifiedVars).to.equal(true);
    });
  });

  describe('add operation', () => {
    it('initializes array when variable does not exist', async () => {
      const context = makeContext({ vars: {} });
      const effect = makeEffect([{ variableName: 'items', operation: 'add', value: 1 }]);
      const outcome = await executor.execute(effect, context);

      expect(context.vars['items']).to.deep.equal([1]);
      expect(outcome.hasModifiedVars).to.equal(true);
    });

    it('appends to existing array', async () => {
      const context = makeContext({ vars: { items: [1, 2] } });
      const effect = makeEffect([{ variableName: 'items', operation: 'add', value: 3 }]);
      await executor.execute(effect, context);

      expect(context.vars['items']).to.deep.equal([1, 2, 3]);
    });

    it('initializes as array when current value is not an array', async () => {
      const context = makeContext({ vars: { items: 'not an array' } });
      const effect = makeEffect([{ variableName: 'items', operation: 'add', value: 42 }]);
      await executor.execute(effect, context);

      expect(context.vars['items']).to.deep.equal([42]);
    });

    it('adds non-string values', async () => {
      const context = makeContext({ vars: { numbers: [1, 2] } });
      const effect = makeEffect([{ variableName: 'numbers', operation: 'add', value: 3 }]);
      await executor.execute(effect, context);

      expect(context.vars['numbers']).to.deep.equal([1, 2, 3]);
    });
  });

  describe('remove operation', () => {
    it('removes matching value from array (using non-string to avoid template transform)', async () => {
      const context = makeContext({ vars: { items: [1, 2, 3] } });
      const effect = makeEffect([{ variableName: 'items', operation: 'remove', value: 2 }]);
      const outcome = await executor.execute(effect, context);

      expect(context.vars['items']).to.deep.equal([1, 3]);
      expect(outcome.hasModifiedVars).to.equal(true);
    });

    it('removes string value when it matches a {{vars.*}} pattern', async () => {
      const context = makeContext({ vars: { items: ['a', 'b', 'c'], target: 'b' } });
      const effect = makeEffect([{ variableName: 'items', operation: 'remove', value: '{{vars.target}}' }]);
      await executor.execute(effect, context);

      expect(context.vars['items']).to.deep.equal(['a', 'c']);
    });

    it('removes by JSON comparison for objects', async () => {
      const context = makeContext({ vars: { items: [{ id: 1 }, { id: 2 }] } });
      const effect = makeEffect([{ variableName: 'items', operation: 'remove', value: { id: 1 } }]);
      await executor.execute(effect, context);

      expect(context.vars['items']).to.deep.equal([{ id: 2 }]);
    });

    it('does not modify when variable is not an array', async () => {
      const context = makeContext({ vars: { name: 'Alice' } });
      const effect = makeEffect([{ variableName: 'name', operation: 'remove', value: 'Alice' }]);
      const outcome = await executor.execute(effect, context);

      expect(context.vars['name']).to.equal('Alice');
      expect(outcome.hasModifiedVars).to.equal(false); // not modified
    });

    it('leaves array unchanged when value not found', async () => {
      const context = makeContext({ vars: { items: ['a', 'b'] } });
      const effect = makeEffect([{ variableName: 'items', operation: 'remove', value: 'z' }]);
      await executor.execute(effect, context);

      expect(context.vars['items']).to.deep.equal(['a', 'b']);
    });
  });

  describe('multiple modifications', () => {
    it('applies all modifications in order', async () => {
      const context = makeContext({ vars: {} });
      const effect = makeEffect([
        { variableName: 'a', operation: 'set', value: 1 },
        { variableName: 'b', operation: 'set', value: 2 },
        { variableName: 'a', operation: 'reset', value: null },
      ]);
      const outcome = await executor.execute(effect, context);

      expect(context.vars['a']).to.equal(undefined);
      expect(context.vars['b']).to.equal(2);
      expect(outcome.hasModifiedVars).to.equal(true);
    });
  });

  describe('outcome', () => {
    it('returns correct outcome shape', async () => {
      const context = makeContext({ vars: {} });
      const effect = makeEffect([{ variableName: 'x', operation: 'set', value: 1 }]);
      const outcome = await executor.execute(effect, context);

      expect(outcome.shouldEndConversation).to.equal(false);
      expect(outcome.shouldAbortConversation).to.equal(false);
      expect(outcome.hasModifiedVars).to.equal(true);
    });

    it('hasModifiedVars is false when no modifications', async () => {
      const context = makeContext({ vars: {} });
      // Empty modifications array is not valid per schema (min(1)), but testing the logic
      const effect = { type: 'modify_variables', modifications: [] } as any;
      const outcome = await executor.execute(effect, context);

      expect(outcome.hasModifiedVars).to.equal(false);
    });

    it('rethrows errors from value transformation', async () => {
      // Make the script runner throw
      scriptRunner = {
        executeScript: async (): Promise<any> => { throw new Error('Script failed'); },
      } as any;
      executor = new ModifyVariablesEffectExecutor(scriptRunner, templatingEngine);

      const context = makeContext({ vars: {} });
      const effect = makeEffect([{ variableName: 'x', operation: 'set', value: '= fail' }]);

      try {
        await executor.execute(effect, context);
        expect.fail('should have thrown');
      } catch (error) {
        expect((error as Error).message).to.equal('Script failed');
      }
    });
  });
});
