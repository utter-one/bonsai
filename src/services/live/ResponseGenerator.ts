import { inject, singleton } from "tsyringe";
import { Stage } from "../../types/models";
import { ConversationContext } from "./ConversationContextBuilder";
import { TemplatingEngine } from "./TemplatingEngine";
import { ILlmProvider, LlmMessage } from "../providers/llm/ILlmProvider";
import logger from "../../utils/logger";

@singleton()
export class ResponseGenerator {

  constructor(@inject(TemplatingEngine) private templatingEngine: TemplatingEngine) { }

  /**
   * Generates streamed AI response for the given conversation context and stage.
   * 
   * @param context - Execution context containing conversation and stage information
   * @param stage - The current stage of the conversation
   * @param completionLlmProvider - The LLM provider to use for generating the response
   */
  async generateResponse(context: ConversationContext, stage: Stage, completionLlmProvider: ILlmProvider) {
    const renderedPrompt = await this.templatingEngine.render(stage.prompt, context);
    const history = context.history.map(msg => { return { role: msg.role, content: msg.content } as LlmMessage; });
    await completionLlmProvider.generateStream([
      { role: 'system', content: renderedPrompt }, 
      ...history, 
      { role: 'user', content: context.userInput ?? '---' }
    ], {});
  }
}