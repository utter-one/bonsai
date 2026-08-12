import 'reflect-metadata';
import { describe, it, beforeEach } from 'mocha';
import { expect } from 'chai';
import { ContextTransformerExecutor } from '../../../src/services/live/ContextTransformerExecutor';
import type { ConversationContext } from '../../../src/services/live/ConversationContextBuilder';
import type { IsolatedScriptExecutor, ScriptExecutionResult } from '../../../src/services/live/IsolatedScriptExecutor';
import type { StageAction } from '../../../src/types/actions';

function makeMockScriptExecutor(): IsolatedScriptExecutor {
  return {
    executeScript: async (): Promise<ScriptExecutionResult> => ({
      value: true,
      flowControl: {},
      hasModifiedVars: false,
      hasModifiedUserInput: false,
      hasModifiedUserProfile: false,
    }),
  } as any;
}

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

describe('ContextTransformerExecutor', () => {
  let executor: ContextTransformerExecutor;
  let scriptExecutor: IsolatedScriptExecutor;
  let templatingEngine: any;
  let contextBuilder: any;
  let conversationService: any;

  beforeEach(() => {
    templatingEngine = { render: async (tpl: string) => tpl };
    contextBuilder = {
      buildContextForTransformer: async () => makeContext(),
      buildRawContext: () => makeContext(),
    };
    conversationService = {
      saveConversationEvent: async () => {},
    };
    scriptExecutor = makeMockScriptExecutor();
    executor = new ContextTransformerExecutor(
      templatingEngine,
      contextBuilder,
      conversationService,
      scriptExecutor,
    );
  });

  describe('computeVariableChangeEvents', () => {
    it('detects new variables', () => {
      const events = (executor as any).computeVariableChangeEvents({}, { name: 'test' });
      expect(events.name).to.equal('new');
    });

    it('detects changed variables', () => {
      const events = (executor as any).computeVariableChangeEvents(
        { name: 'old' },
        { name: 'new' },
      );
      expect(events.name).to.equal('changed');
    });

    it('detects removed variables', () => {
      const events = (executor as any).computeVariableChangeEvents(
        { name: 'test' },
        {},
      );
      expect(events.name).to.equal('removed');
    });

    it('ignores unchanged variables', () => {
      const events = (executor as any).computeVariableChangeEvents(
        { name: 'test' },
        { name: 'test' },
      );
      expect(events.name).to.be.undefined;
    });

    it('ignores null to undefined changes', () => {
      const events = (executor as any).computeVariableChangeEvents(
        { name: null },
        { name: undefined },
      );
      expect(events.name).to.be.undefined;
    });

    it('ignores undefined to null changes', () => {
      const events = (executor as any).computeVariableChangeEvents(
        { name: undefined },
        { name: null },
      );
      expect(events.name).to.be.undefined;
    });

    it('handles multiple variable changes', () => {
      const events = (executor as any).computeVariableChangeEvents(
        { a: 1, b: 2, c: 3 },
        { a: 1, b: 'changed', d: 4 },
      );
      expect(events.a).to.be.undefined; // unchanged
      expect(events.b).to.equal('changed');
      expect(events.c).to.equal('removed');
      expect(events.d).to.equal('new');
    });

    it('detects deep object changes', () => {
      const events = (executor as any).computeVariableChangeEvents(
        { config: { x: 1 } },
        { config: { x: 2 } },
      );
      expect(events.config).to.equal('changed');
    });

    it('returns empty object when no changes', () => {
      const events = (executor as any).computeVariableChangeEvents({ a: 1 }, { a: 1 });
      expect(Object.keys(events)).to.have.length(0);
    });
  });

  describe('findTriggeredActions', () => {
    it('returns empty array when no change events', async () => {
      const session = {
        id: 'session_1',
        runner: { getRuntimeData: () => ({}) },
      } as any;
      const stageActions: Record<string, StageAction> = {
        action_1: {
          name: 'action_1',
          triggerOnTransformation: true,
          watchedVariables: { x: 'new' },
          effects: [],
          triggerOnUserInput: false,
          overrideClassifierId: null,
          classificationTrigger: '',
          parameters: [],
        },
      };
      const context = makeContext();

      const triggered = await (executor as any).findTriggeredActions(
        session, {}, stageActions, context,
      );

      expect(triggered).to.have.length(0);
    });

    it('triggers action when watched variable is new', async () => {
      const session = { id: 'session_1' } as any;
      const stageActions: Record<string, StageAction> = {
        action_1: {
          name: 'action_1',
          triggerOnTransformation: true,
          watchedVariables: { x: 'new' },
          effects: [],
          triggerOnUserInput: false,
          overrideClassifierId: null,
          classificationTrigger: '',
          parameters: [],
        },
      };
      const context = makeContext();

      const triggered = await (executor as any).findTriggeredActions(
        session, { x: 'new' }, stageActions, context,
      );

      expect(triggered).to.have.length(1);
      expect(triggered[0].name).to.equal('action_1');
    });

    it('triggers action when watched variable matches any', async () => {
      const session = { id: 'session_1' } as any;
      const stageActions: Record<string, StageAction> = {
        action_1: {
          name: 'action_1',
          triggerOnTransformation: true,
          watchedVariables: { x: 'any' },
          effects: [],
          triggerOnUserInput: false,
          overrideClassifierId: null,
          classificationTrigger: '',
          parameters: [],
        },
      };
      const context = makeContext();

      const triggered = await (executor as any).findTriggeredActions(
        session, { x: 'changed' }, stageActions, context,
      );

      expect(triggered).to.have.length(1);
    });

    it('does not trigger action when watched variable event does not match', async () => {
      const session = { id: 'session_1' } as any;
      const stageActions: Record<string, StageAction> = {
        action_1: {
          name: 'action_1',
          triggerOnTransformation: true,
          watchedVariables: { x: 'new' },
          effects: [],
          triggerOnUserInput: false,
          overrideClassifierId: null,
          classificationTrigger: '',
          parameters: [],
        },
      };
      const context = makeContext();

      const triggered = await (executor as any).findTriggeredActions(
        session, { x: 'changed' }, stageActions, context,
      );

      expect(triggered).to.have.length(0);
    });

    it('skips actions without triggerOnTransformation', async () => {
      const session = { id: 'session_1' } as any;
      const stageActions: Record<string, StageAction> = {
        action_1: {
          name: 'action_1',
          triggerOnTransformation: false,
          watchedVariables: { x: 'new' },
          effects: [],
          triggerOnUserInput: false,
          overrideClassifierId: null,
          classificationTrigger: '',
          parameters: [],
        },
      };
      const context = makeContext();

      const triggered = await (executor as any).findTriggeredActions(
        session, { x: 'new' }, stageActions, context,
      );

      expect(triggered).to.have.length(0);
    });

    it('skips actions without watchedVariables', async () => {
      const session = { id: 'session_1' } as any;
      const stageActions: Record<string, StageAction> = {
        action_1: {
          name: 'action_1',
          triggerOnTransformation: true,
          watchedVariables: {},
          effects: [],
          triggerOnUserInput: false,
          overrideClassifierId: null,
          classificationTrigger: '',
          parameters: [],
        },
      };
      const context = makeContext();

      const triggered = await (executor as any).findTriggeredActions(
        session, { x: 'new' }, stageActions, context,
      );

      expect(triggered).to.have.length(0);
    });

    it('skips action when condition evaluates to false', async () => {
      scriptExecutor = {
        executeScript: async (): Promise<ScriptExecutionResult> => ({
          value: false,
          flowControl: {},
          hasModifiedVars: false,
          hasModifiedUserInput: false,
          hasModifiedUserProfile: false,
        }),
      } as any;
      executor = new ContextTransformerExecutor(
        templatingEngine, contextBuilder, conversationService, scriptExecutor,
      );
      const session = { id: 'session_1' } as any;
      const stageActions: Record<string, StageAction> = {
        action_1: {
          name: 'action_1',
          triggerOnTransformation: true,
          watchedVariables: { x: 'new' },
          condition: 'vars.x > 10',
          effects: [],
          triggerOnUserInput: false,
          overrideClassifierId: null,
          classificationTrigger: '',
          parameters: [],
        },
      };
      const context = makeContext();

      const triggered = await (executor as any).findTriggeredActions(
        session, { x: 'new' }, stageActions, context,
      );

      expect(triggered).to.have.length(0);
    });

    it('triggers multiple actions from one change', async () => {
      const session = { id: 'session_1' } as any;
      const stageActions: Record<string, StageAction> = {
        action_1: {
          name: 'action_1',
          triggerOnTransformation: true,
          watchedVariables: { x: 'new' },
          effects: [],
          triggerOnUserInput: false,
          overrideClassifierId: null,
          classificationTrigger: '',
          parameters: [],
        },
        action_2: {
          name: 'action_2',
          triggerOnTransformation: true,
          watchedVariables: { x: 'new' },
          effects: [],
          triggerOnUserInput: false,
          overrideClassifierId: null,
          classificationTrigger: '',
          parameters: [],
        },
      };
      const context = makeContext();

      const triggered = await (executor as any).findTriggeredActions(
        session, { x: 'new' }, stageActions, context,
      );

      expect(triggered).to.have.length(2);
      expect(triggered.map(t => t.name)).to.include('action_1');
      expect(triggered.map(t => t.name)).to.include('action_2');
    });

    it('returns triggered action with empty parameters', async () => {
      const session = { id: 'session_1' } as any;
      const stageActions: Record<string, StageAction> = {
        action_1: {
          name: 'action_1',
          triggerOnTransformation: true,
          watchedVariables: { x: 'new' },
          effects: [],
          triggerOnUserInput: false,
          overrideClassifierId: null,
          classificationTrigger: '',
          parameters: [],
        },
      };
      const context = makeContext();

      const triggered = await (executor as any).findTriggeredActions(
        session, { x: 'new' }, stageActions, context,
      );

      expect(triggered[0].parameters).to.deep.equal({});
    });
  });
});
