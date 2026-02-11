import { inject, singleton } from "tsyringe";
import { LlmProviderFactory } from "../providers/llm/LlmProviderFactory";
import { Tool } from "../../types/models";
import { db } from "../../db";
import { NotFoundError } from "../../errors";
import { LlmGenerationOptions } from "../providers/llm/ILlmProvider";
import { TemplatingEngine } from "./TemplatingEngine";
import { ConversationContext, ConversationContextBuilder } from "./ConversationContextBuilder";
import logger from "../../utils/logger";

export type ToolExecutionResult = {
  success: boolean;
  failureReason?: string;
  toolId: string;
  parameters: Record<string, any>;
  outputFormat?: 'text' | 'json' | 'image';
  result?: any; // Optional field for tool output
}

@singleton()
export class ToolExecutor {
  constructor(@inject(LlmProviderFactory) private readonly llmProviderFactory: LlmProviderFactory,
    @inject(TemplatingEngine) private readonly templatingEngine: TemplatingEngine,
    @inject(ConversationContextBuilder) private readonly conversationContextBuilder: ConversationContextBuilder) { }

  // Placeholder for tool execution logic
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

      const messages = [
        {
          role: 'system' as const,
          content: await this.templatingEngine.render(tool.prompt, actualContext)
        },
        {
          role: 'user' as const,
          content: 'Please complete the requested task based on the system instructions.'
        }
      ];

      const result = await llmProvider.generate(messages);
      return { success: true, toolId: tool.id, parameters, result: result.content };
    } catch (error) {
      logger.error({ toolId: tool.id, error }, `Error executing tool "${tool.name}"`);
      return { success: false, toolId: tool.id, parameters, failureReason: error.message ?? 'Unknown error during tool execution' };
    }
  }
}