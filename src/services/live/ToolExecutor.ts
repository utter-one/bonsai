import { inject, singleton } from "tsyringe";
import { LlmProviderFactory } from "../providers/llm/LlmProviderFactory";
import { Tool } from "../../types/models";
import { db } from "../../db";
import { NotFoundError } from "../../errors";
import { LlmContent, LlmGenerationOptions } from "../providers/llm/ILlmProvider";
import { TemplatingEngine } from "./TemplatingEngine";
import { ConversationContext, ConversationContextBuilder } from "./ConversationContextBuilder";
import logger from "../../utils/logger";
import { extractTextFromContent } from "../../utils/llm";

export type ToolExecutionResult = {
  success: boolean;
  failureReason?: string;
  toolId: string;
  parameters: Record<string, any>;
  outputFormat?: 'text' | 'json' | 'image';
  result?: LlmContent[]; // Optional field for tool output
  renderedPrompt?: string;
  llmSettings?: any;
}

@singleton()
export class ToolExecutor {
  constructor(@inject(LlmProviderFactory) private readonly llmProviderFactory: LlmProviderFactory,
    @inject(TemplatingEngine) private readonly templatingEngine: TemplatingEngine,
    @inject(ConversationContextBuilder) private readonly conversationContextBuilder: ConversationContextBuilder) { }

  /**
   * Executes a tool by invoking its associated LLM provider with the rendered prompt and provided parameters.
   * @param tool The tool to execute, which includes the prompt template and LLM provider configuration.
   * @param context The conversation context to use for rendering the prompt.
   * @param parameters The parameters to pass to the tool, which will be included in the context for prompt rendering.
   * @returns A promise that resolves to the result of the tool execution, including success status, output, and any error information.
   * @throws NotFoundError if the associated LLM provider is not found.
   * @throws Error for any issues during tool execution, which will be captured in the failureReason of the result.
   */
  async executeTool(tool: Tool, context: ConversationContext, parameters: Record<string, any>): Promise<ToolExecutionResult> {
    if (!tool.llmProviderId) {
      throw new Error(`Tool "${tool.name}" does not have an associated LLM provider`);
    }
    const llmProviderEntity = await db.query.providers.findFirst({ where: (providers, { eq }) => eq(providers.id, tool.llmProviderId) });
    if (!llmProviderEntity) {
      throw new NotFoundError(`LLM provider with ID "${tool.llmProviderId}" not found for tool "${tool.name}"`);
    }

    try {
      const llmProvider = this.llmProviderFactory.createProvider(llmProviderEntity, tool.llmSettings);
      const actualContext = { ...context, tool: { parameters } };
      await llmProvider.init();
      const renderedPrompt = await this.templatingEngine.render(tool.prompt, actualContext);

      const messages = [
        {
          role: 'system' as const,
          content: renderedPrompt
        },
        {
          role: 'user' as const,
          content: 'Please complete the requested task based on the system instructions.'
        }
      ];

      const result = await llmProvider.generate(messages);
      
      return { success: true, toolId: tool.id, parameters, result: result.content, renderedPrompt, llmSettings: tool.llmSettings };
    } catch (error) {
      logger.error({ toolId: tool.id, error }, `Error executing tool "${tool.name}"`);
      return { success: false, toolId: tool.id, parameters, failureReason: error.message ?? 'Unknown error during tool execution' };
    }
  }
}