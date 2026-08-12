import { describe, it, beforeEach } from 'mocha';
import { expect } from 'chai';
import { transformEffectValue } from '../../../src/services/live/effectValueTransformer';
import type { ConversationContext } from '../../../src/services/live/ConversationContextBuilder';
import type { IsolatedScriptExecutor, ScriptExecutionResult } from '../../../src/services/live/IsolatedScriptExecutor';
import type { TemplatingEngine } from '../../../src/services/live/TemplatingEngine';

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

describe('transformEffectValue', () => {
  let scriptRunner: IsolatedScriptExecutor;
  let templatingEngine: TemplatingEngine;

  beforeEach(() => {
    scriptRunner = makeMockScriptRunner('script_result');
    templatingEngine = makeMockTemplatingEngine('rendered_template');
  });

  describe('non-string passthrough', () => {
    it('returns numbers unchanged', async () => {
      const result = await transformEffectValue(42, makeContext(), scriptRunner, templatingEngine);
      expect(result).to.equal(42);
    });

    it('returns booleans unchanged', async () => {
      const result = await transformEffectValue(true, makeContext(), scriptRunner, templatingEngine);
      expect(result).to.equal(true);
    });

    it('returns null unchanged', async () => {
      const result = await transformEffectValue(null, makeContext(), scriptRunner, templatingEngine);
      expect(result).to.equal(null);
    });

    it('returns objects unchanged', async () => {
      const input = { key: 'value' };
      const result = await transformEffectValue(input, makeContext(), scriptRunner, templatingEngine);
      expect(result).to.deep.equal(input);
    });

    it('returns arrays unchanged', async () => {
      const input = [1, 2, 3];
      const result = await transformEffectValue(input, makeContext(), scriptRunner, templatingEngine);
      expect(result).to.deep.equal(input);
    });
  });

  describe('tool result references', () => {
    it('resolves {{results.tools.toolId.result}}', async () => {
      const context = makeContext({
        results: { tools: { weather: { result: 'Sunny, 25C' } } },
      });
      const result = await transformEffectValue('{{results.tools.weather.result}}', context, scriptRunner, templatingEngine);
      expect(result).to.equal('Sunny, 25C');
    });

    it('returns first element when result is an array', async () => {
      const context = makeContext({
        results: { tools: { items: { result: ['first', 'second', 'third'] } } },
      });
      const result = await transformEffectValue('{{results.tools.items.result}}', context, scriptRunner, templatingEngine);
      expect(result).to.equal('first');
    });

    it('returns undefined for missing tool result', async () => {
      const context = makeContext({
        results: { tools: { weather: { result: 'Sunny' } } },
      });
      const result = await transformEffectValue('{{results.tools.missing.result}}', context, scriptRunner, templatingEngine);
      expect(result).to.equal(undefined);
    });

    it('returns first element of empty array (undefined)', async () => {
      const context = makeContext({
        results: { tools: { empty: { result: [] } } },
      });
      const result = await transformEffectValue('{{results.tools.empty.result}}', context, scriptRunner, templatingEngine);
      expect(result).to.equal(undefined);
    });

    it('returns undefined for missing tool entirely', async () => {
      const context = makeContext({ results: { tools: {} } });
      const result = await transformEffectValue('{{results.tools.nonexistent.result}}', context, scriptRunner, templatingEngine);
      expect(result).to.equal(undefined);
    });

    it('returns undefined for missing tool', async () => {
      const context = makeContext({ results: { tools: {} } });
      const result = await transformEffectValue('{{results.tools.missing.result}}', context, scriptRunner, templatingEngine);
      expect(result).to.equal(undefined);
    });
  });

  describe('simple variable references', () => {
    it('resolves {{vars.variableName}}', async () => {
      const context = makeContext({ vars: { userName: 'Alice' } });
      const result = await transformEffectValue('{{vars.userName}}', context, scriptRunner, templatingEngine);
      expect(result).to.equal('Alice');
    });

    it('returns undefined for missing variable', async () => {
      const context = makeContext({ vars: {} });
      const result = await transformEffectValue('{{vars.missing}}', context, scriptRunner, templatingEngine);
      expect(result).to.equal(undefined);
    });
  });

  describe('stage variable references', () => {
    it('resolves {{stageVars.stageName.variableName}}', async () => {
      const context = makeContext({
        stageVars: { main_stage: { orderTotal: 99.99 } },
      });
      const result = await transformEffectValue('{{stageVars.main_stage.orderTotal}}', context, scriptRunner, templatingEngine);
      expect(result).to.equal(99.99);
    });

    it('returns undefined for missing stage', async () => {
      const context = makeContext({ stageVars: {} });
      const result = await transformEffectValue('{{stageVars.missing.var}}', context, scriptRunner, templatingEngine);
      expect(result).to.equal(undefined);
    });

    it('returns undefined for missing variable in existing stage', async () => {
      const context = makeContext({
        stageVars: { main_stage: { orderTotal: 99.99 } },
      });
      const result = await transformEffectValue('{{stageVars.main_stage.missing}}', context, scriptRunner, templatingEngine);
      expect(result).to.equal(undefined);
    });
  });

  describe('user profile references', () => {
    it('resolves {{userProfile.fieldName}}', async () => {
      const context = makeContext({ userProfile: { language: 'en' } });
      const result = await transformEffectValue('{{userProfile.language}}', context, scriptRunner, templatingEngine);
      expect(result).to.equal('en');
    });

    it('returns undefined for missing field', async () => {
      const context = makeContext({ userProfile: {} });
      const result = await transformEffectValue('{{userProfile.missing}}', context, scriptRunner, templatingEngine);
      expect(result).to.equal(undefined);
    });
  });

  describe('inline script expressions', () => {
    it('executes = expression via script runner', async () => {
      const result = await transformEffectValue('= 1 + 2', makeContext(), scriptRunner, templatingEngine);
      expect(result).to.equal('script_result');
    });

    it('trims whitespace after =', async () => {
      const result = await transformEffectValue('=   Date.now()', makeContext(), scriptRunner, templatingEngine);
      expect(result).to.equal('script_result');
    });

    it('does NOT match = when value has leading whitespace (only trimmed used for regex)', async () => {
      // The = check uses value[0], not trimmed[0], so leading whitespace prevents match
      const result = await transformEffectValue('  = 1 + 2', makeContext(), scriptRunner, templatingEngine);
      // Falls through to templating engine because value[0] is ' ', not '='
      expect(result).to.equal('rendered_template');
    });

    it('passes plain string through templating engine as default', async () => {
      const result = await transformEffectValue('Hello {{name}}', makeContext(), scriptRunner, templatingEngine);
      expect(result).to.equal('rendered_template');
    });
  });

  describe('Handlebars template fallback', () => {
    it('renders via templating engine for non-matching strings', async () => {
      const result = await transformEffectValue('Hello {{name}}', makeContext(), scriptRunner, templatingEngine);
      expect(result).to.equal('rendered_template');
    });

    it('renders plain text via templating engine', async () => {
      const result = await transformEffectValue('Just plain text', makeContext(), scriptRunner, templatingEngine);
      expect(result).to.equal('rendered_template');
    });
  });

  describe('pattern matching precedence', () => {
    it('tool result pattern takes precedence over template rendering', async () => {
      const context = makeContext({
        results: { tools: { myTool: { result: 'tool output' } } },
      });
      const result = await transformEffectValue('{{results.tools.myTool.result}}', context, scriptRunner, templatingEngine);
      expect(result).to.equal('tool output');
    });

    it('vars pattern takes precedence over template rendering', async () => {
      const context = makeContext({ vars: { myVar: 'var value' } });
      const result = await transformEffectValue('{{vars.myVar}}', context, scriptRunner, templatingEngine);
      expect(result).to.equal('var value');
    });
  });

  describe('whitespace handling', () => {
    it('trims leading/trailing whitespace before pattern matching', async () => {
      const context = makeContext({ vars: { x: 'trimmed' } });
      const result = await transformEffectValue('  {{vars.x}}  ', context, scriptRunner, templatingEngine);
      expect(result).to.equal('trimmed');
    });
  });
});
