import { and, asc, eq, param } from "drizzle-orm";
import { conversationEvents, db, projects, stages, users } from "../../db";
import { Connection } from "../../websocket/ConnectionManager";
import { singleton } from "tsyringe";
import { Conversation, GlobalAction, MessageEventData, Stage } from "../../types/models";
import { StageAction } from "../../types/actions";

export type ConversationContext = {
  /** ID of the conversation */
  conversationId: string;

  /** Stage variables */
  vars: Record<string, any>;

  /** User profile data */
  userProfile: Record<string, any>;

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

  async buildContextForClassifier(conversation: Conversation, stage: Stage): Promise<ConversationContext> {
    const context: ConversationContext = {
      conversationId: conversation.id,
      vars: conversation.stageVars[conversation.stageId] || {},
      userProfile: {},
      history: [],
      actions: {},
      results: {
        webhooks: {},
        tools: {},
      },
      stage: this.buildStageContext(stage),
    };

    return context;
  }

  async buildContextForAction(conversation: Conversation, action: StageAction | GlobalAction, parameters: Record<string, any>): Promise<ConversationContext> {
    // Load user data
    const user = await db.query.users.findFirst({
      where: eq(users.id, conversation.userId),
    });

    const context = {
      conversationId: conversation.id,
      projectId: conversation.projectId,
      stageId: conversation.stageId,
      vars: conversation.stageVars[conversation.stageId] || {},
      userProfile: user?.profile || {},
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
    const context: ConversationContext = {
      conversationId: conversation.id,
      vars: conversation.stageVars[conversation.stageId] || {},
      userProfile: {},
      history: [],
      actions: {},
      results: {
        webhooks: {},
        tools: {},
      },
    };

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