import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ConversationContext } from '../../../src/services/live/ConversationContextBuilder';
import type { EffectOutcome, ActionsExecutionOutcome } from '../../../src/services/live/ActionsExecutor';
import type { StageAction, GlobalAction, Guardrail, Effect } from '../../../src/types/actions';
import type { ToolType } from '../../../src/db/schema';

vi.mock('../../../src/services/ToolService', () => {
  const getToolById = vi.fn();
  const getToolTypesByIds = vi.fn().mockResolvedValue(new Map<string, ToolType>());
  return {
    ToolService: class MockToolService {
      getToolById = getToolById;
      getToolTypesByIds = getToolTypesByIds;
    },
    __mocks: { getToolById, getToolTypesByIds },
  };
});

vi.mock('../../../src/services/live/ToolExecutor', () => {
  const executeTool = vi.fn();
  return {
    ToolExecutor: class MockToolExecutor {
      executeTool = executeTool;
    },
    __mocks: { executeTool },
  };
});

vi.mock('../../../src/services/live/ConversationContextBuilder', () => ({
  ConversationContextBuilder: class MockCcb {},
}));

vi.mock('../../../src/services/live/TemplatingEngine', () => {
  const render = vi.fn();
  return {
    TemplatingEngine: class MockTemplatingEngine {
      render = render;
    },
    __mocks: { render },
  };
});

vi.mock('../../../src/services/live/ModifyVariablesEffectExecutor', () => {
  const execute = vi.fn();
  return {
    ModifyVariablesEffectExecutor: class MockMvExec {
      execute = execute;
    },
    __mocks: { execute },
  };
});

vi.mock('../../../src/services/live/ModifyUserProfileEffectExecutor', () => {
  const execute = vi.fn();
  return {
    ModifyUserProfileEffectExecutor: class MockMupExec {
      execute = execute;
    },
    __mocks: { execute },
  };
});

vi.mock('../../../src/services/UserService', () => {
  const banUser = vi.fn();
  return {
    UserService: class MockUserService {
      banUser = banUser;
    },
    __mocks: { banUser },
  };
});

vi.mock('../../../src/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { ActionsExecutor } from '../../../src/services/live/ActionsExecutor';
import { NotFoundError } from '../../../src/errors';
import { __mocks as toolServiceMocks } from '../../../src/services/ToolService';
import { __mocks as toolExecutorMocks } from '../../../src/services/live/ToolExecutor';
import { __mocks as templatingMocks } from '../../../src/services/live/TemplatingEngine';
import { __mocks as mvExecMocks } from '../../../src/services/live/ModifyVariablesEffectExecutor';
import { __mocks as mupExecMocks } from '../../../src/services/live/ModifyUserProfileEffectExecutor';
import { __mocks as userServiceMocks } from '../../../src/services/UserService';

const mockToolServiceGetToolById = toolServiceMocks.getToolById;
const mockToolServiceGetToolTypesByIds = toolServiceMocks.getToolTypesByIds;
const mockToolExecutorExecute = toolExecutorMocks.executeTool;
const mockTemplatingRender = templatingMocks.render;
const mockModifyVariablesExecute = mvExecMocks.execute;
const mockModifyUserProfileExecute = mupExecMocks.execute;
const mockUserServiceBanUser = userServiceMocks.banUser;

const createMockContext = (overrides: Partial<ConversationContext> = {}): ConversationContext => ({
  conversationId: 'conv_test001',
  projectId: 'proj_test001',
  userId: 'user_test001',
  vars: {},
  userProfile: {},
  consts: {},
  history: [],
  events: [],
  actions: {},
  userInput: 'hello',
  results: { webhooks: {}, tools: {} },
  stage: { id: 'stage_current', name: 'Current Stage', availableActions: [], useKnowledge: false, enterBehavior: 'generate_response' },
  project: { timezone: null, languageCode: null, language: null },
  time: { anchor: '', nextTuesday: '', calendar: [] },
  ...overrides,
});

const createAction = (effects: Effect[]): StageAction => ({
  name: 'test_action',
  triggerOnUserInput: true,
  triggerOnClientCommand: false,
  parameters: [],
  effects,
});

const createGlobalAction = (name: string, effects: Effect[]): GlobalAction => ({
  id: `global_${name}`,
  name,
  version: 1,
  trigger: { type: 'manual' },
  effects,
  createdAt: new Date(),
  updatedAt: new Date(),
});

const createGuardrail = (effects: Effect[]): Guardrail => ({
  id: 'guardrail_test',
  name: 'test_guardrail',
  description: null,
  type: 'prompt_injection',
  severity: 'high',
  enabled: true,
  priority: 1,
  condition: null,
  effects,
  createdAt: new Date(),
  updatedAt: new Date(),
});

describe('ActionsExecutor', () => {
  let executor: ActionsExecutor;

  beforeEach(() => {
    vi.clearAllMocks();
    mockToolServiceGetToolById.mockResolvedValue({
      id: 'tool_test001',
      name: 'Test Tool',
      type: 'smart_function' as ToolType,
      inputType: 'text',
      outputType: 'text',
      parameters: [],
    });
    mockToolServiceGetToolTypesByIds.mockResolvedValue(
      new Map([['tool_test001', 'smart_function' as ToolType]])
    );
    mockToolExecutorExecute.mockResolvedValue({
      success: true,
      result: { output: 'tool result' },
      renderedPrompt: 'prompt',
      durationMs: 100,
    });
    mockTemplatingRender.mockImplementation(async (template: string) => template);
    mockModifyVariablesExecute.mockResolvedValue({
      shouldEndConversation: false,
      shouldAbortConversation: false,
      hasModifiedVars: true,
    });
    mockModifyUserProfileExecute.mockResolvedValue({
      shouldEndConversation: false,
      shouldAbortConversation: false,
      hasModifiedUserProfile: true,
    });
    mockUserServiceBanUser.mockResolvedValue(undefined);

    executor = new ActionsExecutor(
      { getToolById: mockToolServiceGetToolById, getToolTypesByIds: mockToolServiceGetToolTypesByIds } as any,
      { executeTool: mockToolExecutorExecute } as any,
      {} as any,
      { render: mockTemplatingRender } as any,
      { execute: mockModifyVariablesExecute } as any,
      { execute: mockModifyUserProfileExecute } as any,
      { banUser: mockUserServiceBanUser } as any,
    );
  });

  describe('executeActions', () => {
    it('returns generate response when no actions provided', async () => {
      const result = await executor.executeActions(
        [],
        createMockContext(),
        'stage_current',
        null!,
        vi.fn()
      );
      expect(result.success).toBe(true);
      expect(result.shouldGenerateResponse).toBe(true);
      expect(result.shouldEndConversation).toBe(false);
    });

    it('executes end_conversation effect', async () => {
      const context = createMockContext();
      const actions = [createAction([{ type: 'end_conversation', reason: 'completed' }])];
      const emitEvent = vi.fn().mockResolvedValue(undefined);

      const result = await executor.executeActions(actions, context, 'stage_current', null!, emitEvent);

      expect(result.success).toBe(true);
      expect(result.shouldEndConversation).toBe(true);
      expect(result.endReason).toBe('completed');
      expect(result.shouldAbortConversation).toBe(false);
    });

    it('executes abort_conversation effect', async () => {
      const context = createMockContext();
      const actions = [createAction([{ type: 'abort_conversation', reason: 'timeout' }])];
      const emitEvent = vi.fn().mockResolvedValue(undefined);

      const result = await executor.executeActions(actions, context, 'stage_current', null!, emitEvent);

      expect(result.success).toBe(true);
      expect(result.shouldAbortConversation).toBe(true);
      expect(result.abortReason).toBe('timeout');
      expect(result.shouldEndConversation).toBe(false);
    });

    it('executes go_to_stage effect', async () => {
      const context = createMockContext();
      const actions = [createAction([{ type: 'go_to_stage', stageId: 'stage_next' }])];
      const emitEvent = vi.fn().mockResolvedValue(undefined);

      const result = await executor.executeActions(actions, context, 'stage_current', null!, emitEvent);

      expect(result.success).toBe(true);
      expect(result.goToStageId).toBe('stage_next');
      expect(context.stage.id).toBe('stage_next');
    });

    it('executes modify_variables effect and emits event', async () => {
      const context = createMockContext();
      const actions = [createAction([{
        type: 'modify_variables',
        modifications: [{ variableName: 'counter', operation: 'set', value: 1 }],
      }])];
      const emitEvent = vi.fn().mockResolvedValue(undefined);

      const result = await executor.executeActions(actions, context, 'stage_current', null!, emitEvent);

      expect(result.success).toBe(true);
      expect(result.hasModifiedVars).toBe(true);
      expect(mockModifyVariablesExecute).toHaveBeenCalled();
      expect(emitEvent).toHaveBeenCalledWith('variables_updated', expect.objectContaining({ sourceActionName: 'test_action' }));
    });

    it('executes modify_user_profile effect and emits event', async () => {
      const context = createMockContext();
      const actions = [createAction([{
        type: 'modify_user_profile',
        modifications: [{ fieldName: 'name', operation: 'set', value: 'Alice' }],
      }])];
      const emitEvent = vi.fn().mockResolvedValue(undefined);

      const result = await executor.executeActions(actions, context, 'stage_current', null!, emitEvent);

      expect(result.success).toBe(true);
      expect(result.hasModifiedUserProfile).toBe(true);
      expect(mockModifyUserProfileExecute).toHaveBeenCalled();
      expect(emitEvent).toHaveBeenCalledWith('user_profile_updated', expect.objectContaining({ sourceActionName: 'test_action' }));
    });

    it('executes call_tool effect with successful result', async () => {
      const context = createMockContext();
      const actions = [createAction([{
        type: 'call_tool',
        toolId: 'tool_test001',
        parameters: { query: 'test' },
      }])];
      const emitEvent = vi.fn().mockResolvedValue(undefined);

      const result = await executor.executeActions(actions, context, 'stage_current', null!, emitEvent);

      expect(result.success).toBe(true);
      expect(mockToolServiceGetToolById).toHaveBeenCalledWith('proj_test001', 'tool_test001');
      expect(mockToolExecutorExecute).toHaveBeenCalled();
      expect(emitEvent).toHaveBeenCalledWith('tool_call', expect.objectContaining({ toolId: 'tool_test001', success: true }));
    });

    it('reports failure when call_tool references non-existent tool', async () => {
      mockToolServiceGetToolById.mockResolvedValue(null);
      const context = createMockContext();
      const actions = [createAction([{
        type: 'call_tool',
        toolId: 'tool_missing',
        parameters: {},
      }])];

      const result = await executor.executeActions(actions, context, 'stage_current', null!, vi.fn());

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('executes generate_response effect (generated mode)', async () => {
      const context = createMockContext();
      const actions = [createAction([{ type: 'generate_response' }])];
      const emitEvent = vi.fn().mockResolvedValue(undefined);

      const result = await executor.executeActions(actions, context, 'stage_current', null!, emitEvent);

      expect(result.success).toBe(true);
      expect(result.shouldGenerateResponse).toBe(true);
    });

    it('executes generate_response effect (prescripted mode)', async () => {
      const context = createMockContext();
      const actions = [createAction([{
        type: 'generate_response',
        responseMode: 'prescripted',
        prescriptedResponses: ['Hello!', 'Hi there!'],
      }])];
      const emitEvent = vi.fn().mockResolvedValue(undefined);

      const result = await executor.executeActions(actions, context, 'stage_current', null!, emitEvent);

      expect(result.success).toBe(true);
      expect(result.shouldGenerateResponse).toBe(true);
      expect(result.prescriptedResponse).toBeDefined();
      expect(['Hello!', 'Hi there!']).toContain(result.prescriptedResponse);
    });

    it('executes generate_response with round_robin strategy', async () => {
      const context = createMockContext({ vars: {} });
      const actions = [createAction([{
        type: 'generate_response',
        responseMode: 'prescripted',
        prescriptedSelectionStrategy: 'round_robin',
        prescriptedResponses: ['First', 'Second', 'Third'],
      }])];

      const result1 = await executor.executeActions(actions, context, 'stage_current', null!, vi.fn());
      expect(result1.prescriptedResponse).toBe('First');

      const result2 = await executor.executeActions(actions, context, 'stage_current', null!, vi.fn());
      expect(result2.prescriptedResponse).toBe('Second');
    });

    it('executes generate_response fallback when no prescripted responses', async () => {
      const context = createMockContext();
      const actions = [createAction([{
        type: 'generate_response',
        responseMode: 'prescripted',
        prescriptedResponses: [],
      }])];

      const result = await executor.executeActions(actions, context, 'stage_current', null!, vi.fn());

      expect(result.shouldGenerateResponse).toBe(true);
      expect(result.prescriptedResponse).toBeUndefined();
    });

    it('executes change_visibility effect', async () => {
      const context = createMockContext();
      const actions = [createAction([{ type: 'change_visibility', visibility: 'never' }])];
      const emitEvent = vi.fn().mockResolvedValue(undefined);

      const result = await executor.executeActions(actions, context, 'stage_current', null!, emitEvent);

      expect(result.success).toBe(true);
      expect(result.turnVisibility).toEqual({ visibility: 'never', condition: undefined });
      expect(emitEvent).toHaveBeenCalledWith('visibility_changed', expect.objectContaining({ sourceActionName: 'test_action' }));
    });

    it('executes ban_user effect', async () => {
      const context = createMockContext();
      const actions = [createAction([{ type: 'ban_user', reason: 'spam' }])];
      const emitEvent = vi.fn().mockResolvedValue(undefined);

      const result = await executor.executeActions(actions, context, 'stage_current', null!, emitEvent);

      expect(result.success).toBe(true);
      expect(mockUserServiceBanUser).toHaveBeenCalledWith('proj_test001', 'user_test001', 'spam');
      expect(emitEvent).toHaveBeenCalledWith('user_banned', expect.objectContaining({ sourceActionName: 'test_action' }));
    });

    it('executes modify_user_input effect with templating', async () => {
      mockTemplatingRender.mockResolvedValue('hello world');
      const context = createMockContext({ vars: { greeting: 'hello' } });
      const actions = [createAction([{ type: 'modify_user_input', template: '{{vars.greeting}} world' }])];
      const emitEvent = vi.fn().mockResolvedValue(undefined);

      const result = await executor.executeActions(actions, context, 'stage_current', null!, emitEvent);

      expect(result.success).toBe(true);
      expect(result.hasModifiedUserInput).toBe(true);
      expect(context.userInput).toBe('hello world');
    });

    it('tracks source action for go_to_stage', async () => {
      const context = createMockContext();
      const actions = [createAction([{ type: 'go_to_stage', stageId: 'stage_next' }])];

      const result = await executor.executeActions(actions, context, 'stage_current', null!, vi.fn());

      expect(result.goToStageSourceAction).toBe('test_action');
    });

    it('tracks source action for end_conversation', async () => {
      const context = createMockContext();
      const actions = [createAction([{ type: 'end_conversation' }])];

      const result = await executor.executeActions(actions, context, 'stage_current', null!, vi.fn());

      expect(result.endConversationSourceAction).toBe('test_action');
    });

    it('tracks source action for abort_conversation', async () => {
      const context = createMockContext();
      const actions = [createAction([{ type: 'abort_conversation' }])];

      const result = await executor.executeActions(actions, context, 'stage_current', null!, vi.fn());

      expect(result.abortConversationSourceAction).toBe('test_action');
    });

    it('executes multiple effects in priority order', async () => {
      const context = createMockContext();
      const emitEvent = vi.fn().mockResolvedValue(undefined);
      const actions = [createAction([
        { type: 'generate_response' },
        { type: 'modify_variables', modifications: [{ variableName: 'x', operation: 'set', value: 1 }] },
        { type: 'call_tool', toolId: 'tool_test001', parameters: {} },
      ])] as any;

      await executor.executeActions(actions, context, 'stage_current', null!, emitEvent);

      const plan = emitEvent.mock.calls.find((c: any) => c[0] === 'execution_plan');
      expect(plan).toBeDefined();
    });

    it('aborts takes precedence over end_conversation', async () => {
      const context = createMockContext();
      const actions = [createAction([
        { type: 'end_conversation', reason: 'done' },
        { type: 'abort_conversation', reason: 'error' },
      ])] as any;

      const result = await executor.executeActions(actions, context, 'stage_current', null!, vi.fn());

      expect(result.shouldAbortConversation).toBe(true);
      expect(result.shouldEndConversation).toBe(false);
    });

    it('handles global action effects', async () => {
      const context = createMockContext();
      const actions = [createGlobalAction('global_test', [{ type: 'end_conversation' }])];

      const result = await executor.executeActions(actions, context, 'stage_current', null!, vi.fn());

      expect(result.shouldEndConversation).toBe(true);
    });

    it('handles guardrail effects', async () => {
      const context = createMockContext();
      const actions = [createGuardrail([{ type: 'abort_conversation' }])];

      const result = await executor.executeActions(actions, context, 'stage_current', null!, vi.fn());

      expect(result.shouldAbortConversation).toBe(true);
    });

    it('emits execution_plan event before effects', async () => {
      const context = createMockContext();
      const emitEvent = vi.fn().mockResolvedValue(undefined);
      const actions = [createAction([{ type: 'go_to_stage', stageId: 'stage_next' }])];

      await executor.executeActions(actions, context, 'stage_current', null!, emitEvent);

      const planCall = emitEvent.mock.calls[0];
      expect(planCall[0]).toBe('execution_plan');
      expect(planCall[1].stageId).toBe('stage_current');
    });

    it('catches effect execution errors and continues', async () => {
      mockModifyVariablesExecute.mockRejectedValue(new Error('modification failed'));
      const context = createMockContext();
      const actions = [createAction([
        { type: 'modify_variables', modifications: [{ variableName: 'x', operation: 'set', value: 1 }] },
        { type: 'go_to_stage', stageId: 'stage_next' },
      ])] as any;

      const result = await executor.executeActions(actions, context, 'stage_current', null!, vi.fn());

      expect(result.success).toBe(false);
      expect(result.error).toContain('modification failed');
    });

    it('filters effects restricted in lifecycle context', async () => {
      const context = createMockContext();
      const actions = [createAction([
        { type: 'generate_response' },
        { type: 'modify_variables', modifications: [{ variableName: 'x', operation: 'set', value: 1 }] },
      ])] as any;

      const result = await executor.executeActions(
        actions,
        context,
        'stage_current',
        'on_enter',
        vi.fn()
      );

      expect(result.hasModifiedVars).toBe(true);
    });

    it('resolves tool parameters with template rendering', async () => {
      mockTemplatingRender.mockResolvedValue('rendered value');
      const context = createMockContext({ vars: { name: 'Alice' } });
      const actions = [createAction([{
        type: 'call_tool',
        toolId: 'tool_test001',
        parameters: { greeting: '{{vars.name}} says hello' },
      }])];

      await executor.executeActions(actions, context, 'stage_current', null!, vi.fn());

      expect(mockToolExecutorExecute).toHaveBeenCalled();
      const params = mockToolExecutorExecute.mock.calls[0][2];
      expect(params.greeting).toBe('rendered value');
    });
  });
});
