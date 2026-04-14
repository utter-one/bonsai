import { inject, singleton } from "tsyringe";
import { Stage } from "../../types/models";
import { ConversationContext } from "./ConversationContextBuilder";
import { TemplatingEngine } from "./TemplatingEngine";
import { ILlmProvider, LlmMessage } from "../providers/llm/ILlmProvider";
import { truncateMessagesToTokenBudget, type TruncationInfo } from "../../utils/contextTruncation";

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
   * @param maxTokens - Optional maximum output tokens (project cap applied as hard ceiling over entity defaultMaxTokens)
   * @param inputTokenCap - Optional maximum input context tokens; oldest non-system history messages are trimmed when exceeded
   * @param model - Model name used for token estimation during input truncation
   * @param onTruncation - Called synchronously with truncation metadata before streaming begins; use to capture info before the generation-completed callback fires
   */
  async generateResponse(context: ConversationContext, stage: Stage, renderedPrompt: string, completionLlmProvider: ILlmProvider, assistantPrefix?: string, maxTokens?: number, inputTokenCap?: number, model?: string, onTruncation?: (info: TruncationInfo) => void): Promise<void> {
    const history = context.history.map(msg => { return { role: msg.role, content: msg.content } as LlmMessage; });
    // The current user message is saved to the DB before context is built, so it ends up in
    // context.history. Remove it here to avoid sending it twice — it is appended explicitly below.
    if (context.userInput && history.at(-1)?.role === 'user') {
      history.pop();
    }
    let messages: LlmMessage[] = [
      { role: 'system', content: renderedPrompt },
      ...history,
      { role: 'user', content: context.userInput ?? '---' },
    ];
    if (assistantPrefix) {
      messages.push({ role: 'assistant', content: assistantPrefix });
    }
    const { messages: truncatedMessages, ...truncationInfo } = truncateMessagesToTokenBudget(messages, inputTokenCap, model);
    onTruncation?.(truncationInfo);
    await completionLlmProvider.generateStream(truncatedMessages, maxTokens !== undefined ? { maxTokens } : {});
  }
}