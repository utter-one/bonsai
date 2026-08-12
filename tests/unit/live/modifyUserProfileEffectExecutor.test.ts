import 'reflect-metadata';
import { describe, it, beforeEach } from 'mocha';
import { expect } from 'chai';
import { ModifyUserProfileEffectExecutor } from '../../../src/services/live/ModifyUserProfileEffectExecutor';
import type { ConversationContext } from '../../../src/services/live/ConversationContextBuilder';
import type { IsolatedScriptExecutor, ScriptExecutionResult } from '../../../src/services/live/IsolatedScriptExecutor';
import type { TemplatingEngine } from '../../../src/services/live/TemplatingEngine';
import type { ModifyUserProfileEffect } from '../../../src/types/actions';

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

function makeEffect(modifications: ModifyUserProfileEffect['modifications']): ModifyUserProfileEffect {
  return { type: 'modify_user_profile', modifications };
}

describe('ModifyUserProfileEffectExecutor', () => {
  let executor: ModifyUserProfileEffectExecutor;
  let scriptRunner: IsolatedScriptExecutor;
  let templatingEngine: TemplatingEngine;

  beforeEach(() => {
    scriptRunner = makeMockScriptRunner('script_result');
    templatingEngine = makeMockTemplatingEngine('template_result');
    executor = new ModifyUserProfileEffectExecutor(scriptRunner, templatingEngine);
  });

  describe('set operation', () => {
    it('sets a profile field with string value via {{vars.*}} pattern', async () => {
      const context = makeContext({ vars: { lang: 'en' }, userProfile: {} });
      const effect = makeEffect([{ fieldName: 'language', operation: 'set', value: '{{vars.lang}}' }]);
      const outcome = await executor.execute(effect, context);

      expect(context.userProfile['language']).to.equal('en');
      expect(outcome.hasModifiedUserProfile).to.equal(true);
    });

    it('sets a profile field with plain string (goes through templating engine)', async () => {
      const context = makeContext({ userProfile: {} });
      const effect = makeEffect([{ fieldName: 'language', operation: 'set', value: 'en' }]);
      const outcome = await executor.execute(effect, context);

      expect(context.userProfile['language']).to.equal('template_result');
      expect(outcome.hasModifiedUserProfile).to.equal(true);
    });

    it('sets a profile field with number value', async () => {
      const context = makeContext({ userProfile: {} });
      const effect = makeEffect([{ fieldName: 'age', operation: 'set', value: 30 }]);
      const outcome = await executor.execute(effect, context);

      expect(context.userProfile['age']).to.equal(30);
      expect(outcome.hasModifiedUserProfile).to.equal(true);
    });

    it('overwrites existing profile field', async () => {
      const context = makeContext({ userProfile: { language: 'fr' } });
      const effect = makeEffect([{ fieldName: 'language', operation: 'set', value: 99 }]);
      await executor.execute(effect, context);

      expect(context.userProfile['language']).to.equal(99);
    });

    it('applies value transformation for {{vars.*}} pattern', async () => {
      const context = makeContext({
        vars: { detectedLang: 'es' },
        userProfile: {},
      });
      const effect = makeEffect([{ fieldName: 'language', operation: 'set', value: '{{vars.detectedLang}}' }]);
      await executor.execute(effect, context);

      expect(context.userProfile['language']).to.equal('es');
    });

    it('applies value transformation for {{results.tools.*}} pattern', async () => {
      const context = makeContext({
        results: { tools: { detect: { result: 'de' } } },
        userProfile: {},
      });
      const effect = makeEffect([{ fieldName: 'language', operation: 'set', value: '{{results.tools.detect.result}}' }]);
      await executor.execute(effect, context);

      expect(context.userProfile['language']).to.equal('de');
    });
  });

  describe('reset operation', () => {
    it('resets profile field to undefined', async () => {
      const context = makeContext({ userProfile: { language: 'en' } });
      const effect = makeEffect([{ fieldName: 'language', operation: 'reset', value: null }]);
      const outcome = await executor.execute(effect, context);

      expect(context.userProfile['language']).to.equal(undefined);
      expect(outcome.hasModifiedUserProfile).to.equal(true);
    });

    it('resets non-existent field (still marks as modified)', async () => {
      const context = makeContext({ userProfile: {} });
      const effect = makeEffect([{ fieldName: 'missing', operation: 'reset', value: null }]);
      const outcome = await executor.execute(effect, context);

      expect(context.userProfile['missing']).to.equal(undefined);
      expect(outcome.hasModifiedUserProfile).to.equal(true);
    });
  });

  describe('add operation', () => {
    it('initializes array when field does not exist', async () => {
      const context = makeContext({ userProfile: {} });
      const effect = makeEffect([{ fieldName: 'interests', operation: 'add', value: 1 }]);
      const outcome = await executor.execute(effect, context);

      expect(context.userProfile['interests']).to.deep.equal([1]);
      expect(outcome.hasModifiedUserProfile).to.equal(true);
    });

    it('appends to existing array', async () => {
      const context = makeContext({ userProfile: { interests: [1, 2] } });
      const effect = makeEffect([{ fieldName: 'interests', operation: 'add', value: 3 }]);
      await executor.execute(effect, context);

      expect(context.userProfile['interests']).to.deep.equal([1, 2, 3]);
    });

    it('initializes as array when current value is not an array', async () => {
      const context = makeContext({ userProfile: { interests: 'not an array' } });
      const effect = makeEffect([{ fieldName: 'interests', operation: 'add', value: 42 }]);
      await executor.execute(effect, context);

      expect(context.userProfile['interests']).to.deep.equal([42]);
    });
  });

  describe('remove operation', () => {
    it('removes matching value from array (using non-string to avoid template transform)', async () => {
      const context = makeContext({ userProfile: { interests: [1, 2, 3] } });
      const effect = makeEffect([{ fieldName: 'interests', operation: 'remove', value: 2 }]);
      const outcome = await executor.execute(effect, context);

      expect(context.userProfile['interests']).to.deep.equal([1, 3]);
      expect(outcome.hasModifiedUserProfile).to.equal(true);
    });

    it('removes string value when it matches a {{vars.*}} pattern', async () => {
      const context = makeContext({
        vars: { target: 'b' },
        userProfile: { interests: ['a', 'b', 'c'] },
      });
      const effect = makeEffect([{ fieldName: 'interests', operation: 'remove', value: '{{vars.target}}' }]);
      await executor.execute(effect, context);

      expect(context.userProfile['interests']).to.deep.equal(['a', 'c']);
    });

    it('removes by JSON comparison for objects', async () => {
      const context = makeContext({ userProfile: { tags: [{ id: 1 }, { id: 2 }] } });
      const effect = makeEffect([{ fieldName: 'tags', operation: 'remove', value: { id: 1 } }]);
      await executor.execute(effect, context);

      expect(context.userProfile['tags']).to.deep.equal([{ id: 2 }]);
    });

    it('does not modify when field is not an array', async () => {
      const context = makeContext({ userProfile: { name: 'Alice' } });
      const effect = makeEffect([{ fieldName: 'name', operation: 'remove', value: 'Alice' }]);
      const outcome = await executor.execute(effect, context);

      expect(context.userProfile['name']).to.equal('Alice');
      expect(outcome.hasModifiedUserProfile).to.equal(false); // not modified
    });

    it('leaves array unchanged when value not found', async () => {
      const context = makeContext({ userProfile: { interests: ['a', 'b'] } });
      const effect = makeEffect([{ fieldName: 'interests', operation: 'remove', value: 'z' }]);
      await executor.execute(effect, context);

      expect(context.userProfile['interests']).to.deep.equal(['a', 'b']);
    });
  });

  describe('multiple modifications', () => {
    it('applies all modifications in order', async () => {
      const context = makeContext({ userProfile: {} });
      const effect = makeEffect([
        { fieldName: 'a', operation: 'set', value: 1 },
        { fieldName: 'b', operation: 'set', value: 2 },
        { fieldName: 'a', operation: 'reset', value: null },
      ]);
      const outcome = await executor.execute(effect, context);

      expect(context.userProfile['a']).to.equal(undefined);
      expect(context.userProfile['b']).to.equal(2);
      expect(outcome.hasModifiedUserProfile).to.equal(true);
    });
  });

  describe('outcome', () => {
    it('returns correct outcome shape', async () => {
      const context = makeContext({ userProfile: {} });
      const effect = makeEffect([{ fieldName: 'x', operation: 'set', value: 1 }]);
      const outcome = await executor.execute(effect, context);

      expect(outcome.shouldEndConversation).to.equal(false);
      expect(outcome.shouldAbortConversation).to.equal(false);
      expect(outcome.hasModifiedUserProfile).to.equal(true);
    });

    it('hasModifiedUserProfile is false when no modifications', async () => {
      const context = makeContext({ userProfile: {} });
      const effect = { type: 'modify_user_profile', modifications: [] } as any;
      const outcome = await executor.execute(effect, context);

      expect(outcome.hasModifiedUserProfile).to.equal(false);
    });

    it('rethrows errors from value transformation', async () => {
      scriptRunner = {
        executeScript: async (): Promise<any> => { throw new Error('Script failed'); },
      } as any;
      executor = new ModifyUserProfileEffectExecutor(scriptRunner, templatingEngine);

      const context = makeContext({ userProfile: {} });
      const effect = makeEffect([{ fieldName: 'x', operation: 'set', value: '= fail' }]);

      try {
        await executor.execute(effect, context);
        expect.fail('should have thrown');
      } catch (error) {
        expect((error as Error).message).to.equal('Script failed');
      }
    });

    it('uses fallback comparison when JSON.stringify throws during remove', async () => {
      // Create a value that throws on JSON.stringify (circular reference)
      const circular: any = { a: 1 };
      circular.self = circular;

      const context = makeContext({
        userProfile: { tags: [circular, 'normal'] },
      });
      const effect = makeEffect([{ fieldName: 'tags', operation: 'remove', value: circular }]);
      const outcome = await executor.execute(effect, context);

      // JSON.stringify throws, so it falls back to item !== value comparison
      // circular !== circular is false (same reference), so it's removed
      expect(outcome.hasModifiedUserProfile).to.equal(true);
    });
  });
});
