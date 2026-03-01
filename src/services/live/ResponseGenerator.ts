import { inject, singleton } from "tsyringe";
import { Stage } from "../../types/models";
import { ConversationContext } from "./ConversationContextBuilder";
import { TemplatingEngine } from "./TemplatingEngine";
import { ILlmProvider, LlmMessage } from "../providers/llm/ILlmProvider";

@singleton()
export class ResponseGenerator {

  constructor(@inject(TemplatingEngine) private templatingEngine: TemplatingEngine) { }

  /**
   * Generates streamed AI response for the given conversation context and stage.
   *
   * @param context - Execution context containing conversation and stage information
   * @param stage - The current stage of the conversation
   * @param renderedPrompt - The rendered system prompt
   * @param completionLlmProvider - The LLM provider to use for generating the response
   * @param assistantPrefix - Optional filler sentence already spoken; passed as an assistant prefill so the LLM continues naturally from it
   */
  async generateResponse(context: ConversationContext, stage: Stage, renderedPrompt: string, completionLlmProvider: ILlmProvider, assistantPrefix?: string) {
    const history = context.history.map(msg => { return { role: msg.role, content: msg.content } as LlmMessage; });
    const messages: LlmMessage[] = [
      { role: 'system', content: renderedPrompt },
      ...history,
      { role: 'user', content: context.userInput ?? '---' },
    ];
    if (assistantPrefix) {
      messages.push({ role: 'assistant', content: assistantPrefix });
    }
    await completionLlmProvider.generateStream(messages, {});
  }
}