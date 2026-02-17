import { inject, singleton } from "tsyringe";
import { z } from "zod";
import { LlmProviderFactory } from "../providers/llm/LlmProviderFactory";
import { Tool } from "../../types/models";
import { db } from "../../db";
import { NotFoundError } from "../../errors";
import { llmContentSchema, LlmGenerationOptions, LlmMessage, MessageContent } from "../providers/llm/ILlmProvider";
import { TemplatingEngine } from "./TemplatingEngine";
import { ConversationContext, ConversationContextBuilder } from "./ConversationContextBuilder";
import logger from "../../utils/logger";
import { ImageParameterValue, ParameterValue, parameterValueSchema } from "../../types/parameters";

export const toolExecutionResultSchema = z.object({
  success: z.boolean(),
  failureReason: z.string().optional(),
  toolId: z.string(),
  parameters: z.record(z.string(), parameterValueSchema).describe('Parameters that were passed to the tool during execution'),
  result: z.array(llmContentSchema).optional().describe('Optional field for tool output'),
  renderedPrompt: z.string().optional(),
  llmSettings: z.any().optional(),
});

export type ToolExecutionResult = z.infer<typeof toolExecutionResultSchema>;

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
  async executeTool(tool: Tool, context: ConversationContext, parameters: Record<string, ParameterValue>): Promise<ToolExecutionResult> {
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
      logger.info({ toolId: tool.id, renderedPrompt, actualContext }, `Rendered prompt for tool "${tool.name}"`);

      const messages: LlmMessage[] = [
        {
          role: 'system' as const,
          content: renderedPrompt
        }
      ];

      // Extract and add image parameters as user messages
      const imageMessages = this.extractImageMessages(parameters);
      messages.push(...imageMessages);

      // Add final user instruction message
      messages.push({
        role: 'user' as const,
        content: 'Please complete the requested task based on the system instructions.'
      });

      const result = await llmProvider.generate(messages, { outputFormat: this.getOutputFormat(tool) });
      
      return { success: true, toolId: tool.id, parameters, result: result.content, renderedPrompt, llmSettings: tool.llmSettings };
    } catch (error) {
      logger.error({ toolId: tool.id, error }, `Error executing tool "${tool.name}"`);
      return { success: false, toolId: tool.id, parameters, failureReason: error.message ?? 'Unknown error during tool execution' };
    }
  }

  private getOutputFormat(tool: Tool): LlmGenerationOptions['outputFormat'] {
    // Determine output format based on tool configuration or default to text
    if (tool.outputType === 'text') {
      return 'text';
    }
    if (tool.outputType === 'image') {
      return 'image';
    }
    if (tool.outputType === 'multi-modal') {
      return 'image';
    }

    // Add more formats as needed
    return 'text';
  }

  /**
   * Extracts image parameters from the parameters object and converts them to user messages with image content.
   * Supports both single image parameters and image array parameters.
   * @param parameters The parameters object containing potential image values
   * @returns Array of LlmMessage objects containing image content
   */
  private extractImageMessages(parameters: Record<string, ParameterValue>): LlmMessage[] {
    const imageMessages: LlmMessage[] = [];

    for (const [key, value] of Object.entries(parameters)) {
      if (this.isImageParameter(value)) {
        // Single image parameter
        const imageContent = this.convertImageToContent(value);
        imageMessages.push({
          role: 'user',
          content: [imageContent]
        });
      } else if (Array.isArray(value) && value.length > 0) {
        // Check if all array items are image parameters
        const arrayValue = value as any[];
        const allImages = arrayValue.every(v => this.isImageParameter(v));
        if (allImages) {
          // Image array parameter - combine all images into one message
          const imageContents = arrayValue.map(img => this.convertImageToContent(img as ImageParameterValue));
          imageMessages.push({
            role: 'user',
            content: imageContents
          });
        }
      }
    }

    return imageMessages;
  }

  /**
   * Checks if a value is an image parameter based on its structure
   * @param value The value to check
   * @returns True if the value matches the image parameter structure
   */
  private isImageParameter(value: any): value is ImageParameterValue {
    return (
      typeof value === 'object' &&
      value !== null &&
      typeof value.data === 'string' &&
      typeof value.mimeType === 'string' &&
      value.mimeType.startsWith('image/')
    );
  }

  /**
   * Converts an image parameter value to MessageContent format for LLM provider
   * @param image The image parameter value to convert
   * @returns MessageContent object with image data
   */
  private convertImageToContent(image: ImageParameterValue): MessageContent {
    return {
      type: 'image',
      source: {
        type: 'base64',
        data: image.data,
        mimeType: image.mimeType
      }
    };
  }
}