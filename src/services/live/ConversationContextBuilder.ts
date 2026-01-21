import { and, asc, eq } from "drizzle-orm";
import { conversationEvents, db } from "../../db";
import { Connection } from "../../websocket/ConnectionManager";
import { singleton } from "tsyringe";

export type ConversationContext = {
  /** ID of the project the conversation belongs to */
  projectId: string;

  /** ID of the current stage in the conversation */
  stageId: string;

  /** Stage variables */
  vars: Record<string, any>;

  /** Conversation history as an array of messages */
  history: Array<{
    role: 'user' | 'assistant';
    content: string;
  }>;

  /** Current command being executed, if any */
  command: any;
}

/**
 * Builder for LLM context used in live sessions. Contains all necessary data that can be used by LLMs in prompts.
 * The context is used by templating engine to create final prompts sent to LLMs.
 */
@singleton()
export class ConversationContextBuilder {
  async buildContextForSession(session: Connection): Promise<ConversationContext> {
    const context = {
      projectId: session.runner.getRuntimeData().project.id,
      stageId: session.runner.getRuntimeData().stage.id,
      vars: {},
      history: [],
      command: null,
    };

    // Get history from database
    const messages = await db.query.conversationEvents.findMany({
      where: and(
        eq(conversationEvents.conversationId, session.conversationId),
        eq(conversationEvents.eventType, 'message')
      ),
      orderBy: asc(conversationEvents.timestamp),
    });
    context.history = messages.map(msg => {
      const eventData = msg.eventData as { role: 'user' | 'assistant'; content: string };
      return {
        role: eventData.role,
        content: eventData.content,
      };
    });

    return context;
  }
}