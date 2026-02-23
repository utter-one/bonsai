import { and, asc, eq, param } from "drizzle-orm";
import { conversationEvents, db, projects, stages, users } from "../../db";
import { Connection } from "../../websocket/ConnectionManager";
import { inject, singleton } from "tsyringe";
import { Conversation, GlobalAction, Stage } from "../../types/models";
import { FieldDescriptor } from "../../types/parameters";
import { StageAction } from "../../types/actions";
import { MessageEventData } from "../../types/conversationEvents";
import { IsolatedScriptExecutor } from "./IsolatedScriptExecutor";
import { isActionActive } from "../../utils/actions";
import { ActionClassificationResult } from "../../types/classification";
import type { KnowledgeCategoryResponse } from "../../http/contracts/knowledge";

/**
 * Recursively converts a single FieldDescriptor into a pseudo-JSON value.
 * Primitives become their type label string (e.g. "string"), arrays are wrapped in a
 * single-element array, and objects are expanded into key→value maps.
 */
function buildSchemaValue(descriptor: FieldDescriptor): unknown {
  if (descriptor.objectSchema?.length) {
    const obj: Record<string, unknown> = {};
    for (const child of descriptor.objectSchema) {
      obj[child.name] = buildSchemaValue(child);
    }
    return descriptor.isArray ? [obj] : obj;
  }
  // Strip trailing [] from type name — isArray already controls the array wrapper
  const typeName = descriptor.type.replace(/\[\]$/, '');
  return descriptor.isArray ? [typeName] : typeName;
}

/**
 * Converts an array of FieldDescriptors into a pseudo-JSON string that shows field names,
 * types, array shapes and nested object structures. Intended for inclusion in LLM prompts.
 *
 * Example output:
 * ```json
 * {
 *   "name": "string",
 *   "age": "number",
 *   "tags": ["string"],
 *   "address": {
 *     "street": "string",
 *     "city": "string"
 *   },
 *   "contacts": [{ "name": "string" }]
 * }
 * ```
 */
function fieldDescriptorsToPseudoJson(descriptors: FieldDescriptor[]): string {
  if (!descriptors.length) return '{}';
  const obj: Record<string, unknown> = {};
  for (const d of descriptors) {
    obj[d.name] = buildSchemaValue(d);
  }
  return JSON.stringify(obj, null, 2);
}

/**
 * A single FAQ item consisting of a question and its answer, sourced from the knowledge base.
 */
export type FaqItem = {
  question: string;
  answer: string;
};

export type ConversationContext = {
  /** ID of the conversation */
  conversationId: string;

  /** Stage variables */
  vars: Record<string, any>;

  /** User profile data */
  userProfile: Record<string, any>;

  /** Persona prompt that defines AI personality and behavior */
  persona?: string;

  /** Conversation history as an array of messages */
  history: Array<{
    role: 'user' | 'assistant';
    content: string;
  }>;

  /** Explicitly called or detected actions */
  actions: Record<string, {
    parameters: Record<string, any>
  }>;

  /** User input that triggered processing (can be null if not triggered by user input) */
  userInput?: string;

  /** Source of the user input (e.g., 'text' or 'voice') */
  userInputSource?: 'text' | 'voice';

  /** The original user input before any action processing/redaction/etc. */
  originalUserInput?: string;

  /** Results from webhooks and tools called during processing */
  results: {
    webhooks: Record<string, any>;
    tools: Record<string, any>;
  }

  /** FAQ items gathered from knowledge base categories triggered during this conversation turn */
  faq?: FaqItem[];

  /**
   * Pseudo-JSON schema descriptions of context variables, populated for transformer contexts.
   */
  schema?: string;

  /**
   * Current values of the stage variable fields selected for transformation.
   * Only populated in transformer contexts. Use the `json` helper in templates to render it.
   */
  context?: Record<string, any>;

  /** Stage configuration and available actions (optional, included for classification and processing contexts) */
  stage?: {
    /** ID of the stage */
    id: string;
    /** Display name of the stage */
    name: string;
    /** List of actions available in this stage that can be triggered by user input */
    availableActions: Array<{
      id: string;
      name: string;
      trigger: string;
      examples?: string[];
      parameters?: Array<{
        name: string;
        type: string;
        description: string;
        required: boolean;
      }>;
    }>;
    /** Whether knowledge base is active */
    useKnowledge: boolean;
    /** Behavior when entering stage */
    enterBehavior: 'generate_response' | 'await_user_input';
    /** Custom stage metadata */
    metadata?: Record<string, any>;
  };
}

/**
 * Builder for LLM context used in live sessions. Contains all necessary data that can be used by LLMs in prompts.
 * The context is used by templating engine to create final prompts sent to LLMs.
 */
@singleton()
export class ConversationContextBuilder {
  constructor(@inject(IsolatedScriptExecutor) private readonly scriptExecutor: IsolatedScriptExecutor) {}

  /**
   * Transforms Stage entity into simplified stage context for use in prompts.
   * Filters actions to only include those that can be triggered by user input.
   */
  private async buildStageContext(stage: Stage, rawContext: ConversationContext): Promise<ConversationContext['stage']> {
    const availableActions = Object.entries(stage.actions || {})
      .filter(async ([_, action]) => action.triggerOnUserInput && await isActionActive(action, rawContext, this.scriptExecutor))
      .map(([id, action]) => ({
        id,
        name: action.name,
        trigger: action.classificationTrigger,
        examples: action.examples || undefined,
        parameters: action.parameters?.map(p => ({
          name: p.name,
          type: p.type,
          description: p.description,
          required: p.required,
        })),
      }));

    return {
      id: stage.id,
      name: stage.name,
      availableActions,
      useKnowledge: stage.useKnowledge,
      enterBehavior: stage.enterBehavior,
      metadata: stage.metadata || undefined,
    };
  }

  /**
   * Transforms Stage entity into simplified stage context for a specific classifier.
   * Filters actions to only include those that can be triggered by user input, are assigned to this classifier or have no classifier assignment, and have truthy conditions.
   * @param stage - Stage entity
   * @param globalActions - Array of global actions for the stage
   * @param classifierId - ID of the classifier to filter actions for
   * @param rawContext - The conversation context to use for condition evaluation
   * @param knowledgeCategories - Optional knowledge categories to inject as synthetic actions (only for the default classifier)
   */
  private async buildStageContextForClassifier(stage: Stage, globalActions: GlobalAction[], classifierId: string, rawContext: ConversationContext, knowledgeCategories?: KnowledgeCategoryResponse[]) {
    // Filter stage actions: include if triggerOnUserInput is true AND (overrideClassifierId is null OR matches classifierId) AND condition is met
    const stageActionEntries = Object.entries(stage.actions || {})
      .filter(([_, action]) => action.triggerOnUserInput && (!action.overrideClassifierId || action.overrideClassifierId === classifierId));
    
    const stageActionsPromises = stageActionEntries.map(async ([id, action]) => {
      const isActive = await isActionActive(action, rawContext, this.scriptExecutor);
      if (!isActive) return null;
      
      return {
        id,
        name: action.name,
        trigger: action.classificationTrigger,
        examples: action.examples || undefined,
        parameters: action.parameters?.map(p => ({
          name: p.name,
          type: p.type,
          description: p.description,
          required: p.required,
        })),
      };
    });

    // Filter global actions: include if triggerOnUserInput is true AND (overrideClassifierId is null OR matches classifierId) AND condition is met
    const filteredGlobalActionsPromises = globalActions
      .filter(action => action.triggerOnUserInput && (!action.overrideClassifierId || action.overrideClassifierId === classifierId))
      .map(async action => {
        const isActive = await isActionActive(action, rawContext, this.scriptExecutor);
        if (!isActive) return null;
        
        return {
          id: action.id,
          name: action.name,
          trigger: action.classificationTrigger,
          examples: action.examples || undefined,
          parameters: action.parameters?.map(p => ({
            name: p.name,
            type: p.type,
            description: p.description,
            required: p.required,
          })),
        };
      });

    // Wait for all condition checks to complete
    const [stageActionsWithNulls, globalActionsWithNulls] = await Promise.all([
      Promise.all(stageActionsPromises),
      Promise.all(filteredGlobalActionsPromises)
    ]);

    // Filter out null values from actions that failed condition checks
    const stageActions = stageActionsWithNulls.filter(a => a !== null);
    const filteredGlobalActions = globalActionsWithNulls.filter(a => a !== null);

    // Build synthetic knowledge actions from knowledge categories (injected only for the default classifier)
    const knowledgeActions = (knowledgeCategories ?? []).map(category => ({
      id: `__knowledge_${category.id}`,
      name: `__knowledge_${category.id}`,
      trigger: category.promptTrigger,
    }));

    // Combine stage actions, global actions, and knowledge actions
    const availableActions = [...stageActions, ...filteredGlobalActions, ...knowledgeActions];

    return {
      id: stage.id,
      name: stage.name,
      availableActions,
      useKnowledge: stage.useKnowledge,
      enterBehavior: stage.enterBehavior,
      metadata: stage.metadata || undefined,
    };
  }

  /**
   * Builds the conversation context for a specific action being triggered, including only the relevant action in the context.
   *
   * @param conversation - Conversation entity
   * @param action - The action being triggered
   * @param parameters - Parameters for the triggered action
   */
  async buildContextForAction(conversation: Conversation, actionName: string, action: StageAction | GlobalAction, parameters: Record<string, any>): Promise<ConversationContext> {
    // Load user data
    const user = await db.query.users.findFirst({
      where: eq(users.id, conversation.userId),
    });

    // Load stage with persona
    const stage = await db.query.stages.findFirst({
      where: eq(stages.id, conversation.stageId),
      with: { persona: true },
    });

    const context = {
      conversationId: conversation.id,
      projectId: conversation.projectId,
      stageId: conversation.stageId,
      vars: conversation.stageVars[conversation.stageId] || {},
      userProfile: user?.profile || {},
      persona: stage?.persona?.prompt,
      history: [],
      actions: {
        [actionName]: { parameters },
      },
      results: {
        webhooks: {},
        tools: {},
      },
      stage: await this.buildStageContext(stage, this.buildRawContext(conversation, stage!, user?.profile || {})),
    };

    // Get history from database
    const messages = await db.query.conversationEvents.findMany({
      where: and(
        eq(conversationEvents.conversationId, conversation.id),
        eq(conversationEvents.eventType, 'message')
      ),
      orderBy: asc(conversationEvents.timestamp),
    });
    context.history = messages.map(msg => {
      const eventData = msg.eventData as MessageEventData;
      return {
        role: eventData.role,
        content: eventData.text,
      };
    });

    return context;
  }

  /**
   * Builds the initial conversation context when a conversation starts, without any user input.
   * This context will not include any actions or history, but will include stage variables, user profile, and persona.
   * 
   * @param conversation - Conversation entity
   */
  async buildContextForConversationStart(conversation: Conversation): Promise<ConversationContext> {
    // Load stage with persona
    const stage = await db.query.stages.findFirst({
      where: eq(stages.id, conversation.stageId),
      with: { persona: true },
    });

    const user = await db.query.users.findFirst({
      where: eq(users.id, conversation.userId),
    });


    const context: ConversationContext = {
      conversationId: conversation.id,
      vars: conversation.stageVars[conversation.stageId] || {},
      userProfile: user?.profile || {},
      persona: stage?.persona?.prompt,
      history: [],
      actions: {},
      results: {
        webhooks: {},
        tools: {},
      },
      stage: await this.buildStageContext(stage!, this.buildRawContext(conversation, stage!, user?.profile || {})),
    };

    return context;
  }
  
  /**
   * Builds context specifically for a classifier with filtered actions.
   * Only includes actions that are either not assigned to any classifier or assigned to the specific classifier.
   * @param conversation - Conversation entity
   * @param stage - Stage entity with persona relation
   * @param globalActions - Array of global actions for the stage
   * @param classifierId - ID of the classifier to build context for
   * @param userInput - The user input text
   * @param originalUserInput - The original user input before any transformations
   * @param knowledgeCategories - Optional knowledge categories to inject as synthetic actions for this classifier
   */
  async buildContextForClassifier(conversation: Conversation, stage: Stage, globalActions: GlobalAction[], classifierId: string, userInput?: string, originalUserInput?: string, knowledgeCategories?: KnowledgeCategoryResponse[]): Promise<ConversationContext> {
    // Load user data
    const user = await db.query.users.findFirst({
      where: eq(users.id, conversation.userId),
    });

    // Build raw context for condition evaluation
    const rawContext = this.buildRawContext(conversation, stage, user?.profile || {});
    rawContext.userInput = userInput;
    rawContext.originalUserInput = originalUserInput;

    const context = {
      conversationId: conversation.id,
      vars: conversation.stageVars[conversation.stageId] || {},
      userProfile: user?.profile || {},
      persona: (stage as any).persona?.prompt,
      history: [],
      actions: {}, // Convert classification results to actions later
      userInput,
      originalUserInput,
      results: {
        webhooks: {},
        tools: {},
      },
      stage: await this.buildStageContextForClassifier(stage, globalActions, classifierId, rawContext, knowledgeCategories),
    };

    // Get history from database
    const messages = await db.query.conversationEvents.findMany({
      where: and(
        eq(conversationEvents.conversationId, conversation.id),
        eq(conversationEvents.eventType, 'message')
      ),
      orderBy: asc(conversationEvents.timestamp),
    });
    context.history = messages.map(msg => {
      const eventData = msg.eventData as MessageEventData;
      return {
        role: eventData.role,
        content: eventData.text,
      };
    });

    return context;
  }

  /**
   * Builds context specifically for a context transformer with the full stage context.
   * Unlike the classifier context, no action filtering is applied — transformers receive the complete stage view.
   * Also populates a special `schema` variable describing the shape of stage variables and the transformer's expected output fields.
   * @param conversation - Conversation entity
   * @param stage - Stage entity with persona relation
   * @param globalActions - Array of global actions for the stage
   * @param transformerId - ID of the transformer being executed (reserved for future per-transformer filtering)
   * @param contextFields - The list of field names this transformer is expected to output (from transformer.contextFields)
   * @param userInput - The user input text
   * @param originalUserInput - The original user input before any transformations
   */
  async buildContextForTransformer(conversation: Conversation, stage: Stage, globalActions: GlobalAction[], transformerId: string, contextFields: string[], userInput?: string, originalUserInput?: string): Promise<ConversationContext> {
    // Load user data
    const user = await db.query.users.findFirst({
      where: eq(users.id, conversation.userId),
    });

    const rawContext = this.buildRawContext(conversation, stage, user?.profile || {});
    rawContext.userInput = userInput;
    rawContext.originalUserInput = originalUserInput;

    // Build pseudo-JSON schema strings from stage variableDescriptors
    const stageVarDescriptors: FieldDescriptor[] = stage.variableDescriptors ?? [];
    const stageVarDescriptorMap = new Map(stageVarDescriptors.map(d => [d.name, d]));

    // Cross-reference contextFields against stage descriptors; fall back to a minimal string descriptor for unknown fields
    const outputFieldDescriptors: FieldDescriptor[] = (contextFields ?? []).map(fieldName => (
      stageVarDescriptorMap.get(fieldName) ?? { name: fieldName, type: 'string', isArray: false }
    ));

    const stageVars = conversation.stageVars[conversation.stageId] || {};

    // Pick current values for the fields this transformer is expected to output
    const transformerContext: Record<string, any> = {};
    for (const fieldName of contextFields ?? []) {
      transformerContext[fieldName] = stageVars[fieldName];
    }

    const context: ConversationContext = {
      conversationId: conversation.id,
      vars: stageVars,
      userProfile: user?.profile || {},
      persona: (stage as any).persona?.prompt,
      history: [],
      actions: {},
      userInput,
      originalUserInput,
      results: {
        webhooks: {},
        tools: {},
      },
      schema: fieldDescriptorsToPseudoJson(outputFieldDescriptors),
      context: transformerContext,
      stage: await this.buildStageContext(stage, rawContext),
    };

    // Get history from database
    const messages = await db.query.conversationEvents.findMany({
      where: and(
        eq(conversationEvents.conversationId, conversation.id),
        eq(conversationEvents.eventType, 'message')
      ),
      orderBy: asc(conversationEvents.timestamp),
    });
    context.history = messages.map(msg => {
      const eventData = msg.eventData as MessageEventData;
      return {
        role: eventData.role,
        content: eventData.text,
      };
    });

    return context;
  }

  /**
   * Builds a full conversation context for main completion processing, including all actions and history.
   * This is used when processing user input for generating assistant responses, where all available information should be included in the context.
   * @param conversation - Conversation entity
   * @param stage - Stage entity with persona relation
   * @param userInput - The user input text
   * @param originalUserInput - The original user input before any transformations
   * @param actions - Array of action classification results
   * @param faq - Optional FAQ items from knowledge base to include in the context
   * @returns ConversationContext with all relevant data for processing user input and generating responses, including all actions that can be triggered by user input.
   */
  async buildContextForUserInput(conversation: Conversation, stage: Stage, actions: ActionClassificationResult[], userInput: string, originalUserInput: string, faq?: FaqItem[]): Promise<ConversationContext> {
    // Load user data
    const user = await db.query.users.findFirst({
      where: eq(users.id, conversation.userId),
    });

    const context = {
      conversationId: conversation.id,
      vars: conversation.stageVars[conversation.stageId] || {},
      userProfile: user?.profile || {},
      persona: (stage as any).persona?.prompt,
      history: [],
      actions: actions.reduce((acc, action) => {
        acc[action.name] = { parameters: action.parameters };
        return acc;
      }, {} as Record<string, { parameters: Record<string, any> }>),
      userInput,
      originalUserInput,
      faq: faq ?? [],
      results: {
        webhooks: {},
        tools: {},
      },
      stage: await this.buildStageContext(stage, this.buildRawContext(conversation, stage, user?.profile || {})),
    };

    // Get history from database
    const messages = await db.query.conversationEvents.findMany({
      where: and(
        eq(conversationEvents.conversationId, conversation.id),
        eq(conversationEvents.eventType, 'message')
      ),
      orderBy: asc(conversationEvents.timestamp),
    });
    context.history = messages.map(msg => {
      const eventData = msg.eventData as MessageEventData;
      return {
        role: eventData.role,
        content: eventData.text,
      };
    });

    return context;
  }

  /**
   * Builds a minimal context with only raw data for use in action condition evaluation.
   * No filtering is applied here. Use for evaluating condition statements in actions.
   * 
   * @param conversation - Conversation entity
   * @param stage - Stage entity
   * @returns ConversationContext with only raw data and no filtering for actions or stage context.
   */
  public buildRawContext(conversation: Conversation, stage: Stage, userProfile: Record<string, any>): ConversationContext {
    return {
      conversationId: conversation.id,
      vars: conversation.stageVars[conversation.stageId] || {},
      userProfile: userProfile || {}, // Not loaded in raw context
      history: [], // Not loaded in raw context
      actions: {}, // Not loaded in raw context
      results: {
        webhooks: {},
        tools: {},
      },
      stage: {
          id: conversation.stageId,
          name: stage.name,
          availableActions: stage.actions ? Object.entries(stage.actions).map(([id, action]) => ({
            id,
            name: action.name,
            trigger: action.classificationTrigger,
            examples: action.examples || undefined,
            parameters: action.parameters?.map(p => ({
              name: p.name,
              type: p.type,
              description: p.description,
              required: p.required,
            })),
          })) : [],
          useKnowledge: stage.useKnowledge,
          enterBehavior: stage.enterBehavior,
          metadata: stage.metadata || undefined,          
      }
    };
  }
}