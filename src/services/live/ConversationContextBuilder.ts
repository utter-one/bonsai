import { and, asc, eq, param } from "drizzle-orm";
import { conversationEvents, db, projects, stages, users } from "../../db";
import { Connection } from "../../websocket/ConnectionManager";
import { singleton } from "tsyringe";
import { Conversation, GlobalAction, Stage } from "../../types/models";
import { StageAction } from "../../types/actions";
import { MessageEventData } from "../../types/conversationEvents";

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
  /**
   * Transforms Stage entity into simplified stage context for use in prompts.
   * Filters actions to only include those that can be triggered by user input.
   */
  private buildStageContext(stage: Stage) {
    const availableActions = Object.entries(stage.actions || {})
      .filter(([_, action]) => action.triggerOnUserInput)
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
   * Filters actions to only include those that can be triggered by user input and are assigned to this classifier or have no classifier assignment.
   * @param stage - Stage entity
   * @param globalActions - Array of global actions for the stage
   * @param classifierId - ID of the classifier to filter actions for
   */
  private buildStageContextForClassifier(stage: Stage, globalActions: GlobalAction[], classifierId: string) {
    // Filter stage actions: include if triggerOnUserInput is true AND (overrideClassifierId is null OR matches classifierId)
    const stageActions = Object.entries(stage.actions || {})
      .filter(([_, action]) => action.triggerOnUserInput && (!action.overrideClassifierId || action.overrideClassifierId === classifierId))
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

    // Filter global actions: include if triggerOnUserInput is true AND (overrideClassifierId is null OR matches classifierId)
    const filteredGlobalActions = globalActions
      .filter(action => action.triggerOnUserInput && (!action.overrideClassifierId || action.overrideClassifierId === classifierId))
      .map(action => ({
        id: action.id,
        name: action.name,
        trigger: action.classificationTrigger,
        examples: action.examples || undefined,
        parameters: undefined, // Global actions don't have parameters array like stage actions
      }));

    // Combine stage actions and global actions
    const availableActions = [...stageActions, ...filteredGlobalActions];

    return {
      id: stage.id,
      name: stage.name,
      availableActions,
      useKnowledge: stage.useKnowledge,
      enterBehavior: stage.enterBehavior,
      metadata: stage.metadata || undefined,
    };
  }

  async buildContextForAction(conversation: Conversation, action: StageAction | GlobalAction, parameters: Record<string, any>): Promise<ConversationContext> {
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
      command: action,
      actions: {
        [action.name]: { parameters },
      },
      results: {
        webhooks: {},
        tools: {},
      },
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


  async buildContextForConversationStart(conversation: Conversation): Promise<ConversationContext> {
    // Load stage with persona
    const stage = await db.query.stages.findFirst({
      where: eq(stages.id, conversation.stageId),
      with: { persona: true },
    });

    const context: ConversationContext = {
      conversationId: conversation.id,
      vars: conversation.stageVars[conversation.stageId] || {},
      userProfile: {},
      persona: stage?.persona?.prompt,
      history: [],
      actions: {},
      results: {
        webhooks: {},
        tools: {},
      },
      stage: this.buildStageContext(stage!),
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
   */
  async buildContextForClassifier(conversation: Conversation, stage: Stage, globalActions: GlobalAction[], classifierId: string, userInput?: string, originalUserInput?: string): Promise<ConversationContext> {
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
      actions: {}, // Convert classification results to actions later
      userInput,
      originalUserInput,
      results: {
        webhooks: {},
        tools: {},
      },
      stage: this.buildStageContextForClassifier(stage, globalActions, classifierId),
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

  async buildContextForUserInput(conversation: Conversation, stage: Stage, userInput?: string, originalUserInput?: string): Promise<ConversationContext> {
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
      actions: {}, // Convert classification results to actions later
      userInput,
      originalUserInput,
      results: {
        webhooks: {},
        tools: {},
      },
      stage: this.buildStageContext(stage),
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
}