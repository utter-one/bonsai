import 'reflect-metadata';
import { describe, it, beforeEach } from 'mocha';
import { expect } from 'chai';
import { UserInputProcessor } from '../../../src/services/live/UserInputProcessor';
import type { ConversationContext } from '../../../src/services/live/ConversationContextBuilder';
import type { ClassifierRuntimeData } from '../../../src/services/live/ConversationRunner';
import type { ILlmProvider } from '../../../src/services/providers/llm/ILlmProvider';
import type { Conversation, Stage, GlobalAction, SampleCopy } from '../../../src/types/models';
import type { KnowledgeCategoryResponse } from '../../../src/http/contracts/knowledge';
import type { ActionClassificationResult } from '../../../src/types/classification';

function makeMockProvider(actionNames: string[] = [], actionParams: Record<string, Record<string, any>> = {}): ILlmProvider {
  const actions: Record<string, Record<string, any>> = {};
  for (const name of actionNames) {
    actions[name] = actionParams[name] || {};
  }
  return {
    generate: async () => ({
      content: [{ contentType: 'text', text: JSON.stringify({ actions }) }],
      usage: { inputTokens: 10, outputTokens: 5 },
    }),
    generateStream: async () => {},
    enumerateModels: async () => [],
    init: async () => {},
    cleanup: async () => {},
  } as any;
}

function makeClassifier(id: string, name: string, provider: ILlmProvider): ClassifierRuntimeData {
  return {
    classifier: {
      id,
      name,
      prompt: 'Classify the input',
      llmSettings: { model: 'gpt-4' },
    },
    llmProvider: provider,
    llmProviderInfo: { id: 'provider_1', name: 'Test Provider' },
  };
}

function makeConversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: 'conv_1',
    projectId: 'proj_1',
    userId: 'user_1',
    stageId: 'stage_1',
    status: 'awaiting_user_input' as any,
    stageVars: { stage_1: {} },
    metadata: {},
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    ...overrides,
  };
}

function makeStage(overrides: Partial<Stage> = {}): Stage {
  return {
    id: 'stage_1',
    projectId: 'proj_1',
    name: 'Main Stage',
    agentId: 'agent_1',
    actions: {
      action_1: {
        name: 'book_flight',
        classificationTrigger: 'Book a flight',
        triggerOnUserInput: true,
        overrideClassifierId: null,
        effects: [],
        parameters: [],
      },
    },
    useKnowledge: false,
    enterBehavior: 'generate_response',
    variableDescriptors: [],
    knowledgeTags: [],
    defaultClassifierId: 'clf_1',
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    ...overrides,
  };
}

function makeSession(runtimeData: any): any {
  return {
    id: 'session_1',
    runner: {
      getRuntimeData: () => runtimeData,
    },
    clientConnection: {
      sendMessage: async () => {},
    },
  };
}

describe('UserInputProcessor', () => {
  let processor: UserInputProcessor;
  let templatingEngine: any;
  let contextBuilder: any;
  let conversationService: any;
  let knowledgeService: any;
  let transformerExecutor: any;

  beforeEach(() => {
    templatingEngine = { render: async (tpl: string) => tpl };
    contextBuilder = {
      buildContextForClassifier: async () => ({ userInput: 'hello' }),
      buildContextForGuardrailClassifier: async () => ({ userInput: 'hello' }),
      buildContextForSampleCopyClassifier: async () => ({ userInput: 'hello' }),
    };
    conversationService = { saveConversationEvent: async () => {} };
    knowledgeService = {
      getCategoriesByTags: async () => [],
      listKnowledgeCategories: async () => ({ items: [] }),
    };
    transformerExecutor = { executeTransformers: async () => [] };
    processor = new UserInputProcessor(
      templatingEngine,
      contextBuilder,
      conversationService,
      knowledgeService,
      transformerExecutor,
    );
  });

  describe('processTextInput with no classifiers', () => {
    it('returns empty actions when no classifiers configured', async () => {
      const runtimeData = {
        classifiers: [],
        stage: makeStage(),
        conversation: makeConversation(),
        globalActions: [],
        guardrails: [],
        guardrailClassifier: null,
        sampleCopies: [],
        sampleCopyClassifier: null,
        costManagementConfig: null,
      };
      const session = makeSession(runtimeData);

      const result = await processor.processTextInput(session, 'hello', 'hello');

      expect(result.actions).to.have.length(0);
    });
  });

  describe('classification routing', () => {
    it('routes input through single classifier', async () => {
      const provider = makeMockProvider();
      const classifier = makeClassifier('clf_1', 'Main', provider);
      const runtimeData = {
        classifiers: [classifier],
        stage: makeStage(),
        conversation: makeConversation(),
        globalActions: [],
        guardrails: [],
        guardrailClassifier: null,
        sampleCopies: [],
        sampleCopyClassifier: null,
        costManagementConfig: null,
      };
      const session = makeSession(runtimeData);

      const result = await processor.processTextInput(session, 'hello', 'hello');

      // Single classifier returns empty actions (mock returns empty)
      expect(result.actions).to.be.an('array');
    });

    it('routes input through multiple classifiers in parallel', async () => {
      const provider1 = makeMockProvider();
      const provider2 = makeMockProvider();
      const runtimeData = {
        classifiers: [
          makeClassifier('clf_1', 'Main', provider1),
          makeClassifier('clf_2', 'Secondary', provider2),
        ],
        stage: makeStage(),
        conversation: makeConversation(),
        globalActions: [],
        guardrails: [],
        guardrailClassifier: null,
        sampleCopies: [],
        sampleCopyClassifier: null,
        costManagementConfig: null,
      };
      const session = makeSession(runtimeData);

      const result = await processor.processTextInput(session, 'hello', 'hello');

      expect(result.actions).to.be.an('array');
    });

    it('filters out actions that do not exist in stage or global actions', async () => {
      const provider = makeMockProvider(['book_flight', 'nonexistent_action']);
      const classifier = makeClassifier('clf_1', 'Main', provider);
      const runtimeData = {
        classifiers: [classifier],
        stage: makeStage(),
        conversation: makeConversation(),
        globalActions: [],
        guardrails: [],
        guardrailClassifier: null,
        sampleCopies: [],
        sampleCopyClassifier: null,
        costManagementConfig: null,
      };
      const session = makeSession(runtimeData);

      const result = await processor.processTextInput(session, 'hello', 'hello');

      // Only book_flight should pass (exists in stage actions)
      expect(result.actions).to.have.length(1);
      expect(result.actions[0].name).to.equal('book_flight');
    });

    it('includes global actions in resolution', async () => {
      const provider = makeMockProvider(['global_help']);
      const classifier = makeClassifier('clf_1', 'Main', provider);
      const runtimeData = {
        classifiers: [classifier],
        stage: makeStage({ actions: {} }),
        conversation: makeConversation(),
        globalActions: [
          {
            id: 'ga_1',
            name: 'global_help',
            classificationTrigger: 'Help',
            triggerOnUserInput: true,
            overrideClassifierId: null,
            effects: [],
            parameters: [],
          },
        ],
        guardrails: [],
        guardrailClassifier: null,
        sampleCopies: [],
        sampleCopyClassifier: null,
        costManagementConfig: null,
      };
      const session = makeSession(runtimeData);

      const result = await processor.processTextInput(session, 'hello', 'hello');

      expect(result.actions).to.have.length(1);
      expect(result.actions[0].name).to.equal('global_help');
    });

    it('passes synthetic knowledge actions without lookup', async () => {
      // Mock knowledge service to return a category with id 'cat_1'
      knowledgeService = {
        getCategoriesByTags: async () => [
          { id: 'cat_1', promptTrigger: 'FAQ question' },
        ],
        listKnowledgeCategories: async () => ({
          items: [{ id: 'cat_1', promptTrigger: 'FAQ question' }],
        }),
      };
      processor = new UserInputProcessor(
        templatingEngine, contextBuilder, conversationService, knowledgeService, transformerExecutor,
      );

      const provider = makeMockProvider(['__knowledge_cat_1']);
      const classifier = makeClassifier('clf_1', 'Main', provider);
      const runtimeData = {
        classifiers: [classifier],
        stage: makeStage({
          actions: {},
          useKnowledge: true,
          defaultClassifierId: 'clf_1',
          knowledgeTags: ['faq'],
        }),
        conversation: makeConversation(),
        globalActions: [],
        guardrails: [],
        guardrailClassifier: null,
        sampleCopies: [],
        sampleCopyClassifier: null,
        costManagementConfig: null,
      };
      const session = makeSession(runtimeData);

      const result = await processor.processTextInput(session, 'hello', 'hello');

      expect(result.actions).to.have.length(1);
      expect(result.actions[0].name).to.equal('__knowledge_cat_1');
    });
  });

  describe('guardrail classification', () => {
    it('does not run guardrail classifier when no guardrails', async () => {
      const provider = makeMockProvider();
      const classifier = makeClassifier('clf_1', 'Main', provider);
      const runtimeData = {
        classifiers: [classifier],
        stage: makeStage(),
        conversation: makeConversation(),
        globalActions: [],
        guardrails: [],
        guardrailClassifier: makeClassifier('guard_clf', 'Guardrail', makeMockProvider()),
        sampleCopies: [],
        sampleCopyClassifier: null,
        costManagementConfig: null,
      };
      const session = makeSession(runtimeData);

      const result = await processor.processTextInput(session, 'hello', 'hello');

      // Guardrail classifier is skipped when guardrails array is empty
      expect(result.actions).to.be.an('array');
    });

    it('runs guardrail classifier when guardrails are configured', async () => {
      const provider = makeMockProvider();
      const classifier = makeClassifier('clf_1', 'Main', provider);
      const runtimeData = {
        classifiers: [classifier],
        stage: makeStage(),
        conversation: makeConversation(),
        globalActions: [],
        guardrails: [
          {
            id: 'guard_1',
            name: 'profanity_check',
            classificationTrigger: 'Check for profanity',
            triggerOnUserInput: true,
            overrideClassifierId: null,
            effects: [],
            parameters: [],
          },
        ],
        guardrailClassifier: makeClassifier('guard_clf', 'Guardrail', makeMockProvider()),
        sampleCopies: [],
        sampleCopyClassifier: null,
        costManagementConfig: null,
      };
      const session = makeSession(runtimeData);

      const result = await processor.processTextInput(session, 'hello', 'hello');

      expect(result.actions).to.be.an('array');
    });
  });

  describe('action parameter validation', () => {
    it('filters out actions with missing required parameters', async () => {
      const provider = makeMockProvider(['book_flight'], { book_flight: { date: '2024-01-01' } });
      const classifier = makeClassifier('clf_1', 'Main', provider);
      const runtimeData = {
        classifiers: [classifier],
        stage: makeStage({
          actions: {
            action_1: {
              name: 'book_flight',
              classificationTrigger: 'Book a flight',
              triggerOnUserInput: true,
              overrideClassifierId: null,
              effects: [],
              parameters: [
                { name: 'destination', type: 'string', description: 'Where', required: true },
                { name: 'date', type: 'string', description: 'When', required: false },
              ],
            },
          },
        }),
        conversation: makeConversation(),
        globalActions: [],
        guardrails: [],
        guardrailClassifier: null,
        sampleCopies: [],
        sampleCopyClassifier: null,
        costManagementConfig: null,
      };
      const session = makeSession(runtimeData);

      const result = await processor.processTextInput(session, 'hello', 'hello');

      // Missing required 'destination' parameter — action filtered out
      expect(result.actions).to.have.length(0);
    });

    it('passes actions when all required parameters are present', async () => {
      const provider = makeMockProvider(['book_flight'], { book_flight: { destination: 'Paris', date: '2024-01-01' } });
      const classifier = makeClassifier('clf_1', 'Main', provider);
      const runtimeData = {
        classifiers: [classifier],
        stage: makeStage({
          actions: {
            action_1: {
              name: 'book_flight',
              classificationTrigger: 'Book a flight',
              triggerOnUserInput: true,
              overrideClassifierId: null,
              effects: [],
              parameters: [
                { name: 'destination', type: 'string', description: 'Where', required: true },
                { name: 'date', type: 'string', description: 'When', required: false },
              ],
            },
          },
        }),
        conversation: makeConversation(),
        globalActions: [],
        guardrails: [],
        guardrailClassifier: null,
        sampleCopies: [],
        sampleCopyClassifier: null,
        costManagementConfig: null,
      };
      const session = makeSession(runtimeData);

      const result = await processor.processTextInput(session, 'hello', 'hello');

      expect(result.actions).to.have.length(1);
      expect(result.actions[0].name).to.equal('book_flight');
    });
  });

  describe('knowledge retrieval', () => {
    it('returns knowledge retrieval metadata when knowledge is enabled', async () => {
      const provider = makeMockProvider();
      const classifier = makeClassifier('clf_1', 'Main', provider);
      const runtimeData = {
        classifiers: [classifier],
        stage: makeStage({
          useKnowledge: true,
          defaultClassifierId: 'clf_1',
          knowledgeTags: [],
        }),
        conversation: makeConversation(),
        globalActions: [],
        guardrails: [],
        guardrailClassifier: null,
        sampleCopies: [],
        sampleCopyClassifier: null,
        costManagementConfig: null,
      };
      const session = makeSession(runtimeData);

      const result = await processor.processTextInput(session, 'hello', 'hello');

      expect(result.knowledgeRetrievalDurationMs).to.be.a('number');
      expect(result.knowledgeRetrievalStartMs).to.be.a('number');
      expect(result.knowledgeRetrievalEndMs).to.be.a('number');
    });

    it('does not return knowledge metadata when knowledge is disabled', async () => {
      const provider = makeMockProvider();
      const classifier = makeClassifier('clf_1', 'Main', provider);
      const runtimeData = {
        classifiers: [classifier],
        stage: makeStage({ useKnowledge: false }),
        conversation: makeConversation(),
        globalActions: [],
        guardrails: [],
        guardrailClassifier: null,
        sampleCopies: [],
        sampleCopyClassifier: null,
        costManagementConfig: null,
      };
      const session = makeSession(runtimeData);

      const result = await processor.processTextInput(session, 'hello', 'hello');

      expect(result.knowledgeRetrievalDurationMs).to.be.undefined;
    });
  });

  describe('transformer-triggered actions', () => {
    it('includes transformer-triggered actions in result', async () => {
      const provider = makeMockProvider();
      const classifier = makeClassifier('clf_1', 'Main', provider);
      transformerExecutor = {
        executeTransformers: async () => [
          { name: 'transformed_action', parameters: {} },
        ],
      };
      processor = new UserInputProcessor(
        templatingEngine, contextBuilder, conversationService, knowledgeService, transformerExecutor,
      );
      const runtimeData = {
        classifiers: [classifier],
        stage: makeStage({
          actions: {
            action_1: {
              name: 'transformed_action',
              classificationTrigger: 'Transformed',
              triggerOnUserInput: true,
              overrideClassifierId: null,
              effects: [],
              parameters: [],
            },
          },
        }),
        conversation: makeConversation(),
        globalActions: [],
        guardrails: [],
        guardrailClassifier: null,
        sampleCopies: [],
        sampleCopyClassifier: null,
        costManagementConfig: null,
      };
      const session = makeSession(runtimeData);

      const result = await processor.processTextInput(session, 'hello', 'hello');

      expect(result.actions.map((a: ActionClassificationResult) => a.name)).to.include('transformed_action');
    });
  });
});
