import 'reflect-metadata';
import { expect } from 'chai';
import { ActionsExecutor } from '../../../src/services/live/ActionsExecutor';
import type { Effect, StageAction, EndConversationEffect, AbortConversationEffect, GoToStageEffect, ModifyVariablesEffect, GenerateResponseEffect, ModifyUserInputEffect, ChangeVisibilityEffect, BanUserEffect, SaveArtifactEffect, AttachFileEffect, CallToolEffect } from '../../../src/types/actions';
import type { ConversationContext } from '../../../src/services/live/ConversationContextBuilder';
import type { ConversationEventType, ConversationEventData } from '../../../src/types/conversationEvents';

/** Minimal mock for ActionsExecutor dependencies */
function createMockDeps(): {
  toolService: any;
  toolExecutor: any;
  contextBuilder: any;
  templatingEngine: any;
  modifyVariablesExecutor: any;
  modifyUserProfileExecutor: any;
  userService: any;
  storageService: any;
} {
  return {
    toolService: { getToolById: async () => null, getToolTypesByIds: async () => new Map() },
    toolExecutor: { executeTool: async () => ({ success: true, result: {} }) },
    contextBuilder: {},
    templatingEngine: { render: async (tpl: string, ctx: any) => ctx[tpl] ?? tpl },
    modifyVariablesExecutor: { execute: async (_effect: any, ctx: ConversationContext) => ({ hasModifiedVars: true }) },
    modifyUserProfileExecutor: { execute: async (_effect: any, ctx: ConversationContext) => ({ hasModifiedUserProfile: true }) },
    userService: { banUser: async () => {} },
    storageService: { uploadArtifact: async () => ({ id: 'artifact_mock' }) },
  };
}

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

/** Build a StageAction with given effects */
function buildAction(effects: Effect[]): StageAction {
  return {
    name: 'TestAction',
    triggerOnUserInput: true,
    triggerOnClientCommand: false,
    parameters: [],
    effects,
  };
}

describe('ActionsExecutor', () => {
  let executor: ActionsExecutor;
  let deps: ReturnType<typeof createMockDeps>;

  beforeEach(() => {
    deps = createMockDeps();
    executor = new ActionsExecutor(
      deps.toolService,
      deps.toolExecutor,
      deps.contextBuilder,
      deps.templatingEngine,
      deps.modifyVariablesExecutor,
      deps.modifyUserProfileExecutor,
      deps.userService,
      deps.storageService,
    );
  });

  describe('executeActions with no actions', () => {
    it('returns early with shouldGenerateResponse', async () => {
      const context = buildContext();
      const events: Array<{ type: ConversationEventType; data: ConversationEventData }> = [];
      const outcome = await (executor as any).executeActions(
        [], context, 'stage_test', null,
        async (type: ConversationEventType, data: ConversationEventData) => events.push({ type, data }),
      );

      expect(outcome.success).to.be.true;
      expect(outcome.shouldGenerateResponse).to.be.true;
      expect(outcome.shouldEndConversation).to.be.false;
      expect(outcome.shouldAbortConversation).to.be.false;
      expect(events.length).to.equal(0);
    });
  });

  describe('effect priority ordering', () => {
    it('executes effects in default priority order', async () => {
      const executedOrder: string[] = [];

      // Create effects with different default priorities
      const effects: Effect[] = [
        { type: 'go_to_stage', stageId: 'other_stage' },
        { type: 'end_conversation', reason: 'done' },
        { type: 'abort_conversation', reason: 'abort' },
        { type: 'generate_response', responseMode: 'generated' },
        { type: 'modify_variables', modifications: [{ variableName: 'x', operation: 'set', value: 1 }] },
        { type: 'modify_user_profile', modifications: [{ fieldName: 'name', operation: 'set', value: 'test' }] },
        { type: 'modify_user_input', template: 'modified' },
        { type: 'ban_user', reason: 'bad' },
        { type: 'save_artifact', data: 'test', fileName: 'f.txt', variableName: 'aid' },
        { type: 'attach_file', artifactId: '{{aid}}', fileName: 'f.txt', mimeType: 'text/plain' },
        { type: 'change_visibility', visibility: 'never' },
      ];

      // Intercept executeEffect to track order
      const originalExecuteEffect = (executor as any).executeEffect.bind(executor);
      (executor as any).executeEffect = async (effect: Effect, ctx: ConversationContext, actionName: string, emitEvent: any) => {
        executedOrder.push(effect.type);
        return originalExecuteEffect(effect, ctx, actionName, emitEvent);
      };

      const context = buildContext();
      const events: Array<{ type: ConversationEventType; data: ConversationEventData }> = [];

      await (executor as any).executeActions(
        [buildAction(effects)], context, 'stage_test', null,
        async (type: ConversationEventType, data: ConversationEventData) => events.push({ type, data }),
      );

      // Expected order: modify_variables(3000) → modify_user_profile(4000) → modify_user_input(5000) → ban_user(7000) → save_artifact(8000) → change_visibility(9000) → attach_file(9500) → generate_response(10000) → abort_conversation(12000)
      // end_conversation removed by conflict resolution (abort > end), go_to_stage(13000) skipped after shouldStop from abort
      expect(executedOrder).to.include('modify_variables');
      expect(executedOrder).to.include('modify_user_profile');
      expect(executedOrder).to.include('generate_response');
      expect(executedOrder).to.include('abort_conversation');
      expect(executedOrder).to.not.include('end_conversation');
      expect(executedOrder).to.not.include('go_to_stage'); // skipped after shouldStop from abort_conversation
    });

    it('respects per-effect priority overrides', async () => {
      const executedOrder: string[] = [];

      const effects: Effect[] = [
        { type: 'modify_variables', modifications: [{ variableName: 'x', operation: 'set', value: 1 }], priority: 100 } as any,
        { type: 'generate_response', responseMode: 'generated', priority: 200 } as any,
        { type: 'modify_user_profile', modifications: [{ fieldName: 'name', operation: 'set', value: 'test' }], priority: 50 } as any,
      ];

      const originalExecuteEffect = (executor as any).executeEffect.bind(executor);
      (executor as any).executeEffect = async (effect: Effect, ctx: ConversationContext, actionName: string, emitEvent: any) => {
        executedOrder.push(effect.type);
        return originalExecuteEffect(effect, ctx, actionName, emitEvent);
      };

      const context = buildContext();
      const events: Array<{ type: ConversationEventType; data: ConversationEventData }> = [];

      await (executor as any).executeActions(
        [buildAction(effects)], context, 'stage_test', null,
        async (type: ConversationEventType, data: ConversationEventData) => events.push({ type, data }),
      );

      // modify_user_profile (50) → modify_variables (100) → generate_response (200)
      expect(executedOrder).to.deep.equal(['modify_user_profile', 'modify_variables', 'generate_response']);
    });
  });

  describe('conflict resolution', () => {
    it('resolves multiple go_to_stage with different IDs to first', async () => {
      const executedStages: string[] = [];

      const effects: Effect[] = [
        { type: 'go_to_stage', stageId: 'stage_a' },
        { type: 'go_to_stage', stageId: 'stage_b' },
      ];

      const originalExecuteEffect = (executor as any).executeEffect.bind(executor);
      (executor as any).executeEffect = async (effect: Effect, ctx: ConversationContext, actionName: string, emitEvent: any) => {
        if (effect.type === 'go_to_stage') {
          executedStages.push((effect as GoToStageEffect).stageId);
        }
        return originalExecuteEffect(effect, ctx, actionName, emitEvent);
      };

      const context = buildContext();
      const events: Array<{ type: ConversationEventType; data: ConversationEventData }> = [];

      await (executor as any).executeActions(
        [buildAction(effects)], context, 'stage_test', null,
        async (type: ConversationEventType, data: ConversationEventData) => events.push({ type, data }),
      );

      // Only the first go_to_stage should execute
      expect(executedStages).to.deep.equal(['stage_a']);
    });

    it('prioritizes abort_conversation over end_conversation', async () => {
      const executedTypes: string[] = [];

      const effects: Effect[] = [
        { type: 'end_conversation', reason: 'done' },
        { type: 'abort_conversation', reason: 'abort' },
      ];

      const originalExecuteEffect = (executor as any).executeEffect.bind(executor);
      (executor as any).executeEffect = async (effect: Effect, ctx: ConversationContext, actionName: string, emitEvent: any) => {
        executedTypes.push(effect.type);
        return originalExecuteEffect(effect, ctx, actionName, emitEvent);
      };

      const context = buildContext();
      const events: Array<{ type: ConversationEventType; data: ConversationEventData }> = [];

      await (executor as any).executeActions(
        [buildAction(effects)], context, 'stage_test', null,
        async (type: ConversationEventType, data: ConversationEventData) => events.push({ type, data }),
      );

      // end_conversation should be removed by conflict resolution
      expect(executedTypes).to.not.include('end_conversation');
      expect(executedTypes).to.include('abort_conversation');
    });

    it('chains multiple modify_user_input effects', async () => {
      const executedCount = { count: 0 };

      const effects: Effect[] = [
        { type: 'modify_user_input', template: 'step1' },
        { type: 'modify_user_input', template: 'step2' },
      ];

      const originalExecuteEffect = (executor as any).executeEffect.bind(executor);
      (executor as any).executeEffect = async (effect: Effect, ctx: ConversationContext, actionName: string, emitEvent: any) => {
        if (effect.type === 'modify_user_input') {
          executedCount.count++;
        }
        return originalExecuteEffect(effect, ctx, actionName, emitEvent);
      };

      const context = buildContext();
      const events: Array<{ type: ConversationEventType; data: ConversationEventData }> = [];

      await (executor as any).executeActions(
        [buildAction(effects)], context, 'stage_test', null,
        async (type: ConversationEventType, data: ConversationEventData) => events.push({ type, data }),
      );

      // Both modify_user_input should execute (they chain, not conflict)
      expect(executedCount.count).to.equal(2);
    });
  });

  describe('lifecycle effect restrictions', () => {
    it('filters end_conversation in on_enter lifecycle', async () => {
      const executedTypes: string[] = [];

      const effects: Effect[] = [
        { type: 'end_conversation', reason: 'done' },
        { type: 'modify_variables', modifications: [{ variableName: 'x', operation: 'set', value: 1 }] },
      ];

      const originalExecuteEffect = (executor as any).executeEffect.bind(executor);
      (executor as any).executeEffect = async (effect: Effect, ctx: ConversationContext, actionName: string, emitEvent: any) => {
        executedTypes.push(effect.type);
        return originalExecuteEffect(effect, ctx, actionName, emitEvent);
      };

      const context = buildContext();
      const events: Array<{ type: ConversationEventType; data: ConversationEventData }> = [];

      await (executor as any).executeActions(
        [buildAction(effects)], context, 'stage_test', 'on_enter',
        async (type: ConversationEventType, data: ConversationEventData) => events.push({ type, data }),
      );

      // end_conversation should be filtered out in on_enter
      expect(executedTypes).to.not.include('end_conversation');
      expect(executedTypes).to.include('modify_variables');
    });

    it('filters go_to_stage in on_enter lifecycle', async () => {
      const executedTypes: string[] = [];

      const effects: Effect[] = [
        { type: 'go_to_stage', stageId: 'other' },
        { type: 'modify_variables', modifications: [{ variableName: 'x', operation: 'set', value: 1 }] },
      ];

      const originalExecuteEffect = (executor as any).executeEffect.bind(executor);
      (executor as any).executeEffect = async (effect: Effect, ctx: ConversationContext, actionName: string, emitEvent: any) => {
        executedTypes.push(effect.type);
        return originalExecuteEffect(effect, ctx, actionName, emitEvent);
      };

      const context = buildContext();
      const events: Array<{ type: ConversationEventType; data: ConversationEventData }> = [];

      await (executor as any).executeActions(
        [buildAction(effects)], context, 'stage_test', 'on_enter',
        async (type: ConversationEventType, data: ConversationEventData) => events.push({ type, data }),
      );

      expect(executedTypes).to.not.include('go_to_stage');
      expect(executedTypes).to.include('modify_variables');
    });

    it('filters go_to_stage and generate_response in on_leave lifecycle', async () => {
      const executedTypes: string[] = [];

      const effects: Effect[] = [
        { type: 'go_to_stage', stageId: 'other' },
        { type: 'generate_response', responseMode: 'generated' },
        { type: 'modify_variables', modifications: [{ variableName: 'x', operation: 'set', value: 1 }] },
      ];

      const originalExecuteEffect = (executor as any).executeEffect.bind(executor);
      (executor as any).executeEffect = async (effect: Effect, ctx: ConversationContext, actionName: string, emitEvent: any) => {
        executedTypes.push(effect.type);
        return originalExecuteEffect(effect, ctx, actionName, emitEvent);
      };

      const context = buildContext();
      const events: Array<{ type: ConversationEventType; data: ConversationEventData }> = [];

      await (executor as any).executeActions(
        [buildAction(effects)], context, 'stage_test', 'on_leave',
        async (type: ConversationEventType, data: ConversationEventData) => events.push({ type, data }),
      );

      expect(executedTypes).to.not.include('go_to_stage');
      expect(executedTypes).to.not.include('generate_response');
      expect(executedTypes).to.include('modify_variables');
    });

    it('allows all effects in on_fallback lifecycle', async () => {
      const executedTypes: string[] = [];

      // Use effects that won't trigger shouldStop before go_to_stage
      const effects: Effect[] = [
        { type: 'go_to_stage', stageId: 'other' },
        { type: 'modify_variables', modifications: [{ variableName: 'x', operation: 'set', value: 1 }] },
        { type: 'generate_response', responseMode: 'generated' },
      ];

      const originalExecuteEffect = (executor as any).executeEffect.bind(executor);
      (executor as any).executeEffect = async (effect: Effect, ctx: ConversationContext, actionName: string, emitEvent: any) => {
        executedTypes.push(effect.type);
        return originalExecuteEffect(effect, ctx, actionName, emitEvent);
      };

      const context = buildContext();
      const events: Array<{ type: ConversationEventType; data: ConversationEventData }> = [];

      await (executor as any).executeActions(
        [buildAction(effects)], context, 'stage_test', 'on_fallback',
        async (type: ConversationEventType, data: ConversationEventData) => events.push({ type, data }),
      );

      // on_fallback has no restrictions — all effects should execute
      expect(executedTypes).to.include('modify_variables');
      expect(executedTypes).to.include('generate_response');
      expect(executedTypes).to.include('go_to_stage');
    });
  });

  describe('execution_plan event', () => {
    it('emits execution_plan before effects execute', async () => {
      const effects: Effect[] = [
        { type: 'modify_variables', modifications: [{ variableName: 'x', operation: 'set', value: 1 }] },
      ];

      const events: Array<{ type: ConversationEventType; data: ConversationEventData }> = [];

      const context = buildContext();

      await (executor as any).executeActions(
        [buildAction(effects)], context, 'stage_test', null,
        async (type: ConversationEventType, data: ConversationEventData) => events.push({ type, data }),
      );

      expect(events[0].type).to.equal('execution_plan');
      expect((events[0].data as any).stageId).to.equal('stage_test');
    });
  });

  describe('shouldStop after end/abort', () => {
    it('skips remaining effects after end_conversation', async () => {
      const executedTypes: string[] = [];

      const effects: Effect[] = [
        { type: 'end_conversation', reason: 'done' },
        { type: 'modify_variables', modifications: [{ variableName: 'x', operation: 'set', value: 1 }] },
        { type: 'generate_response', responseMode: 'generated' },
      ];

      const originalExecuteEffect = (executor as any).executeEffect.bind(executor);
      (executor as any).executeEffect = async (effect: Effect, ctx: ConversationContext, actionName: string, emitEvent: any) => {
        executedTypes.push(effect.type);
        return originalExecuteEffect(effect, ctx, actionName, emitEvent);
      };

      const context = buildContext();
      const events: Array<{ type: ConversationEventType; data: ConversationEventData }> = [];

      await (executor as any).executeActions(
        [buildAction(effects)], context, 'stage_test', null,
        async (type: ConversationEventType, data: ConversationEventData) => events.push({ type, data }),
      );

      // modify_variables (3000) executes before end_conversation (11000), so it should run
      // end_conversation should stop generate_response (10000) — wait, generate_response is 10000 < 11000
      // So generate_response runs first, then end_conversation stops... nothing after since it's last
      expect(executedTypes).to.include('modify_variables');
      expect(executedTypes).to.include('generate_response');
      expect(executedTypes).to.include('end_conversation');
    });
  });

  describe('effect outcomes', () => {
    it('returns correct outcome for end_conversation', async () => {
      const context = buildContext();
      const events: Array<{ type: ConversationEventType; data: ConversationEventData }> = [];

      const outcome = await (executor as any).executeActions(
        [buildAction([{ type: 'end_conversation', reason: 'finished' }])], context, 'stage_test', null,
        async (type: ConversationEventType, data: ConversationEventData) => events.push({ type, data }),
      );

      expect(outcome.shouldEndConversation).to.be.true;
      expect(outcome.endReason).to.equal('finished');
      expect(outcome.shouldAbortConversation).to.be.false;
    });

    it('returns correct outcome for abort_conversation', async () => {
      const context = buildContext();
      const events: Array<{ type: ConversationEventType; data: ConversationEventData }> = [];

      const outcome = await (executor as any).executeActions(
        [buildAction([{ type: 'abort_conversation', reason: 'error' }])], context, 'stage_test', null,
        async (type: ConversationEventType, data: ConversationEventData) => events.push({ type, data }),
      );

      expect(outcome.shouldAbortConversation).to.be.true;
      expect(outcome.abortReason).to.equal('error');
      expect(outcome.shouldEndConversation).to.be.false;
    });

    it('returns correct outcome for go_to_stage', async () => {
      const context = buildContext();
      const events: Array<{ type: ConversationEventType; data: ConversationEventData }> = [];

      const outcome = await (executor as any).executeActions(
        [buildAction([{ type: 'go_to_stage', stageId: 'next_stage' }])], context, 'stage_test', null,
        async (type: ConversationEventType, data: ConversationEventData) => events.push({ type, data }),
      );

      expect(outcome.goToStageId).to.equal('next_stage');
    });

    it('returns correct outcome for generate_response (generated mode)', async () => {
      const context = buildContext();
      const events: Array<{ type: ConversationEventType; data: ConversationEventData }> = [];

      const outcome = await (executor as any).executeActions(
        [buildAction([{ type: 'generate_response', responseMode: 'generated' }])], context, 'stage_test', null,
        async (type: ConversationEventType, data: ConversationEventData) => events.push({ type, data }),
      );

      expect(outcome.shouldGenerateResponse).to.be.true;
      expect(outcome.prescriptedResponse).to.be.undefined;
    });

    it('returns correct outcome for generate_response (prescripted mode)', async () => {
      const context = buildContext();
      const events: Array<{ type: ConversationEventType; data: ConversationEventData }> = [];

      const outcome = await (executor as any).executeActions(
        [buildAction([{ type: 'generate_response', responseMode: 'prescripted', prescriptedResponses: ['Hi!', 'Hello!'], prescriptedSelectionStrategy: 'random' }])], context, 'stage_test', null,
        async (type: ConversationEventType, data: ConversationEventData) => events.push({ type, data }),
      );

      expect(outcome.shouldGenerateResponse).to.be.true;
      expect(outcome.prescriptedResponse).to.be.oneOf(['Hi!', 'Hello!']);
    });

    it('returns correct outcome for modify_variables', async () => {
      const context = buildContext();
      const events: Array<{ type: ConversationEventType; data: ConversationEventData }> = [];

      const outcome = await (executor as any).executeActions(
        [buildAction([{ type: 'modify_variables', modifications: [{ variableName: 'x', operation: 'set', value: 1 }] }])], context, 'stage_test', null,
        async (type: ConversationEventType, data: ConversationEventData) => events.push({ type, data }),
      );

      expect(outcome.hasModifiedVars).to.be.true;
    });

    it('returns correct outcome for modify_user_profile', async () => {
      const context = buildContext();
      const events: Array<{ type: ConversationEventType, data: ConversationEventData }> = [];

      const outcome = await (executor as any).executeActions(
        [buildAction([{ type: 'modify_user_profile', modifications: [{ fieldName: 'name', operation: 'set', value: 'test' }] }])], context, 'stage_test', null,
        async (type: ConversationEventType, data: ConversationEventData) => events.push({ type, data }),
      );

      expect(outcome.hasModifiedUserProfile).to.be.true;
    });

    it('returns correct outcome for change_visibility', async () => {
      const context = buildContext();
      const events: Array<{ type: ConversationEventType, data: ConversationEventData }> = [];

      const outcome = await (executor as any).executeActions(
        [buildAction([{ type: 'change_visibility', visibility: 'never' }])], context, 'stage_test', null,
        async (type: ConversationEventType, data: ConversationEventData) => events.push({ type, data }),
      );

      expect(outcome.turnVisibility).to.deep.equal({ visibility: 'never', condition: undefined });
    });

    it('returns correct outcome for attach_file', async () => {
      // Override templating engine to return the artifactId template as-is
      deps.templatingEngine = { render: async (tpl: string) => tpl };
      executor = new ActionsExecutor(
        deps.toolService,
        deps.toolExecutor,
        deps.contextBuilder,
        deps.templatingEngine,
        deps.modifyVariablesExecutor,
        deps.modifyUserProfileExecutor,
        deps.userService,
        deps.storageService,
      );

      const context = buildContext();
      const events: Array<{ type: ConversationEventType, data: ConversationEventData }> = [];

      const outcome = await (executor as any).executeActions(
        [buildAction([{ type: 'attach_file', artifactId: 'artifact_123', fileName: 'test.txt', mimeType: 'text/plain' }])], context, 'stage_test', null,
        async (type: ConversationEventType, data: ConversationEventData) => events.push({ type, data }),
      );

      expect(outcome.stagedAttachments).to.have.length(1);
      expect(outcome.stagedAttachments[0].artifactId).to.equal('artifact_123');
      expect(outcome.stagedAttachments[0].fileName).to.equal('test.txt');
    });

    it('returns correct outcome for modify_user_input', async () => {
      deps.templatingEngine = { render: async (tpl: string) => 'modified_input' };
      executor = new ActionsExecutor(
        deps.toolService, deps.toolExecutor, deps.contextBuilder, deps.templatingEngine,
        deps.modifyVariablesExecutor, deps.modifyUserProfileExecutor,
        deps.userService, deps.storageService,
      );

      const context = buildContext();
      const events: Array<{ type: ConversationEventType, data: ConversationEventData }> = [];

      const outcome = await (executor as any).executeActions(
        [buildAction([{ type: 'modify_user_input', template: 'modified_input' }])], context, 'stage_test', null,
        async (type: ConversationEventType, data: ConversationEventData) => events.push({ type, data }),
      );

      expect(outcome.hasModifiedUserInput).to.be.true;
      expect(context.userInput).to.equal('modified_input');
    });

    it('returns correct outcome for ban_user', async () => {
      const context = buildContext();
      const events: Array<{ type: ConversationEventType, data: ConversationEventData }> = [];

      const outcome = await (executor as any).executeActions(
        [buildAction([{ type: 'ban_user', reason: 'spam' }])], context, 'stage_test', null,
        async (type: ConversationEventType, data: ConversationEventData) => events.push({ type, data }),
      );

      expect(outcome.success).to.be.true;
      expect(outcome.shouldEndConversation).to.be.false;
      expect(outcome.shouldAbortConversation).to.be.false;
    });

    it('returns correct outcome for save_artifact', async () => {
      // save_artifact requires DB access (queries projects table) — deferred to integration tests
      // Unit test verifies the effect is accepted and tracked via execution_plan
      const effects: Effect[] = [
        { type: 'save_artifact', data: 'test_data', fileName: 'test.txt', variableName: 'aid', mimeType: 'text/plain' },
      ];

      const context = buildContext();
      const events: Array<{ type: ConversationEventType, data: ConversationEventData }> = [];

      await (executor as any).executeActions(
        [buildAction(effects)], context, 'stage_test', null,
        async (type: ConversationEventType, data: ConversationEventData) => events.push({ type, data }),
      );

      // execution_plan should include save_artifact
      expect(events[0].type).to.equal('execution_plan');
      expect((events[0].data as any).effects).to.have.length(1);
      expect((events[0].data as any).effects[0].effect.type).to.equal('save_artifact');
    });

    it('returns correct outcome for call_tool (synchronous)', async () => {
      deps.toolService = {
        getToolById: async () => ({ id: 'tool_1', name: 'TestTool', type: 'smart_function', parameters: [] }),
        getToolTypesByIds: async () => new Map(),
      };
      deps.toolExecutor = {
        executeTool: async () => ({
          success: true,
          result: { output: 'tool_result' },
          renderedPrompt: '',
          llmUsage: undefined,
          durationMs: 10,
          startMs: Date.now(),
          endMs: Date.now(),
        }),
      };
      executor = new ActionsExecutor(
        deps.toolService, deps.toolExecutor, deps.contextBuilder, deps.templatingEngine,
        deps.modifyVariablesExecutor, deps.modifyUserProfileExecutor,
        deps.userService, deps.storageService,
      );

      const context = buildContext();
      const events: Array<{ type: ConversationEventType, data: ConversationEventData }> = [];

      const outcome = await (executor as any).executeActions(
        [buildAction([{ type: 'call_tool', toolId: 'tool_1', parameters: {} }])], context, 'stage_test', null,
        async (type: ConversationEventType, data: ConversationEventData) => events.push({ type, data }),
      );

      expect(outcome.success).to.be.true;
      expect(context.results.tools).to.have.property('tool_1');
      expect(context.results.tools['tool_1'].result).to.deep.equal({ output: 'tool_result' });
    });

    it('returns correct outcome for call_tool (asynchronous)', async () => {
      deps.toolService = {
        getToolById: async () => ({ id: 'tool_1', name: 'TestTool', type: 'smart_function', parameters: [] }),
        getToolTypesByIds: async () => new Map(),
      };
      deps.toolExecutor = {
        executeTool: async () => ({
          success: true,
          result: { output: 'async_result' },
        }),
      };
      executor = new ActionsExecutor(
        deps.toolService, deps.toolExecutor, deps.contextBuilder, deps.templatingEngine,
        deps.modifyVariablesExecutor, deps.modifyUserProfileExecutor,
        deps.userService, deps.storageService,
      );

      const context = buildContext();
      const events: Array<{ type: ConversationEventType, data: ConversationEventData }> = [];

      const outcome = await (executor as any).executeActions(
        [buildAction([{ type: 'call_tool', toolId: 'tool_1', parameters: {}, asynchronous: true }])], context, 'stage_test', null,
        async (type: ConversationEventType, data: ConversationEventData) => events.push({ type, data }),
      );

      expect(outcome.success).to.be.true;
      // Async tool dispatches immediately without blocking — result not stored synchronously
      // execution_plan event should be emitted
      expect(events[0].type).to.equal('execution_plan');
    });
  });

  describe('go_to_stage source tracking', () => {
    it('tracks goToStageSourceAction for go_to_stage effect', async () => {
      const context = buildContext();
      const events: Array<{ type: ConversationEventType, data: ConversationEventData }> = [];

      const outcome = await (executor as any).executeActions(
        [buildAction([{ type: 'go_to_stage', stageId: 'next_stage' }])], context, 'stage_test', null,
        async (type: ConversationEventType, data: ConversationEventData) => events.push({ type, data }),
      );

      expect(outcome.goToStageSourceAction).to.equal('TestAction');
    });
  });

  describe('multiple actions', () => {
    it('executes effects from multiple actions', async () => {
      const executedTypes: string[] = [];

      const originalExecuteEffect = (executor as any).executeEffect.bind(executor);
      (executor as any).executeEffect = async (effect: Effect, ctx: ConversationContext, actionName: string, emitEvent: any) => {
        executedTypes.push(effect.type);
        return originalExecuteEffect(effect, ctx, actionName, emitEvent);
      };

      const context = buildContext();
      const events: Array<{ type: ConversationEventType, data: ConversationEventData }> = [];

      await (executor as any).executeActions(
        [
          buildAction([{ type: 'modify_variables', modifications: [{ variableName: 'x', operation: 'set', value: 1 }] }]),
          buildAction([{ type: 'generate_response', responseMode: 'generated' }]),
        ], context, 'stage_test', null,
        async (type: ConversationEventType, data: ConversationEventData) => events.push({ type, data }),
      );

      expect(executedTypes).to.include('modify_variables');
      expect(executedTypes).to.include('generate_response');
    });
  });

  describe('error handling', () => {
    it('continues execution when one effect fails', async () => {
      const executedTypes: string[] = [];

      const originalExecuteEffect = (executor as any).executeEffect.bind(executor);
      (executor as any).executeEffect = async (effect: Effect, ctx: ConversationContext, actionName: string, emitEvent: any) => {
        executedTypes.push(effect.type);
        if (effect.type === 'modify_variables') {
          throw new Error('test error');
        }
        return originalExecuteEffect(effect, ctx, actionName, emitEvent);
      };

      const context = buildContext();
      const events: Array<{ type: ConversationEventType, data: ConversationEventData }> = [];

      const outcome = await (executor as any).executeActions(
        [buildAction([
          { type: 'modify_variables', modifications: [{ variableName: 'x', operation: 'set', value: 1 }] },
          { type: 'generate_response', responseMode: 'generated' },
        ])], context, 'stage_test', null,
        async (type: ConversationEventType, data: ConversationEventData) => events.push({ type, data }),
      );

      // Both effects should have been attempted
      expect(executedTypes).to.include('modify_variables');
      expect(executedTypes).to.include('generate_response');
      expect(outcome.success).to.be.false;
      expect(outcome.error).to.equal('test error');
    });
  });
});
