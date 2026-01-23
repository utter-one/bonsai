import { and, asc, eq } from "drizzle-orm";
import { conversationEvents, db, users } from "../../db";
import { Connection } from "../../websocket/ConnectionManager";
import { singleton } from "tsyringe";
import { Conversation, GlobalAction, MessageEventData, StageAction, User } from "../../types/models";

export type ConversationContext = {
  /** ID of the conversation */
  conversationId: string;

  /** ID of the project the conversation belongs to */
  projectId: string;

  /** ID of the current stage in the conversation */
  stageId: string;

  /** Stage variables */
  vars: Record<string, any>;

  /** User profile data */
  userProfile: Record<string, any>;

  /** Conversation history as an array of messages */
  history: Array<{
    role: 'user' | 'assistant';
    content: string;
  }>;

  /** Explicitly called action by the frontend */
  explicitAction?: StageAction | GlobalAction | null;

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
}

/**
 * Builder for LLM context used in live sessions. Contains all necessary data that can be used by LLMs in prompts.
 * The context is used by templating engine to create final prompts sent to LLMs.
 */
@singleton()
export class ConversationContextBuilder {
  async buildContextForAction(conversation: Conversation, action: StageAction | GlobalAction, vars: Record<string, any>): Promise<ConversationContext> {
    // Load user data
    const user = await db.query.users.findFirst({
      where: eq(users.id, conversation.userId),
    });

    const context = {
      conversationId: conversation.id,
      projectId: conversation.projectId,
      stageId: conversation.stageId,
      vars,
      userProfile: user?.profile || {},
      history: [],
      command: action,
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
  
  async buildContextForUserInput(conversation: Conversation, userInput?: string, originalUserInput?: string): Promise<ConversationContext> {
    // Load user data
    const user = await db.query.users.findFirst({
      where: eq(users.id, conversation.userId),
    });

    const context = {
      conversationId: conversation.id,
      projectId: conversation.projectId,
      stageId: conversation.stageId,
      vars: {},
      userProfile: user?.profile || {},
      history: [],
      command: null,
      userInput,
      originalUserInput,
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
}