import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Session } from '../../../src/channels/SessionManager';
import type { IClientConnection } from '../../../src/channels/IClientConnection';
import type { ConversationState } from '../../../src/types/conversationEvents';
import type { Conversation, Stage, Project, GlobalAction } from '../../../src/types/models';
import type { ILlmProvider, LlmGenerationResult, TokenUsage } from '../../../src/services/providers/llm/ILlmProvider';
import type { IAsrProvider } from '../../../src/services/providers/asr/IAsrProvider';
import type { ITtsProvider } from '../../../src/services/providers/tts/ITtsProvider';
import type { ConversationContext } from '../../../src/services/live/ConversationContextBuilder';
import type { ActionsExecutionOutcome } from '../../../src/services/live/ActionsExecutor';
import type { ModerationResult } from '../../../src/services/ModerationService';
import type { AudioFormat } from '../../../src/types/audio';

/* ------------------------------------------------------------------ */
/*  Mocks                                                              */
/* ------------------------------------------------------------------ */

vi.mock('../../../src/db', () => {
  const conversations = {
    findFirst: vi.fn().mockResolvedValue(null),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    }),
  };
  const users = {
    findFirst: vi.fn().mockResolvedValue(null),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    }),
  };
  const dbUpdate = vi.fn().mockReturnValue({
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue([]),
    }),
  });
  const stages = {
    findFirst: vi.fn().mockResolvedValue(null),
  };
  const projects = {
    findFirst: vi.fn().mockResolvedValue(null),
  };
  const providers = {
    findFirst: vi.fn().mockResolvedValue(null),
  };
  const classifiers = {
    findFirst: vi.fn().mockResolvedValue(null),
  };
  const contextTransformers = {
    findFirst: vi.fn().mockResolvedValue(null),
  };
  const globalActions = {
    findMany: vi.fn().mockResolvedValue([]),
  };
  const guardrails = {
    findMany: vi.fn().mockResolvedValue([]),
  };
  const sampleCopies = {
    findMany: vi.fn().mockResolvedValue([]),
  };
  const tools = {
    findFirst: vi.fn().mockResolvedValue(null),
  };
  const copyDecorators = {
    findFirst: vi.fn().mockResolvedValue(null),
  };

  return {
    db: {
      query: {
        conversations,
        users,
        stages,
        projects,
        providers,
        classifiers,
        contextTransformers,
        globalActions,
        guardrails,
        sampleCopies,
        tools,
        copyDecorators,
      },
      update: dbUpdate,
    },
    __mocks: { conversations, users, stages, projects, providers, classifiers, contextTransformers, globalActions, guardrails, sampleCopies, tools, copyDecorators, dbUpdate },
  };
});

vi.mock('../../../src/services/ConversationService', () => {
  const saveConversationState = vi.fn().mockResolvedValue(undefined);
  const saveConversationEvent = vi.fn().mockResolvedValue('event_test001');
  const updateMessageEvent = vi.fn().mockResolvedValue({ eventData: {} });
  const updateConversationEventMetadata = vi.fn().mockResolvedValue({ eventData: {} });
  const failConversation = vi.fn().mockResolvedValue(undefined);
  return {
    ConversationService: class MockConvService {
      saveConversationState = saveConversationState;
      saveConversationEvent = saveConversationEvent;
      updateMessageEvent = updateMessageEvent;
      updateConversationEventMetadata = updateConversationEventMetadata;
      failConversation = failConversation;
    },
    __mocks: { saveConversationState, saveConversationEvent, updateMessageEvent, updateConversationEventMetadata, failConversation },
  };
});

vi.mock('../../../src/services/AgentService', () => {
  const getAgentById = vi.fn();
  return {
    AgentService: class MockAgentService {
      getAgentById = getAgentById;
    },
    __mocks: { getAgentById },
  };
});

vi.mock('../../../src/services/providers/llm/LlmProviderFactory', () => ({
  LlmProviderFactory: class MockLlmFactory {},
}));

vi.mock('../../../src/services/providers/asr/AsrProviderFactory', () => ({
  AsrProviderFactory: class MockAsrFactory {},
}));

vi.mock('../../../src/services/providers/tts/TtsProviderFactory', () => ({
  TtsProviderFactory: class MockTtsFactory {},
}));

vi.mock('../../../src/services/live/UserInputProcessor', () => {
  const processTextInput = vi.fn();
  return {
    UserInputProcessor: class MockUIP {
      processTextInput = processTextInput;
    },
    __mocks: { processTextInput },
  };
});

vi.mock('../../../src/services/live/ActionsExecutor', () => {
  const executeActions = vi.fn();
  return {
    ActionsExecutor: class MockActionsExec {
      executeActions = executeActions;
    },
    __mocks: { executeActions },
  };
});

vi.mock('../../../src/services/live/ResponseGenerator', () => {
  const generateResponse = vi.fn();
  return {
    ResponseGenerator: class MockRespGen {
      generateResponse = generateResponse;
    },
    __mocks: { generateResponse },
  };
});

vi.mock('../../../src/services/live/ToolExecutor', () => {
  const executeTool = vi.fn();
  return {
    ToolExecutor: class MockToolExec {
      executeTool = executeTool;
    },
    __mocks: { executeTool },
  };
});

vi.mock('../../../src/services/live/ConversationContextBuilder', () => {
  const buildContextForConversationStart = vi.fn();
  const buildContextForUserInput = vi.fn();
  const buildContextForAction = vi.fn();
  const buildContextForFillerSentence = vi.fn();
  return {
    ConversationContextBuilder: class MockCcb {
      buildContextForConversationStart = buildContextForConversationStart;
      buildContextForUserInput = buildContextForUserInput;
      buildContextForAction = buildContextForAction;
      buildContextForFillerSentence = buildContextForFillerSentence;
    },
    __mocks: { buildContextForConversationStart, buildContextForUserInput, buildContextForAction, buildContextForFillerSentence },
  };
});

vi.mock('../../../src/services/live/TemplatingEngine', () => {
  const render = vi.fn();
  return {
    TemplatingEngine: class MockTemplating {
      render = render;
    },
    __mocks: { render },
  };
});

vi.mock('../../../src/services/KnowledgeService', () => {
  const getItemsByCategory = vi.fn().mockResolvedValue([]);
  return {
    KnowledgeService: class MockKnowledgeSvc {
      getItemsByCategory = getItemsByCategory;
    },
    __mocks: { getItemsByCategory },
  };
});

vi.mock('../../../src/services/ModerationService', () => {
  const moderate = vi.fn();
  return {
    ModerationService: class MockModSvc {
      moderate = moderate;
    },
    __mocks: { moderate },
  };
});

vi.mock('../../../src/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../../src/audio/AudioConverterFactory', () => ({
  AudioConverterFactory: {
    create: vi.fn().mockResolvedValue(null),
  },
}));

vi.mock('../../../src/audio/VadProcessor', () => {
  return {
    VadProcessor: class MockVadProc {
      getSampleRateFromFormat = vi.fn();
      init = vi.fn().mockResolvedValue(undefined);
      on = vi.fn();
      reset = vi.fn();
      destroy = vi.fn();
      push = vi.fn();
    },
  };
});

vi.mock('../../../src/utils/idGenerator', () => {
  let counter = 0;
  return {
    generateId: vi.fn(() => `test_id_${counter++}`),
    ID_PREFIXES: { INPUT: 'in', OUTPUT: 'out', CHUNK: 'ch' },
  };
});

vi.mock('../../../src/utils/llm', () => ({
  extractTextFromContent: vi.fn((content) => {
    if (!content || content.length === 0) return '';
    const first = content[0];
    return first?.type === 'text' ? first.text : String(first);
  }),
  getContentSize: vi.fn(() => 100),
}));

vi.mock('../../../src/utils/llmUsage', () => ({
  buildLlmUsage: vi.fn().mockReturnValue(null),
}));

vi.mock('../../../src/utils/costManagement', () => ({
  resolveProviderModelLimits: vi.fn().mockReturnValue(null),
  resolveOutputCap: vi.fn().mockReturnValue(undefined),
}));

vi.mock('../../../src/utils/contextTruncation', () => ({
  truncateMessagesToTokenBudget: vi.fn((messages) => ({
    messages,
    truncated: false,
    removedTokens: 0,
  })),
}));

/* ------------------------------------------------------------------ */
/*  Imports (after mocks)                                              */
/* ------------------------------------------------------------------ */

import { ConversationRunner } from '../../../src/services/live/ConversationRunner';
import { ConversationService } from '../../../src/services/ConversationService';
import { AgentService } from '../../../src/services/AgentService';
import { UserInputProcessor } from '../../../src/services/live/UserInputProcessor';
import { ActionsExecutor } from '../../../src/services/live/ActionsExecutor';
import { ResponseGenerator } from '../../../src/services/live/ResponseGenerator';
import { ToolExecutor } from '../../../src/services/live/ToolExecutor';
import { ConversationContextBuilder } from '../../../src/services/live/ConversationContextBuilder';
import { TemplatingEngine } from '../../../src/services/live/TemplatingEngine';
import { KnowledgeService } from '../../../src/services/KnowledgeService';
import { ModerationService } from '../../../src/services/ModerationService';
import { __mocks as dbMocks } from '../../../src/db';
import { __mocks as convServiceMocks } from '../../../src/services/ConversationService';
import { __mocks as agentServiceMocks } from '../../../src/services/AgentService';
import { __mocks as userInputProcessorMocks } from '../../../src/services/live/UserInputProcessor';
import { __mocks as actionsExecutorMocks } from '../../../src/services/live/ActionsExecutor';
import { __mocks as responseGeneratorMocks } from '../../../src/services/live/ResponseGenerator';
import { __mocks as toolExecutorMocks } from '../../../src/services/live/ToolExecutor';
import { __mocks as contextBuilderMocks } from '../../../src/services/live/ConversationContextBuilder';
import { __mocks as templatingMocks } from '../../../src/services/live/TemplatingEngine';
import { __mocks as knowledgeServiceMocks } from '../../../src/services/KnowledgeService';
import { __mocks as moderationServiceMocks } from '../../../src/services/ModerationService';

const mockConversationsFindFirst = dbMocks.conversations.findFirst;
const mockConversationsUpdate = dbMocks.conversations.update;
const mockUsersFindFirst = dbMocks.users.findFirst;
const mockUsersUpdate = dbMocks.users.update;
const mockStagesFindFirst = dbMocks.stages.findFirst;
const mockProjectsFindFirst = dbMocks.projects.findFirst;
const mockProvidersFindFirst = dbMocks.providers.findFirst;
const mockClassifiersFindFirst = dbMocks.classifiers.findFirst;
const mockContextTransformersFindFirst = dbMocks.contextTransformers.findFirst;
const mockGlobalActionsFindMany = dbMocks.globalActions.findMany;
const mockGuardrailsFindMany = dbMocks.guardrails.findMany;
const mockSampleCopiesFindMany = dbMocks.sampleCopies.findMany;
const mockToolsFindFirst = dbMocks.tools.findFirst;
const mockCopyDecoratorsFindFirst = dbMocks.copyDecorators.findFirst;

const mockSaveConversationState = convServiceMocks.saveConversationState;
const mockSaveConversationEvent = convServiceMocks.saveConversationEvent;
const mockUpdateMessageEvent = convServiceMocks.updateMessageEvent;
const mockFailConversation = convServiceMocks.failConversation;

const mockGetAgentById = agentServiceMocks.getAgentById;
const mockProcessTextInput = userInputProcessorMocks.processTextInput;
const mockExecuteActions = actionsExecutorMocks.executeActions;
const mockGenerateResponseFn = responseGeneratorMocks.generateResponse;
const mockExecuteTool = toolExecutorMocks.executeTool;
const mockBuildContextForConversationStart = contextBuilderMocks.buildContextForConversationStart;
const mockBuildContextForUserInput = contextBuilderMocks.buildContextForUserInput;
const mockBuildContextForAction = contextBuilderMocks.buildContextForAction;
const mockBuildContextForFillerSentence = contextBuilderMocks.buildContextForFillerSentence;
const mockModerate = moderationServiceMocks.moderate;
const mockTemplatingRender = templatingMocks.render;

/* ------------------------------------------------------------------ */
/*  Factories                                                          */
/* ------------------------------------------------------------------ */

function createMockConversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: 'conv_test001',
    projectId: 'proj_test001',
    userId: 'user_test001',
    stageId: 'stage_start',
    status: 'initialized' as ConversationState,
    statusDetails: undefined,
    stageVars: {},
    endingStageId: null,
    metadata: {},
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function createMockStage(overrides: Partial<Stage> = {}): Stage {
  return {
    id: 'stage_start',
    projectId: 'proj_test001',
    agentId: 'agent_test001',
    name: 'Start Stage',
    description: null,
    prompt: 'You are a helpful assistant.',
    enterBehavior: 'awaiting_input',
    defaultClassifierId: null,
    transformerIds: [],
    useGlobalActions: false,
    globalActions: [],
    actions: {},
    availableActions: [],
    llmProviderId: null,
    llmSettings: null,
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function createMockProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'proj_test001',
    name: 'Test Project',
    description: null,
    acceptVoice: false,
    generateVoice: false,
    asrConfig: null,
    moderationConfig: null,
    defaultGuardrailClassifierId: null,
    sampleCopyConfig: null,
    languageCode: null,
    timezone: null,
    costManagementConfig: null,
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function createMockAgent(overrides: Partial<Record<string, any>> = {}) {
  return {
    id: 'agent_test001',
    projectId: 'proj_test001',
    name: 'Test Agent',
    avatarUrl: null,
    ttsProviderId: null,
    ttsSettings: null,
    fillerSettings: null,
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function createMockChannel(): IClientConnection {
  return {
    connectionType: 'websocket' as any,
    sendMessage: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'session_test001',
    projectId: 'proj_test001',
    conversationId: 'conv_test001',
    runner: null as any,
    clientConnection: createMockChannel(),
    sessionSettings: {
      sendVoiceInput: false,
      receiveVoiceOutput: false,
      sendAudioFormat: 'pcm_16000' as AudioFormat,
      receiveAudioFormat: 'pcm_16000' as AudioFormat,
    },
    keySettings: null,
    ...overrides,
  };
}

function createMockLlmProvider(): ILlmProvider {
  return {
    generate: vi.fn().mockResolvedValue({} as LlmGenerationResult),
    setOnChunk: vi.fn(),
    setOnGenerationCompleted: vi.fn(),
    setOnError: vi.fn(),
    cleanup: vi.fn().mockResolvedValue(undefined),
  } as any;
}

function createMockAsrProvider(): IAsrProvider {
  return {
    init: vi.fn().mockResolvedValue(undefined),
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    sendAudio: vi.fn().mockResolvedValue(undefined),
    getAllTextChunks: vi.fn().mockReturnValue([{ text: 'hello', confidence: 0.95 }]),
    resetForNewTurn: vi.fn(),
    setOnRecognitionStarted: vi.fn(),
    setOnRecognizing: vi.fn(),
    setOnRecognized: vi.fn(),
    setOnRecognitionStopped: vi.fn(),
    setOnError: vi.fn(),
    getSupportedInputFormats: vi.fn().mockReturnValue(['pcm_16000' as AudioFormat]),
    cleanup: vi.fn().mockResolvedValue(undefined),
  } as any;
}

function createMockTtsProvider(): ITtsProvider {
  return {
    init: vi.fn().mockResolvedValue(undefined),
    start: vi.fn().mockResolvedValue(undefined),
    end: vi.fn().mockResolvedValue(undefined),
    sendText: vi.fn().mockResolvedValue(undefined),
    getOutputFormat: vi.fn().mockReturnValue('pcm_16000' as AudioFormat),
    setOnGenerationStarted: vi.fn(),
    setOnGenerationEnded: vi.fn(),
    setOnSpeechGenerating: vi.fn(),
    setOnError: vi.fn(),
    cleanup: vi.fn().mockResolvedValue(undefined),
  } as any;
}

function createMockContext(overrides: Partial<ConversationContext> = {}): ConversationContext {
  return {
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
    stage: { id: 'stage_start', name: 'Start Stage', availableActions: [], useKnowledge: false, enterBehavior: 'awaiting_input' as any },
    project: { timezone: null, languageCode: null, language: null },
    time: { anchor: '', nextTuesday: '', calendar: [] },
    userInputSource: 'text',
    originalUserInput: 'hello',
    copy: [],
    copyContent: '',
    faq: [],
    ...overrides,
  };
}

function createDefaultOutcome(overrides: Partial<ActionsExecutionOutcome> = {}): ActionsExecutionOutcome {
  return {
    success: true,
    hasModifiedUserInput: false,
    hasModifiedUserProfile: false,
    hasModifiedVars: false,
    shouldGenerateResponse: false,
    shouldEndConversation: false,
    shouldAbortConversation: false,
    ...overrides,
  };
}

/* ------------------------------------------------------------------ */
/*  Stub setup for prepareConversation                                 */
/* ------------------------------------------------------------------ */

function stubPrepareConversationDB(conversation: Conversation, stage: Stage, project: Project, agent: any) {
  mockConversationsFindFirst.mockResolvedValue(conversation);
  mockStagesFindFirst.mockResolvedValue(stage);
  mockProjectsFindFirst.mockResolvedValue(project);
  mockGetAgentById.mockResolvedValue(agent);
  mockGlobalActionsFindMany.mockResolvedValue([]);
  mockGuardrailsFindMany.mockResolvedValue([]);
  mockSampleCopiesFindMany.mockResolvedValue([]);
  mockProvidersFindFirst.mockResolvedValue(null);
  mockClassifiersFindFirst.mockResolvedValue(null);
  mockContextTransformersFindFirst.mockResolvedValue(null);
  mockCopyDecoratorsFindFirst.mockResolvedValue(null);
}

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe('ConversationRunner', () => {
  let runner: ConversationRunner;
  let channel: IClientConnection;
  let session: Session;

  const conversationService = new ConversationService() as any;
  const agentService = new AgentService() as any;
  const userInputProcessor = new UserInputProcessor() as any;
  const actionsExecutor = new ActionsExecutor() as any;
  const responseGenerator = new ResponseGenerator() as any;
  const toolExecutor = new ToolExecutor() as any;
  const contextBuilder = new ConversationContextBuilder() as any;
  const templatingEngine = new TemplatingEngine() as any;
  const knowledgeService = new KnowledgeService() as any;
  const moderationService = new ModerationService() as any;

  beforeEach(() => {
    vi.clearAllMocks();

    channel = createMockChannel();
    session = createMockSession({ clientConnection: channel });

    runner = new ConversationRunner(
      {} as any,
      {} as any,
      {} as any,
      conversationService,
      contextBuilder,
      agentService,
      userInputProcessor,
      actionsExecutor,
      responseGenerator,
      toolExecutor,
      templatingEngine,
      knowledgeService,
      moderationService,
    );

    mockSaveConversationState.mockResolvedValue(undefined);
    mockSaveConversationEvent.mockResolvedValue('event_test001');
    mockUpdateMessageEvent.mockResolvedValue({ eventData: {} });
    mockFailConversation.mockResolvedValue(undefined);
    mockModerate.mockResolvedValue({
      flagged: false,
      blockingCategories: [],
      detectedCategories: [],
      durationMs: 0,
      startMs: 0,
    } as ModerationResult);
    mockProcessTextInput.mockResolvedValue({
      actions: [],
      knowledgeRetrievalDurationMs: 0,
      sampleCopyResult: null,
    });
    mockExecuteActions.mockResolvedValue(createDefaultOutcome());
    mockBuildContextForConversationStart.mockResolvedValue(createMockContext());
    mockBuildContextForUserInput.mockResolvedValue(createMockContext());
    mockBuildContextForAction.mockResolvedValue(createMockContext());
    mockTemplatingRender.mockImplementation(async (t) => t);
  });

  describe('prepareConversation', () => {
    it('throws when conversation not found', async () => {
      mockConversationsFindFirst.mockResolvedValue(null);
      const conversation = createMockConversation();
      const stage = createMockStage();
      const project = createMockProject();
      mockStagesFindFirst.mockResolvedValue(stage);
      mockProjectsFindFirst.mockResolvedValue(project);
      mockGetAgentById.mockResolvedValue(createMockAgent());
      mockGlobalActionsFindMany.mockResolvedValue([]);
      mockGuardrailsFindMany.mockResolvedValue([]);
      mockSampleCopiesFindMany.mockResolvedValue([]);

      await expect(runner.prepareConversation('conv_missing', session, channel)).rejects.toThrow('not found');
    });

    it('throws when conversation is finished', async () => {
      const conversation = createMockConversation({ status: 'finished' });
      stubPrepareConversationDB(conversation, createMockStage(), createMockProject(), createMockAgent());

      await expect(runner.prepareConversation('conv_test001', session, channel)).rejects.toThrow('not active');
    });

    it('throws when conversation is failed', async () => {
      const conversation = createMockConversation({ status: 'failed' });
      stubPrepareConversationDB(conversation, createMockStage(), createMockProject(), createMockAgent());

      await expect(runner.prepareConversation('conv_test001', session, channel)).rejects.toThrow('not active');
    });

    it('throws when conversation is aborted', async () => {
      const conversation = createMockConversation({ status: 'aborted' });
      stubPrepareConversationDB(conversation, createMockStage(), createMockProject(), createMockAgent());

      await expect(runner.prepareConversation('conv_test001', session, channel)).rejects.toThrow('not active');
    });

    it('loads stage data and wires providers for valid conversation', async () => {
      const conversation = createMockConversation({ status: 'initialized' });
      const stage = createMockStage();
      const project = createMockProject();
      const agent = createMockAgent();
      stubPrepareConversationDB(conversation, stage, project, agent);

      await expect(runner.prepareConversation('conv_test001', session, channel)).resolves.toBeUndefined();
    });
  });

  describe('startConversation', () => {
    beforeEach(async () => {
      const conversation = createMockConversation({ status: 'initialized' });
      const stage = createMockStage();
      const project = createMockProject();
      const agent = createMockAgent();
      stubPrepareConversationDB(conversation, stage, project, agent);
      await runner.prepareConversation('conv_test001', session, channel);
    });

    it('throws when conversation is not in initialized state', async () => {
      (runner as any).conversation.status = 'awaiting_user_input';
      await expect(runner.startConversation()).rejects.toThrow('current state');
    });

    it('transitions to awaiting_user_input when enterBehavior is awaiting_input', async () => {
      const conversation = createMockConversation({ status: 'initialized' });
      const stage = createMockStage({ enterBehavior: 'awaiting_input' });
      const project = createMockProject();
      const agent = createMockAgent();
      stubPrepareConversationDB(conversation, stage, project, agent);
      await runner.prepareConversation('conv_test001', session, channel);

      mockSaveConversationState.mockResolvedValue(undefined);

      await runner.startConversation();

      expect(mockSaveConversationState).toHaveBeenCalledWith(
        'proj_test001',
        'conv_test001',
        'awaiting_user_input',
      );
    });

    it('generates response when enterBehavior is generate_response', async () => {
      const conversation = createMockConversation({ status: 'initialized' });
      const stage = createMockStage({ enterBehavior: 'generate_response' });
      const project = createMockProject();
      const agent = createMockAgent();
      stubPrepareConversationDB(conversation, stage, project, agent);
      await runner.prepareConversation('conv_test001', session, channel);

      mockExecuteActions.mockResolvedValue(createDefaultOutcome({ shouldGenerateResponse: true }));
      mockGenerateResponseFn.mockResolvedValue(undefined);

      await runner.startConversation();

      expect(mockSaveConversationState).toHaveBeenCalledWith(
        'proj_test001',
        'conv_test001',
        'generating_response',
      );
    });

    it('executes __on_enter lifecycle action if defined', async () => {
      const conversation = createMockConversation({ status: 'initialized' });
      const onEnterAction = { name: '__on_enter', triggerOnUserInput: false, triggerOnClientCommand: false, parameters: [], effects: [] };
      const stage = createMockStage({
        enterBehavior: 'awaiting_input',
        actions: { __on_enter: onEnterAction },
      });
      const project = createMockProject();
      const agent = createMockAgent();
      stubPrepareConversationDB(conversation, stage, project, agent);
      await runner.prepareConversation('conv_test001', session, channel);

      mockExecuteActions.mockResolvedValue(createDefaultOutcome());

      await runner.startConversation();

      expect(mockExecuteActions).toHaveBeenCalledWith(
        [onEnterAction],
        expect.any(Object),
        'stage_start',
        'on_enter',
        expect.any(Function),
      );
    });
  });

  describe('resumeConversation', () => {
    it('resumes to awaiting_user_input', async () => {
      const conversation = createMockConversation({ status: 'awaiting_user_input' });
      const stage = createMockStage();
      const project = createMockProject();
      const agent = createMockAgent();
      stubPrepareConversationDB(conversation, stage, project, agent);
      await runner.prepareConversation('conv_test001', session, channel);

      await runner.resumeConversation();

      expect(runner.getState()).toBe('awaiting_user_input');
    });

    it('throws when conversation is finished', async () => {
      const conversation = createMockConversation({ status: 'awaiting_user_input' });
      const stage = createMockStage();
      const project = createMockProject();
      const agent = createMockAgent();
      stubPrepareConversationDB(conversation, stage, project, agent);
      await runner.prepareConversation('conv_test001', session, channel);

      (runner as any).conversation.status = 'finished';
      await expect(runner.resumeConversation()).rejects.toThrow('Cannot resume');
    });
  });

  describe('receiveUserTextInput', () => {
    it('throws when not in awaiting_user_input state', async () => {
      const conversation = createMockConversation({ status: 'processing_user_input' });
      const stage = createMockStage();
      const project = createMockProject();
      const agent = createMockAgent();
      stubPrepareConversationDB(conversation, stage, project, agent);
      await runner.prepareConversation('conv_test001', session, channel);

      await expect(runner.receiveUserTextInput('hello')).rejects.toThrow('Cannot receive user input');
    });

    it('returns an inputTurnId after processing', async () => {
      const conversation = createMockConversation({ status: 'awaiting_user_input' });
      const stage = createMockStage();
      const project = createMockProject();
      const agent = createMockAgent();
      stubPrepareConversationDB(conversation, stage, project, agent);
      await runner.prepareConversation('conv_test001', session, channel);

      mockProcessTextInput.mockResolvedValue({
        actions: [],
        knowledgeRetrievalDurationMs: 0,
        sampleCopyResult: null,
      });
      mockExecuteActions.mockResolvedValue(createDefaultOutcome());

      const result = await runner.receiveUserTextInput('hello');

      expect(result).toBeDefined();
      expect(typeof result).toBe('string');
    });
  });

  describe('voice input', () => {
    it('startUserVoiceInput throws without ASR provider', async () => {
      const conversation = createMockConversation({ status: 'awaiting_user_input' });
      const stage = createMockStage();
      const project = createMockProject({ acceptVoice: false });
      const agent = createMockAgent();
      stubPrepareConversationDB(conversation, stage, project, agent);
      await runner.prepareConversation('conv_test001', session, channel);

      await expect(runner.startUserVoiceInput()).rejects.toThrow('ASR provider not available');
    });

    it('startUserVoiceInput transitions to receiving_user_voice with ASR', async () => {
      const mockAsr = createMockAsrProvider();
      const conversation = createMockConversation({ status: 'awaiting_user_input' });
      const stage = createMockStage();
      const project = createMockProject({
        acceptVoice: true,
        asrConfig: { asrProviderId: 'asr_test001', settings: {} },
      });
      const agent = createMockAgent();
      stubPrepareConversationDB(conversation, stage, project, agent);

      mockProvidersFindFirst.mockResolvedValue({ id: 'asr_test001' });
      (runner as any).stageData = {
        ...((runner as any).stageData || {}),
        asrProvider: mockAsr,
        conversation,
        project,
        stage,
        agent: createMockAgent(),
        ttsProvider: undefined,
        completionLlmProvider: undefined,
        classifiers: [],
        transformers: [],
        globalActions: [],
        guardrails: [],
        sampleCopies: [],
        faq: [],
        costManagementConfig: null,
      };
      (runner as any).conversation = conversation;
      (runner as any).session = session;
      (runner as any).channel = channel;

      await runner.startUserVoiceInput();

      expect(mockAsr.start).toHaveBeenCalled();
    });

    it('stopUserVoiceInput works in receiving_user_voice state', async () => {
      const mockAsr = createMockAsrProvider();
      const conversation = createMockConversation({ status: 'receiving_user_voice' });
      const stage = createMockStage();
      const project = createMockProject({
        acceptVoice: true,
        asrConfig: { asrProviderId: 'asr_test001', settings: {} },
      });
      const agent = createMockAgent();

      (runner as any).conversation = conversation;
      (runner as any).stageData = {
        id: 'stage_start',
        asrProvider: mockAsr,
        conversation,
        project,
        stage,
        agent: createMockAgent(),
        ttsProvider: undefined,
        completionLlmProvider: undefined,
        classifiers: [],
        transformers: [],
        globalActions: [],
        guardrails: [],
        sampleCopies: [],
        faq: [],
        costManagementConfig: null,
      };
      (runner as any).session = session;
      (runner as any).channel = channel;
      (runner as any).turnData = {
        inputTurnId: 'in_test001',
        outputTurnId: undefined,
        startMs: Date.now(),
        promptRenderStartMs: null,
        promptRenderEndMs: null,
        llmStartMs: null,
        firstTokenMs: null,
        firstAudioMs: null,
        assistantMessageEventId: null,
        fillerDurationMs: null,
        fillerLlmUsage: null,
        moderationDurationMs: null,
        moderationStartMs: null,
        moderationEndMs: null,
        asrStartMs: null,
        stageTransitionStartMs: null,
        stageTransitionEndMs: null,
        ttsConnectStartMs: null,
        ttsConnectEndMs: null,
        ttsStartMs: null,
        turnIndex: 1,
        fillerSentence: null,
        prescriptedText: null,
        completionTruncationInfo: null,
      };

      await runner.stopUserVoiceInput('in_test001');

      expect(mockAsr.stop).toHaveBeenCalled();
    });

    it('stopUserVoiceInput throws on turn ID mismatch', async () => {
      const mockAsr = createMockAsrProvider();
      const conversation = createMockConversation({ status: 'receiving_user_voice' });
      const stage = createMockStage();
      const project = createMockProject({ acceptVoice: true, asrConfig: { asrProviderId: 'asr_test001', settings: {} } });
      const agent = createMockAgent();

      (runner as any).conversation = conversation;
      (runner as any).stageData = {
        id: 'stage_start',
        asrProvider: mockAsr,
        conversation, project, stage,
        agent: createMockAgent(),
        ttsProvider: undefined, completionLlmProvider: undefined,
        classifiers: [], transformers: [], globalActions: [], guardrails: [],
        sampleCopies: [], faq: [], costManagementConfig: null,
      };
      (runner as any).session = session;
      (runner as any).channel = channel;
      (runner as any).turnData = {
        inputTurnId: 'in_correct',
        outputTurnId: undefined, startMs: Date.now(),
        promptRenderStartMs: null, promptRenderEndMs: null, llmStartMs: null,
        firstTokenMs: null, firstAudioMs: null, assistantMessageEventId: null,
        fillerDurationMs: null, fillerLlmUsage: null, moderationDurationMs: null,
        moderationStartMs: null, moderationEndMs: null, asrStartMs: null,
        stageTransitionStartMs: null, stageTransitionEndMs: null,
        ttsConnectStartMs: null, ttsConnectEndMs: null, ttsStartMs: null,
        turnIndex: 1, fillerSentence: null, prescriptedText: null, completionTruncationInfo: null,
      };

      await expect(runner.stopUserVoiceInput('in_wrong')).rejects.toThrow('Input turn ID mismatch');
    });
  });

  describe('goToStage', () => {
    it('throws when not in awaiting_user_input state', async () => {
      const conversation = createMockConversation({ status: 'processing_user_input' });
      const stage = createMockStage();
      const project = createMockProject();
      const agent = createMockAgent();
      stubPrepareConversationDB(conversation, stage, project, agent);
      await runner.prepareConversation('conv_test001', session, channel);

      await expect(runner.goToStage('stage_other')).rejects.toThrow('Cannot navigate');
    });
  });

  describe('variables', () => {
    it('setVariable throws when stage ID mismatch', async () => {
      const conversation = createMockConversation({ status: 'awaiting_user_input' });
      const stage = createMockStage();
      const project = createMockProject();
      const agent = createMockAgent();
      stubPrepareConversationDB(conversation, stage, project, agent);
      await runner.prepareConversation('conv_test001', session, channel);

      await expect(runner.setVariable('stage_other', 'key', 'value')).rejects.toThrow('Stage ID mismatch');
    });

    it('setVariable throws when not in awaiting_user_input state', async () => {
      const conversation = createMockConversation({ status: 'processing_user_input' });
      const stage = createMockStage();
      const project = createMockProject();
      const agent = createMockAgent();
      stubPrepareConversationDB(conversation, stage, project, agent);
      await runner.prepareConversation('conv_test001', session, channel);

      await expect(runner.setVariable('stage_start', 'key', 'value')).rejects.toThrow('Cannot set variable');
    });

    it('getVariable throws when stage ID mismatch', async () => {
      const conversation = createMockConversation({ status: 'awaiting_user_input' });
      const stage = createMockStage();
      const project = createMockProject();
      const agent = createMockAgent();
      stubPrepareConversationDB(conversation, stage, project, agent);
      await runner.prepareConversation('conv_test001', session, channel);

      await expect(runner.getVariable('stage_other', 'key')).rejects.toThrow('Stage ID mismatch');
    });

    it('getAllVariables throws when stage ID mismatch', async () => {
      const conversation = createMockConversation({ status: 'awaiting_user_input' });
      const stage = createMockStage();
      const project = createMockProject();
      const agent = createMockAgent();
      stubPrepareConversationDB(conversation, stage, project, agent);
      await runner.prepareConversation('conv_test001', session, channel);

      await expect(runner.getAllVariables('stage_other')).rejects.toThrow('Stage ID mismatch');
    });
  });

  describe('user profile', () => {
    it('setUserProfileField throws when user not found', async () => {
      const conversation = createMockConversation({ status: 'awaiting_user_input' });
      const stage = createMockStage();
      const project = createMockProject();
      const agent = createMockAgent();
      stubPrepareConversationDB(conversation, stage, project, agent);
      await runner.prepareConversation('conv_test001', session, channel);

      mockUsersFindFirst.mockResolvedValue(null);

      await expect(runner.setUserProfileField('name', 'Alice')).rejects.toThrow('not found');
    });

    it('getUserProfileField throws when user not found', async () => {
      const conversation = createMockConversation({ status: 'awaiting_user_input' });
      const stage = createMockStage();
      const project = createMockProject();
      const agent = createMockAgent();
      stubPrepareConversationDB(conversation, stage, project, agent);
      await runner.prepareConversation('conv_test001', session, channel);

      mockUsersFindFirst.mockResolvedValue(null);

      await expect(runner.getUserProfileField('name')).rejects.toThrow('not found');
    });
  });

  describe('runAction', () => {
    it('throws when not in awaiting_user_input state', async () => {
      const conversation = createMockConversation({ status: 'processing_user_input' });
      const stage = createMockStage();
      const project = createMockProject();
      const agent = createMockAgent();
      stubPrepareConversationDB(conversation, stage, project, agent);
      await runner.prepareConversation('conv_test001', session, channel);

      await expect(runner.runAction('test_action', {})).rejects.toThrow('Cannot run action');
    });

    it('throws when action not found', async () => {
      const conversation = createMockConversation({ status: 'awaiting_user_input' });
      const stage = createMockStage();
      const project = createMockProject();
      const agent = createMockAgent();
      stubPrepareConversationDB(conversation, stage, project, agent);
      await runner.prepareConversation('conv_test001', session, channel);

      await expect(runner.runAction('nonexistent_action', {})).rejects.toThrow('not found');
    });
  });

  describe('callTool', () => {
    it('throws when tool not found', async () => {
      const conversation = createMockConversation({ status: 'awaiting_user_input' });
      const stage = createMockStage();
      const project = createMockProject();
      const agent = createMockAgent();
      stubPrepareConversationDB(conversation, stage, project, agent);
      await runner.prepareConversation('conv_test001', session, channel);

      mockToolsFindFirst.mockResolvedValue(null);

      await expect(runner.callTool('tool_missing', {})).rejects.toThrow('not found');
    });
  });

  describe('cleanup', () => {
    it('cleans up ASR provider', async () => {
      const mockAsr = createMockAsrProvider();
      (runner as any).stageData = {
        id: 'stage_start',
        asrProvider: mockAsr,
        ttsProvider: undefined,
        completionLlmProvider: undefined,
        fillerLlmProvider: undefined,
        classifiers: [],
        transformers: [],
        guardrailClassifier: undefined,
      };

      await runner.cleanup();

      expect(mockAsr.cleanup).toHaveBeenCalled();
    });

    it('cleans up TTS provider', async () => {
      const mockTts = createMockTtsProvider();
      (runner as any).stageData = {
        id: 'stage_start',
        asrProvider: undefined,
        ttsProvider: mockTts,
        completionLlmProvider: undefined,
        fillerLlmProvider: undefined,
        classifiers: [],
        transformers: [],
        guardrailClassifier: undefined,
      };

      await runner.cleanup();

      expect(mockTts.cleanup).toHaveBeenCalled();
    });

    it('cleans up completion LLM provider', async () => {
      const mockLlm = createMockLlmProvider();
      (runner as any).stageData = {
        id: 'stage_start',
        asrProvider: undefined,
        ttsProvider: undefined,
        completionLlmProvider: mockLlm,
        fillerLlmProvider: undefined,
        classifiers: [],
        transformers: [],
        guardrailClassifier: undefined,
      };

      await runner.cleanup();

      expect(mockLlm.cleanup).toHaveBeenCalled();
    });

    it('cleans up classifier LLM providers', async () => {
      const mockLlm1 = createMockLlmProvider();
      const mockLlm2 = createMockLlmProvider();
      (runner as any).stageData = {
        id: 'stage_start',
        asrProvider: undefined,
        ttsProvider: undefined,
        completionLlmProvider: undefined,
        fillerLlmProvider: undefined,
        classifiers: [
          { classifier: { id: 'clf1', name: 'Classifier 1' }, llmProvider: mockLlm1, llmProviderInfo: { id: 'prov1', apiType: 'openai' } },
          { classifier: { id: 'clf2', name: 'Classifier 2' }, llmProvider: mockLlm2, llmProviderInfo: { id: 'prov2', apiType: 'openai' } },
        ],
        transformers: [],
        guardrailClassifier: undefined,
      };

      await runner.cleanup();

      expect(mockLlm1.cleanup).toHaveBeenCalled();
      expect(mockLlm2.cleanup).toHaveBeenCalled();
    });

    it('cleans up transformer LLM providers', async () => {
      const mockLlm = createMockLlmProvider();
      (runner as any).stageData = {
        id: 'stage_start',
        asrProvider: undefined,
        ttsProvider: undefined,
        completionLlmProvider: undefined,
        fillerLlmProvider: undefined,
        classifiers: [],
        transformers: [
          { transformer: { id: 'trf1', name: 'Transformer 1' }, llmProvider: mockLlm, llmProviderInfo: { id: 'prov1', apiType: 'openai' } },
        ],
        guardrailClassifier: undefined,
      };

      await runner.cleanup();

      expect(mockLlm.cleanup).toHaveBeenCalled();
    });

    it('cleans up guardrail classifier LLM provider', async () => {
      const mockLlm = createMockLlmProvider();
      (runner as any).stageData = {
        id: 'stage_start',
        asrProvider: undefined,
        ttsProvider: undefined,
        completionLlmProvider: undefined,
        fillerLlmProvider: undefined,
        classifiers: [],
        transformers: [],
        guardrailClassifier: { classifier: { id: 'clf_guard', name: 'Guard' }, llmProvider: mockLlm, llmProviderInfo: { id: 'prov1', apiType: 'openai' } },
      };

      await runner.cleanup();

      expect(mockLlm.cleanup).toHaveBeenCalled();
    });

    it('handles cleanup errors gracefully without throwing', async () => {
      const mockAsr = createMockAsrProvider();
      mockAsr.cleanup.mockRejectedValue(new Error('cleanup failed'));
      (runner as any).stageData = {
        id: 'stage_start',
        asrProvider: mockAsr,
        ttsProvider: undefined,
        completionLlmProvider: undefined,
        fillerLlmProvider: undefined,
        classifiers: [],
        transformers: [],
        guardrailClassifier: undefined,
      };

      await expect(runner.cleanup()).resolves.toBeUndefined();
    });

    it('handles cleanup when stageData is not set', async () => {
      (runner as any).stageData = undefined;

      await expect(runner.cleanup()).resolves.toBeUndefined();
    });
  });

  describe('getState / getFailureReason', () => {
    it('returns the current conversation state', async () => {
      const conversation = createMockConversation({ status: 'awaiting_user_input' });
      const stage = createMockStage();
      const project = createMockProject();
      const agent = createMockAgent();
      stubPrepareConversationDB(conversation, stage, project, agent);
      await runner.prepareConversation('conv_test001', session, channel);

      expect(runner.getState()).toBe('awaiting_user_input');
    });

    it('returns undefined failure reason when not failed', async () => {
      const conversation = createMockConversation({ status: 'awaiting_user_input' });
      const stage = createMockStage();
      const project = createMockProject();
      const agent = createMockAgent();
      stubPrepareConversationDB(conversation, stage, project, agent);
      await runner.prepareConversation('conv_test001', session, channel);

      expect(runner.getFailureReason()).toBeUndefined();
    });
  });

  describe('concurrent input rejection', () => {
    it('rejects user text input during processing', async () => {
      const conversation = createMockConversation({ status: 'processing_user_input' });
      const stage = createMockStage();
      const project = createMockProject();
      const agent = createMockAgent();
      stubPrepareConversationDB(conversation, stage, project, agent);
      await runner.prepareConversation('conv_test001', session, channel);

      await expect(runner.receiveUserTextInput('hello')).rejects.toThrow('Cannot receive user input');
    });

    it('rejects user text input during response generation', async () => {
      const conversation = createMockConversation({ status: 'generating_response' });
      const stage = createMockStage();
      const project = createMockProject();
      const agent = createMockAgent();
      stubPrepareConversationDB(conversation, stage, project, agent);
      await runner.prepareConversation('conv_test001', session, channel);

      await expect(runner.receiveUserTextInput('hello')).rejects.toThrow('Cannot receive user input');
    });

    it('rejects voice input during processing', async () => {
      const conversation = createMockConversation({ status: 'processing_user_input' });
      const stage = createMockStage();
      const project = createMockProject();
      const agent = createMockAgent();
      stubPrepareConversationDB(conversation, stage, project, agent);
      await runner.prepareConversation('conv_test001', session, channel);

      await expect(runner.startUserVoiceInput()).rejects.toThrow('Cannot start receiving');
    });
  });

  describe('moderation processing', () => {
    it('handles flagged content with __moderation_blocked action', async () => {
      const conversation = createMockConversation({ status: 'awaiting_user_input' });
      const moderationBlockedAction = { id: '__moderation_blocked', name: '__moderation_blocked' };
      const stage = createMockStage({
        globalActions: [moderationBlockedAction as any],
        useGlobalActions: true,
      });
      const project = createMockProject({
        moderationConfig: { mode: 'strict' as any, providerId: 'mod_test001' },
      });
      const agent = createMockAgent();

      // Override global actions mock to include the moderation blocked action
      mockConversationsFindFirst.mockResolvedValue(conversation);
      mockStagesFindFirst.mockResolvedValue(stage);
      mockProjectsFindFirst.mockResolvedValue(project);
      mockGetAgentById.mockResolvedValue(agent);
      mockGlobalActionsFindMany.mockResolvedValue([moderationBlockedAction]);
      mockGuardrailsFindMany.mockResolvedValue([]);
      mockSampleCopiesFindMany.mockResolvedValue([]);
      mockProvidersFindFirst.mockResolvedValue(null);
      mockClassifiersFindFirst.mockResolvedValue(null);
      mockContextTransformersFindFirst.mockResolvedValue(null);
      mockCopyDecoratorsFindFirst.mockResolvedValue(null);

      mockModerate.mockResolvedValue({
        flagged: true,
        blockingCategories: ['violence'],
        detectedCategories: ['violence'],
        durationMs: 50,
        startMs: Date.now() - 50,
        endMs: Date.now(),
      } as any);

      mockBuildContextForUserInput.mockResolvedValue(createMockContext());
      mockProcessTextInput.mockResolvedValue({
        actions: [],
        knowledgeRetrievalDurationMs: 0,
        sampleCopyResult: null,
      });
      mockExecuteActions.mockResolvedValue(createDefaultOutcome({ shouldGenerateResponse: true }));
      mockGenerateResponseFn.mockResolvedValue(undefined);

      await runner.prepareConversation('conv_test001', session, channel);
      const inputTurnId = await runner.receiveUserTextInput('bad content');

      expect(inputTurnId).toBeDefined();
      expect(mockModerate).toHaveBeenCalled();
      // Verify moderation blocked action was executed (check first argument is array with the action)
      const execCalls = mockExecuteActions.mock.calls;
      const moderationCall = execCalls.find(call => call[0]?.length > 0 && call[0][0].name === '__moderation_blocked');
      expect(moderationCall).toBeDefined();
    });

    it('sanitizes input when flagged but no __moderation_blocked action', async () => {
      const conversation = createMockConversation({ status: 'awaiting_user_input' });
      const stage = createMockStage({ globalActions: [], useGlobalActions: false });
      const project = createMockProject({
        moderationConfig: { mode: 'strict' as any, providerId: 'mod_test001' },
      });
      const agent = createMockAgent();
      stubPrepareConversationDB(conversation, stage, project, agent);

      mockModerate.mockResolvedValue({
        flagged: true,
        blockingCategories: ['violence'],
        detectedCategories: ['violence'],
        durationMs: 50,
        startMs: Date.now() - 50,
        endMs: Date.now(),
      } as any);

      mockBuildContextForUserInput.mockResolvedValue(createMockContext());
      mockProcessTextInput.mockResolvedValue({
        actions: [],
        knowledgeRetrievalDurationMs: 0,
        sampleCopyResult: null,
      });
      mockExecuteActions.mockResolvedValue(createDefaultOutcome());

      await runner.prepareConversation('conv_test001', session, channel);
      const inputTurnId = await runner.receiveUserTextInput('bad content');

      expect(inputTurnId).toBeDefined();
      expect(mockModerate).toHaveBeenCalled();
      // processTextInput is called with (session, sanitizedInput, originalInput)
      const procCalls = mockProcessTextInput.mock.calls;
      const hasSanitizedCall = procCalls.some(call =>
        call[1] === '[Content removed by moderation]' && call[2] === '[Content removed by moderation]',
      );
      expect(hasSanitizedCall).toBe(true);
    });
  });

  describe('prescripted response delivery', () => {
    it('delivers prescripted response without TTS', async () => {
      const conversation = createMockConversation({ status: 'awaiting_user_input' });
      const stage = createMockStage();
      const project = createMockProject();
      const agent = createMockAgent();
      stubPrepareConversationDB(conversation, stage, project, agent);

      mockBuildContextForUserInput.mockResolvedValue(createMockContext());
      mockProcessTextInput.mockResolvedValue({
        actions: [],
        knowledgeRetrievalDurationMs: 0,
        sampleCopyResult: null,
      });
      mockExecuteActions.mockResolvedValue(createDefaultOutcome({
        shouldGenerateResponse: true,
        prescriptedResponse: 'Hello, this is a prescripted response.',
      }));

      await runner.prepareConversation('conv_test001', session, channel);
      await runner.receiveUserTextInput('hello');

      expect(channel.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'end_ai_generation_output',
          fullText: 'Hello, this is a prescripted response.',
        }),
      );
    });

    it('delivers prescripted response with TTS', async () => {
      const mockTts = createMockTtsProvider();
      const conversation = createMockConversation({ status: 'awaiting_user_input' });
      const stage = createMockStage();
      const project = createMockProject();
      const agent = createMockAgent({ ttsProviderId: 'tts_test001', ttsSettings: { voiceId: 'voice1' } });
      stubPrepareConversationDB(conversation, stage, project, agent);

      mockBuildContextForUserInput.mockResolvedValue(createMockContext());
      mockProcessTextInput.mockResolvedValue({
        actions: [],
        knowledgeRetrievalDurationMs: 0,
        sampleCopyResult: null,
      });
      mockExecuteActions.mockResolvedValue(createDefaultOutcome({
        shouldGenerateResponse: true,
        prescriptedResponse: 'TTS response text.',
      }));

      await runner.prepareConversation('conv_test001', session, channel);
      (runner as any).stageData.ttsProvider = mockTts;
      await runner.receiveUserTextInput('hello');

      expect(mockTts.sendText).toHaveBeenCalledWith('TTS response text.');
      expect(mockTts.end).toHaveBeenCalled();
    });
  });

  describe('post-response actions', () => {
    it('executes end_conversation with __on_end lifecycle action', async () => {
      const conversation = createMockConversation({ status: 'awaiting_user_input' });
      const stage = createMockStage();
      const project = createMockProject();
      const agent = createMockAgent();
      stubPrepareConversationDB(conversation, stage, project, agent);

      (runner as any).conversationLifecycleActions = new Map([
        ['__conversation_end', { id: '__conversation_end', name: '__conversation_end' }],
      ]);

      mockBuildContextForUserInput.mockResolvedValue(createMockContext());
      mockProcessTextInput.mockResolvedValue({
        actions: [],
        knowledgeRetrievalDurationMs: 0,
        sampleCopyResult: null,
      });
      mockExecuteActions.mockResolvedValue(createDefaultOutcome({
        shouldGenerateResponse: true,
        shouldEndConversation: true,
        endConversationSourceAction: 'test_action',
        endReason: 'Test completion',
      }));
      mockGenerateResponseFn.mockResolvedValue(undefined);

      await runner.prepareConversation('conv_test001', session, channel);
      await runner.receiveUserTextInput('hello');

      expect(mockSaveConversationState).toHaveBeenCalledWith(
        'proj_test001',
        'conv_test001',
        'finished',
        undefined,
        undefined,
        'stage_start',
      );
    });

    it('executes abort_conversation with __on_abort lifecycle action', async () => {
      const conversation = createMockConversation({ status: 'awaiting_user_input' });
      const stage = createMockStage();
      const project = createMockProject();
      const agent = createMockAgent();
      stubPrepareConversationDB(conversation, stage, project, agent);

      (runner as any).conversationLifecycleActions = new Map([
        ['__conversation_abort', { id: '__conversation_abort', name: '__conversation_abort' }],
      ]);

      mockBuildContextForUserInput.mockResolvedValue(createMockContext());
      mockProcessTextInput.mockResolvedValue({
        actions: [],
        knowledgeRetrievalDurationMs: 0,
        sampleCopyResult: null,
      });
      mockExecuteActions.mockResolvedValue(createDefaultOutcome({
        shouldGenerateResponse: true,
        shouldAbortConversation: true,
        abortConversationSourceAction: 'test_action',
        abortReason: 'Test abort',
      }));
      mockGenerateResponseFn.mockResolvedValue(undefined);

      await runner.prepareConversation('conv_test001', session, channel);
      await runner.receiveUserTextInput('hello');

      expect(mockSaveConversationState).toHaveBeenCalledWith(
        'proj_test001',
        'conv_test001',
        'finished',
        undefined,
        undefined,
        'stage_start',
      );
    });

    it('transitions to awaiting_user_input when no terminal action after response', async () => {
      const conversation = createMockConversation({ status: 'awaiting_user_input' });
      const stage = createMockStage();
      const project = createMockProject();
      const agent = createMockAgent();
      stubPrepareConversationDB(conversation, stage, project, agent);

      mockBuildContextForUserInput.mockResolvedValue(createMockContext());
      mockProcessTextInput.mockResolvedValue({
        actions: [],
        knowledgeRetrievalDurationMs: 0,
        sampleCopyResult: null,
      });
      mockExecuteActions.mockResolvedValue(createDefaultOutcome({
        shouldGenerateResponse: true,
      }));
      mockGenerateResponseFn.mockResolvedValue(undefined);

      await runner.prepareConversation('conv_test001', session, channel);
      await runner.receiveUserTextInput('hello');

      expect(mockSaveConversationState).toHaveBeenCalledWith(
        'proj_test001',
        'conv_test001',
        'awaiting_user_input',
      );
    });

    it('closes filler turn and returns to idle when no response and no terminal action', async () => {
      const mockTts = createMockTtsProvider();
      const conversation = createMockConversation({ status: 'awaiting_user_input' });
      const stage = createMockStage();
      const project = createMockProject();
      const agent = createMockAgent({ ttsProviderId: 'tts_test001', ttsSettings: { voiceId: 'voice1' } });
      stubPrepareConversationDB(conversation, stage, project, agent);

      mockBuildContextForUserInput.mockResolvedValue(createMockContext());
      mockProcessTextInput.mockResolvedValue({
        actions: [],
        knowledgeRetrievalDurationMs: 0,
        sampleCopyResult: null,
      });
      mockExecuteActions.mockResolvedValue(createDefaultOutcome({}));

      await runner.prepareConversation('conv_test001', session, channel);
      (runner as any).stageData.ttsProvider = mockTts;
      (runner as any).responseOutputTurnStarted = true;
      await runner.receiveUserTextInput('hello');

      expect(mockTts.end).toHaveBeenCalled();
      expect(mockSaveConversationState).toHaveBeenCalledWith(
        'proj_test001',
        'conv_test001',
        'awaiting_user_input',
      );
    });

    it('aborts immediately without response when shouldAbortConversation is true', async () => {
      const conversation = createMockConversation({ status: 'awaiting_user_input' });
      const stage = createMockStage();
      const project = createMockProject();
      const agent = createMockAgent();
      stubPrepareConversationDB(conversation, stage, project, agent);

      mockBuildContextForUserInput.mockResolvedValue(createMockContext());
      mockProcessTextInput.mockResolvedValue({
        actions: [],
        knowledgeRetrievalDurationMs: 0,
        sampleCopyResult: null,
      });
      mockExecuteActions.mockResolvedValue(createDefaultOutcome({
        shouldGenerateResponse: false,
        shouldAbortConversation: true,
        abortConversationSourceAction: 'test_action',
        abortReason: 'Immediate abort',
      }));

      await runner.prepareConversation('conv_test001', session, channel);
      await runner.receiveUserTextInput('hello');

      expect(mockSaveConversationState).toHaveBeenCalledWith(
        'proj_test001',
        'conv_test001',
        'finished',
        undefined,
        undefined,
        'stage_start',
      );
    });

    it('aborts without response and cleans up TTS filler turn', async () => {
      const mockTts = createMockTtsProvider();
      const conversation = createMockConversation({ status: 'awaiting_user_input' });
      const stage = createMockStage();
      const project = createMockProject();
      const agent = createMockAgent({ ttsProviderId: 'tts_test001', ttsSettings: { voiceId: 'voice1' } });
      stubPrepareConversationDB(conversation, stage, project, agent);

      mockBuildContextForUserInput.mockResolvedValue(createMockContext());
      mockProcessTextInput.mockResolvedValue({
        actions: [],
        knowledgeRetrievalDurationMs: 0,
        sampleCopyResult: null,
      });
      mockExecuteActions.mockResolvedValue(createDefaultOutcome({
        shouldGenerateResponse: false,
        shouldAbortConversation: true,
        abortConversationSourceAction: 'test_action',
        abortReason: 'Abort with TTS cleanup',
      }));

      await runner.prepareConversation('conv_test001', session, channel);
      (runner as any).stageData.ttsProvider = mockTts;
      (runner as any).responseOutputTurnStarted = true;
      await runner.receiveUserTextInput('hello');

      expect(mockTts.end).toHaveBeenCalled();
    });

    it('applies turnVisibility from execution outcome', async () => {
      const conversation = createMockConversation({ status: 'awaiting_user_input' });
      const stage = createMockStage();
      const project = createMockProject();
      const agent = createMockAgent();
      stubPrepareConversationDB(conversation, stage, project, agent);

      mockBuildContextForUserInput.mockResolvedValue(createMockContext());
      mockProcessTextInput.mockResolvedValue({
        actions: [],
        knowledgeRetrievalDurationMs: 0,
        sampleCopyResult: null,
      });
      mockExecuteActions.mockResolvedValue(createDefaultOutcome({
        shouldGenerateResponse: true,
        turnVisibility: 'hidden',
      }));
      mockGenerateResponseFn.mockResolvedValue(undefined);

      await runner.prepareConversation('conv_test001', session, channel);
      await runner.receiveUserTextInput('hello');

      expect((runner as any).turnMessageVisibility).toBe('hidden');
    });
  });

  describe('__on_fallback lifecycle action', () => {
    it('executes __on_fallback when no actions matched', async () => {
      const conversation = createMockConversation({ status: 'awaiting_user_input' });
      const fallbackAction = { id: '__on_fallback', name: '__on_fallback' };
      const stage = createMockStage({
        actions: { __on_fallback: fallbackAction },
      });
      const project = createMockProject();
      const agent = createMockAgent();
      stubPrepareConversationDB(conversation, stage, project, agent);

      mockBuildContextForUserInput.mockResolvedValue(createMockContext());
      mockProcessTextInput.mockResolvedValue({
        actions: [], // No actions matched
        knowledgeRetrievalDurationMs: 0,
        sampleCopyResult: null,
      });
      mockExecuteActions.mockResolvedValue(createDefaultOutcome());

      await runner.prepareConversation('conv_test001', session, channel);
      await runner.receiveUserTextInput('hello');

      // Verify fallback action was executed
      const execCalls = mockExecuteActions.mock.calls;
      const fallbackCall = execCalls.find(call => call[0]?.length > 0 && call[0][0].name === '__on_fallback');
      expect(fallbackCall).toBeDefined();
    });
  });

  describe('duplicate response guard', () => {
    it('skips duplicate response generation in the same turn', async () => {
      const conversation = createMockConversation({ status: 'awaiting_user_input' });
      const stage = createMockStage();
      const project = createMockProject();
      const agent = createMockAgent();
      stubPrepareConversationDB(conversation, stage, project, agent);

      mockBuildContextForUserInput.mockResolvedValue(createMockContext());
      mockProcessTextInput.mockResolvedValue({
        actions: [],
        knowledgeRetrievalDurationMs: 0,
        sampleCopyResult: null,
      });
      mockExecuteActions.mockResolvedValue(createDefaultOutcome({
        shouldGenerateResponse: true,
      }));
      mockGenerateResponseFn.mockResolvedValue(undefined);

      await runner.prepareConversation('conv_test001', session, channel);
      await runner.receiveUserTextInput('hello');

      // Response was generated, guard is now set
      expect((runner as any).responseGeneratedInTurn).toBe(true);
    });

    it('skips generation when responseGeneratedInTurn is already true', async () => {
      const conversation = createMockConversation({ status: 'awaiting_user_input' });
      const stage = createMockStage();
      const project = createMockProject();
      const agent = createMockAgent();
      stubPrepareConversationDB(conversation, stage, project, agent);

      mockBuildContextForUserInput.mockResolvedValue(createMockContext());
      mockProcessTextInput.mockResolvedValue({
        actions: [],
        knowledgeRetrievalDurationMs: 0,
        sampleCopyResult: null,
      });
      mockExecuteActions.mockResolvedValue(createDefaultOutcome({
        shouldGenerateResponse: true,
      }));
      mockGenerateResponseFn.mockResolvedValue(undefined);

      await runner.prepareConversation('conv_test001', session, channel);
      // Set the guard flag before calling generateResponse
      (runner as any).responseGeneratedInTurn = true;

      await (runner as any).generateResponse(
        createMockContext(),
        createDefaultOutcome({ shouldGenerateResponse: true }),
      );

      // Should have returned early without generating
      expect(mockGenerateResponseFn).not.toHaveBeenCalled();
    });

    it('resets responseOutputTurnStarted when filler already opened the turn', async () => {
      const conversation = createMockConversation({ status: 'awaiting_user_input' });
      const stage = createMockStage();
      const project = createMockProject();
      const agent = createMockAgent();
      stubPrepareConversationDB(conversation, stage, project, agent);

      mockBuildContextForUserInput.mockResolvedValue(createMockContext());
      mockProcessTextInput.mockResolvedValue({
        actions: [],
        knowledgeRetrievalDurationMs: 0,
        sampleCopyResult: null,
      });
      mockExecuteActions.mockResolvedValue(createDefaultOutcome({
        shouldGenerateResponse: true,
      }));
      mockGenerateResponseFn.mockResolvedValue(undefined);

      await runner.prepareConversation('conv_test001', session, channel);
      // Simulate filler having already opened the output turn
      (runner as any).responseOutputTurnStarted = true;
      (runner as any).turnData.outputTurnId = 'out_test001';

      await (runner as any).generateResponse(
        createMockContext(),
        createDefaultOutcome({ shouldGenerateResponse: true }),
      );

      // Should have reset the flag and skipped turn opening
      expect((runner as any).responseOutputTurnStarted).toBe(false);
      expect(mockGenerateResponseFn).toHaveBeenCalled();
    });
  });

  describe('filler sentence generation', () => {
    it('generates and includes filler sentence in response flow', async () => {
      const mockFillerLlm = createMockLlmProvider();
      mockFillerLlm.generate.mockResolvedValue({
        content: [{ type: 'text', text: 'Let me think about that...' }],
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      } as any);

      const conversation = createMockConversation({ status: 'awaiting_user_input' });
      const stage = createMockStage();
      const project = createMockProject();
      const agent = createMockAgent({
        fillerSettings: {
          enabled: true,
          prompt: 'Generate a short filler: {{userInput}}',
          llmProviderId: 'filler_llm_test001',
          llmSettings: { model: 'gpt-4o-mini' },
          historyMessageCount: 0,
        },
      });
      stubPrepareConversationDB(conversation, stage, project, agent);

      mockBuildContextForUserInput.mockResolvedValue(createMockContext());
      mockBuildContextForFillerSentence.mockResolvedValue(createMockContext({ history: [] }));
      mockTemplatingRender.mockResolvedValue('Generate a short filler');
      mockProcessTextInput.mockResolvedValue({
        actions: [],
        knowledgeRetrievalDurationMs: 0,
        sampleCopyResult: null,
      });
      mockExecuteActions.mockResolvedValue(createDefaultOutcome());

      await runner.prepareConversation('conv_test001', session, channel);
      (runner as any).stageData.fillerLlmProvider = mockFillerLlm;
      (runner as any).stageData.fillerLlmProviderInfo = { id: 'filler_llm_test001', apiType: 'openai' };
      await runner.receiveUserTextInput('hello');

      expect(mockFillerLlm.generate).toHaveBeenCalled();
    });

    it('handles filler LLM generation failure gracefully', async () => {
      const mockFillerLlm = createMockLlmProvider();
      mockFillerLlm.generate.mockRejectedValue(new Error('Filler LLM failed'));

      const conversation = createMockConversation({ status: 'awaiting_user_input' });
      const stage = createMockStage();
      const project = createMockProject();
      const agent = createMockAgent({
        fillerSettings: {
          enabled: true,
          prompt: 'Generate a short filler',
          llmProviderId: 'filler_llm_test001',
          llmSettings: { model: 'gpt-4o-mini' },
          historyMessageCount: 0,
        },
      });
      stubPrepareConversationDB(conversation, stage, project, agent);

      mockBuildContextForUserInput.mockResolvedValue(createMockContext());
      mockBuildContextForFillerSentence.mockResolvedValue(createMockContext({ history: [] }));
      mockTemplatingRender.mockResolvedValue('Generate a short filler');
      mockProcessTextInput.mockResolvedValue({
        actions: [],
        knowledgeRetrievalDurationMs: 0,
        sampleCopyResult: null,
      });
      mockExecuteActions.mockResolvedValue(createDefaultOutcome());

      await runner.prepareConversation('conv_test001', session, channel);
      (runner as any).stageData.fillerLlmProvider = mockFillerLlm;
      (runner as any).stageData.fillerLlmProviderInfo = { id: 'filler_llm_test001', apiType: 'openai' };

      const inputTurnId = await runner.receiveUserTextInput('hello');
      expect(inputTurnId).toBeDefined();
    });

    it('pops trailing user message from filler history and includes history messages', async () => {
      const mockFillerLlm = createMockLlmProvider();
      mockFillerLlm.generate.mockResolvedValue({
        content: [{ type: 'text', text: 'Hmm, let me think...' }],
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      } as any);

      const conversation = createMockConversation({ status: 'awaiting_user_input' });
      const stage = createMockStage();
      const project = createMockProject();
      const agent = createMockAgent({
        fillerSettings: {
          enabled: true,
          prompt: 'Generate a short filler',
          llmProviderId: 'filler_llm_test001',
          llmSettings: { model: 'gpt-4o-mini' },
          historyMessageCount: 5,
        },
      });
      stubPrepareConversationDB(conversation, stage, project, agent);

      // Context with user message at the end (should be popped) and assistant messages before it
      const contextWithHistory = createMockContext({
        history: [
          { role: 'assistant' as const, content: 'previous response', createdAt: new Date() },
          { role: 'user' as const, content: 'current user message', createdAt: new Date() }, // This should be popped
        ],
      });
      mockBuildContextForUserInput.mockResolvedValue(contextWithHistory);
      mockBuildContextForFillerSentence.mockResolvedValue(contextWithHistory);
      mockTemplatingRender.mockResolvedValue('Generate a short filler');
      mockProcessTextInput.mockResolvedValue({
        actions: [],
        knowledgeRetrievalDurationMs: 0,
        sampleCopyResult: null,
      });
      mockExecuteActions.mockResolvedValue(createDefaultOutcome());

      await runner.prepareConversation('conv_test001', session, channel);
      (runner as any).stageData.fillerLlmProvider = mockFillerLlm;
      (runner as any).stageData.fillerLlmProviderInfo = { id: 'filler_llm_test001', apiType: 'openai' };
      await runner.receiveUserTextInput('hello');

      // Verify the LLM was called with history minus the trailing user message
      expect(mockFillerLlm.generate).toHaveBeenCalled();
      const generateCall = (mockFillerLlm.generate as jest.Mock).mock.calls[0];
      const messages = generateCall[0];
      // System + assistant (popped user) + new user input = 3 messages
      expect(messages.length).toBe(3);
    });

    it('returns null when filler LLM generates empty text', async () => {
      const mockFillerLlm = createMockLlmProvider();
      mockFillerLlm.generate.mockResolvedValue({
        content: [{ type: 'text', text: '' }],
        usage: { promptTokens: 10, completionTokens: 0, totalTokens: 10 },
      } as any);

      const conversation = createMockConversation({ status: 'awaiting_user_input' });
      const stage = createMockStage();
      const project = createMockProject();
      const agent = createMockAgent({
        fillerSettings: {
          enabled: true,
          prompt: 'Generate a short filler',
          llmProviderId: 'filler_llm_test001',
          llmSettings: { model: 'gpt-4o-mini' },
          historyMessageCount: 0,
        },
      });
      stubPrepareConversationDB(conversation, stage, project, agent);

      mockBuildContextForUserInput.mockResolvedValue(createMockContext());
      mockBuildContextForFillerSentence.mockResolvedValue(createMockContext({ history: [] }));
      mockTemplatingRender.mockResolvedValue('Generate a short filler');
      mockProcessTextInput.mockResolvedValue({
        actions: [],
        knowledgeRetrievalDurationMs: 0,
        sampleCopyResult: null,
      });
      mockExecuteActions.mockResolvedValue(createDefaultOutcome());

      await runner.prepareConversation('conv_test001', session, channel);
      (runner as any).stageData.fillerLlmProvider = mockFillerLlm;
      (runner as any).stageData.fillerLlmProviderInfo = { id: 'filler_llm_test001', apiType: 'openai' };

      const result = await (runner as any).generateFillerSentence(
        createMockContext(),
        'hello',
      );

      expect(result).toBeNull();
    });
  });

  describe('VAD mode', () => {
    it('pre-warms ASR session when transitioning to awaiting_user_input in VAD mode', async () => {
      const mockAsr = createMockAsrProvider();
      const conversation = createMockConversation({ status: 'awaiting_user_input' });
      const stage = createMockStage();
      const project = createMockProject({
        asrConfig: {
          asrProviderId: 'asr_test001',
          serverVad: { mode: 2, prefixPaddingMs: 300, silenceDurationMs: 600, minSpeechMs: 250 },
        },
      });
      const agent = createMockAgent();
      stubPrepareConversationDB(conversation, stage, project, agent);

      mockBuildContextForUserInput.mockResolvedValue(createMockContext());
      mockProcessTextInput.mockResolvedValue({
        actions: [],
        knowledgeRetrievalDurationMs: 0,
        sampleCopyResult: null,
      });
      mockExecuteActions.mockResolvedValue(createDefaultOutcome());

      await runner.prepareConversation('conv_test001', session, channel);
      (runner as any).stageData.asrProvider = mockAsr;
      // Set vadProcessor to enable VAD mode (isVadMode is a getter that checks vadProcessor !== null)
      const mockVadProc = {
        init: vi.fn().mockResolvedValue(undefined),
        reset: vi.fn(),
        destroy: vi.fn(),
        push: vi.fn(),
        on: vi.fn(),
      };
      (runner as any).vadProcessor = mockVadProc;

      await runner.receiveUserTextInput('hello');

      expect(mockAsr.start).toHaveBeenCalled();
    });

    it('handles ASR pre-warm failure gracefully', async () => {
      const mockAsr = createMockAsrProvider();
      mockAsr.start.mockRejectedValue(new Error('ASR startup failed'));
      const conversation = createMockConversation({ status: 'awaiting_user_input' });
      const stage = createMockStage();
      const project = createMockProject({
        asrConfig: {
          asrProviderId: 'asr_test001',
          serverVad: { mode: 2, prefixPaddingMs: 300, silenceDurationMs: 600, minSpeechMs: 250 },
        },
      });
      const agent = createMockAgent();
      stubPrepareConversationDB(conversation, stage, project, agent);

      mockBuildContextForUserInput.mockResolvedValue(createMockContext());
      mockProcessTextInput.mockResolvedValue({
        actions: [],
        knowledgeRetrievalDurationMs: 0,
        sampleCopyResult: null,
      });
      mockExecuteActions.mockResolvedValue(createDefaultOutcome());

      await runner.prepareConversation('conv_test001', session, channel);
      (runner as any).stageData.asrProvider = mockAsr;
      const mockVadProc = {
        init: vi.fn().mockResolvedValue(undefined),
        reset: vi.fn(),
        destroy: vi.fn(),
        push: vi.fn(),
        on: vi.fn(),
      };
      (runner as any).vadProcessor = mockVadProc;

      await runner.receiveUserTextInput('hello');

      // Pre-warm should have been attempted but failed gracefully
      expect(mockAsr.start).toHaveBeenCalled();
      // asrPreWarmPromise should be cleared after failure
      expect((runner as any).asrPreWarmPromise).toBeNull();
    });
  });
});
