import { and, asc, eq } from "drizzle-orm";
import { conversationEvents, db } from "../../db";
import { Session } from "./SessionManager";
import { singleton } from "tsyringe";

export type LlmContext = {
  projectId: string;
  stageId: string;
  variables: Record<string, any>;
  history: Array<{
    role: 'user' | 'assistant' | 'system';
    content: string;
  }>;
  command: any;
}

/**
 * Builder for LLM context used in live sessions. Contains all necessary data that can be used by LLMs in prompts.
 * The context is used by templating engine to create final prompts sent to LLMs.
 */
@singleton()
export class LlmContextBuilder {
  async buildContextForSession(session: Session): Promise<LlmContext> {
    const context = {
      projectId: session.runner.getRuntimeData().project.id,
      stageId: session.runner.getRuntimeData().stage.id,
      variables: {},
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